/**
 * kafka.ts — Kafka/Redpanda client and topic management
 *
 * Provides a singleton Kafka client (KafkaJS) and utilities for:
 * - Auto-creating bot topics from bots.yaml on startup
 * - Producing messages to bot inboxes
 * - Consuming messages from bot outboxes
 *
 * Broker address defaults to localhost:19092 (Redpanda via Docker).
 * Override with KAFKA_BROKERS env var.
 */

import kafkajs, { type Producer, type Admin } from 'kafkajs';
const { Kafka, logLevel, CompressionTypes, CompressionCodecs } = kafkajs;
import { getAllTopics, getAllBots, getBot, type BotEntry, type SdkBot, type WebhookBot, type MockBot } from './bots.js';
import { setBotStatus } from './bot-status.js';

// Enable Snappy compression support (used by Redpanda Console by default)
// @ts-ignore — kafkajs-snappy has no type declarations
const SnappyCodec = (await import('kafkajs-snappy')).default;
CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;

const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:19092').split(',');

let kafka: InstanceType<typeof Kafka> | null = null;
let producer: Producer | null = null;

export function getKafkaClient(): InstanceType<typeof Kafka> {
  if (!kafka) {
    kafka = new Kafka({
      clientId: 'foreman',
      brokers: BROKERS,
      logLevel: logLevel.WARN,
    });
  }
  return kafka;
}

/**
 * Ensure all bot topic pairs exist in Redpanda.
 * Called once at Foreman startup. Safe to call multiple times — existing topics are skipped.
 */
export async function ensureBotTopics(): Promise<void> {
  const topics = getAllTopics();
  if (topics.length === 0) {
    console.log('[kafka] No bots defined — skipping topic creation');
    return;
  }

  const admin: Admin = getKafkaClient().admin();
  try {
    await admin.connect();

    const existing = await admin.listTopics();
    const toCreate = topics.filter((t) => !existing.includes(t));

    if (toCreate.length === 0) {
      console.log(`[kafka] All ${topics.length} bot topics already exist`);
      return;
    }

    await admin.createTopics({
      topics: toCreate.map((topic) => ({
        topic,
        numPartitions: 1,
        replicationFactor: 1,
      })),
      waitForLeaders: true,
    });

    console.log(`[kafka] Created ${toCreate.length} topic(s): ${toCreate.join(', ')}`);
  } catch (err: any) {
    // Non-fatal — Redpanda may not be running in all environments
    console.warn(`[kafka] Could not connect to Redpanda at ${BROKERS.join(', ')}: ${err.message}`);
    console.warn('[kafka] Bot Kafka transport will be unavailable — Slack transport still works');
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

/**
 * Get the singleton Kafka producer (connects lazily).
 */
export async function getProducer(): Promise<Producer> {
  if (!producer) {
    producer = getKafkaClient().producer();
    await producer.connect();
  }
  return producer!;
}

/**
 * Produce a message to a bot's inbox topic.
 * correlationId is used to match the response on the outbox.
 */
export async function sendToBot(
  botName: string,
  prompt: string,
  correlationId: string,
): Promise<void> {
  const p = await getProducer();
  const topic = `${botName}.inbox`;
  const message = JSON.stringify({
    id: correlationId,
    correlationId,
    botName,
    prompt,
    timestamp: new Date().toISOString(),
  });

  await p.send({ topic, messages: [{ key: correlationId, value: message }] });
}

/**
 * Gracefully disconnect all Kafka clients.
 * Call on Foreman shutdown.
 */
export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect().catch(() => {});
    producer = null;
  }
  kafka = null;
}

// ── Bot Consumer Loop ─────────────────────────────────────────────────────────

/**
 * Call a bot's LLM directly — stateless, no session history.
 * Each inbox message is processed independently with the bot's system_prompt.
 */
async function callBot(entry: BotEntry, prompt: string): Promise<string> {
  const { definition } = entry;

  // Mock bot — return canned response
  if (definition.type === 'mock') {
    return (definition as MockBot).response;
  }

  // Webhook bot — HTTP POST to external endpoint
  if (definition.type === 'webhook') {
    const bot = definition as WebhookBot;
    const res = await fetch(bot.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bot.headers || {}) },
      body: JSON.stringify({ prompt, system_prompt: bot.system_prompt }),
    });
    if (!res.ok) throw new Error(`Webhook ${bot.url} returned HTTP ${res.status}`);
    const data = await res.json() as any;
    return data.result ?? data.response ?? data.text ?? JSON.stringify(data);
  }

  // SDK bots — direct LLM API call
  if (definition.type === 'sdk') {
    const bot = definition as SdkBot;

    if (bot.provider === 'anthropic') {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: bot.model,
        max_tokens: 8096,
        system: bot.system_prompt,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = msg.content[0];
      return block.type === 'text' ? block.text : '';
    }

    if (bot.provider === 'openai') {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await client.chat.completions.create({
        model: bot.model,
        messages: [
          { role: 'system', content: bot.system_prompt },
          { role: 'user', content: prompt },
        ],
      });
      return completion.choices[0]?.message?.content ?? '';
    }

    if (bot.provider === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
      const model = genAI.getGenerativeModel({
        model: bot.model,
        systemInstruction: bot.system_prompt,
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    }
  }

  throw new Error(`Bot "${entry.name}" has unsupported type: ${definition.type}`);
}

/** Public wrapper — call a bot by name from bots.yaml. Stateless, no session history. */
export async function callBotByName(botName: string, prompt: string): Promise<string> {
  const entry = getBot(botName);
  if (!entry) throw new Error(`Bot not found: ${botName}`);
  return callBot(entry, prompt);
}

/**
 * Start one Kafka consumer per bot in bots.yaml.
 * Each consumer reads from {name}.inbox, calls the bot's LLM, and writes
 * the response to {name}.outbox with a matching correlationId.
 *
 * Called once at Foreman startup. Wrapped in .catch(warn) in index.ts — non-fatal.
 * Individual bot failures are isolated — one broken bot doesn't stop the others.
 */
export async function startBotConsumers(): Promise<void> {
  const bots = getAllBots().filter(
    (b) => b.definition.type === 'sdk' || b.definition.type === 'mock' || b.definition.type === 'webhook',
  );

  if (bots.length === 0) {
    console.log('[kafka] No bots to consume for — skipping consumer loop');
    return;
  }

  for (const bot of bots) {
    const consumer = getKafkaClient().consumer({ groupId: `foreman-bot-${bot.name}` });

    try {
      await consumer.connect();
      await consumer.subscribe({ topic: bot.inboxTopic, fromBeginning: false });
      setBotStatus(bot.name, 'online');

      consumer.run({
        eachMessage: async ({ message }) => {
          let correlationId = '';
          try {
            const envelope = JSON.parse(message.value?.toString() ?? '{}') as {
              correlationId?: string;
              prompt?: string;
            };
            correlationId = envelope.correlationId ?? '';
            const prompt = envelope.prompt ?? '';

            if (!prompt) {
              console.warn(`[kafka] ${bot.name}: received message with no prompt — skipping`);
              return;
            }

            setBotStatus(bot.name, 'busy');
            console.log(`[kafka] ${bot.name}: processing message ${correlationId.slice(0, 8)}...`);
            const result = await callBot(bot, prompt);

            const p = await getProducer();
            await p.send({
              topic: bot.outboxTopic,
              messages: [{
                key: correlationId,
                value: JSON.stringify({
                  correlationId,
                  result,
                  timestamp: new Date().toISOString(),
                }),
              }],
            });

            setBotStatus(bot.name, 'online');
            console.log(`[kafka] ${bot.name}: response sent to ${bot.outboxTopic}`);
          } catch (err: any) {
            setBotStatus(bot.name, 'online');
            console.error(`[kafka] ${bot.name} failed (correlationId=${correlationId}):`, err.message);
          }
        },
      }).catch((err: any) => {
        setBotStatus(bot.name, 'offline');
        console.error(`[kafka] Consumer loop for ${bot.name} crashed:`, err.message);
      });

      console.log(`[kafka] Consumer ready: ${bot.inboxTopic}`);
    } catch (err: any) {
      setBotStatus(bot.name, 'offline');
      // Non-fatal — one bot failure doesn't stop the others
      console.warn(`[kafka] Failed to start consumer for ${bot.name}:`, err.message);
    }
  }

  console.log(`[kafka] Bot consumers started for: ${bots.map((b) => b.name).join(', ')}`);
}
