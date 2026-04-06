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
 * Uses the bot's registered inboxTopic (handles namespace separator).
 */
export async function sendToBot(
  botName: string,
  prompt: string,
  correlationId: string,
): Promise<void> {
  const entry = getBot(botName);
  const p = await getProducer();
  const message = JSON.stringify({
    id: correlationId,
    correlationId,
    botName,
    prompt,
    timestamp: new Date().toISOString(),
  });

  await p.send({ topic: entry.inboxTopic, messages: [{ key: correlationId, value: message }] });
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

// ── Bot Session History ───────────────────────────────────────────────────────
// Per-bot conversation history. Transport-agnostic — Kafka is just a pipe,
// the bot's session state lives here.

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const botSessions = new Map<string, ChatMessage[]>();

/** Get or create a conversation history for a bot. */
function getHistory(botName: string): ChatMessage[] {
  if (!botSessions.has(botName)) botSessions.set(botName, []);
  return botSessions.get(botName)!;
}

// ── Bot Consumer Loop ─────────────────────────────────────────────────────────

/**
 * Call a bot's LLM with full conversation history.
 * Each bot maintains a session — messages accumulate across calls.
 */
async function callBot(entry: BotEntry, prompt: string): Promise<string> {
  const { definition } = entry;

  // Mock bot — return canned response (stateless by design)
  if (definition.type === 'mock') {
    return (definition as MockBot).response;
  }

  // Webhook bot — HTTP POST to external endpoint (stateless — no session)
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

  // SDK bots — LLM API call with full conversation history
  if (definition.type === 'sdk') {
    const bot = definition as SdkBot;
    const history = getHistory(entry.name);

    // Append the new user message
    history.push({ role: 'user', content: prompt });

    let response = '';

    if (bot.provider === 'anthropic') {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: bot.model,
        max_tokens: 8096,
        system: bot.system_prompt,
        messages: history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      });
      const block = msg.content[0];
      response = block.type === 'text' ? block.text : '';
    } else if (bot.provider === 'openai') {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await client.chat.completions.create({
        model: bot.model,
        messages: [
          { role: 'system', content: bot.system_prompt },
          ...history,
        ],
      });
      response = completion.choices[0]?.message?.content ?? '';
    } else if (bot.provider === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
      const model = genAI.getGenerativeModel({
        model: bot.model,
        systemInstruction: bot.system_prompt,
      });
      // Gemini uses a different history format — build from our messages
      const chat = model.startChat({
        history: history.slice(0, -1).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      });
      const result = await chat.sendMessage(prompt);
      response = result.response.text();
    } else {
      throw new Error(`Bot "${entry.name}" has unsupported provider: ${bot.provider}`);
    }

    // Append the assistant response to history
    history.push({ role: 'assistant', content: response });
    return response;
  }

  throw new Error(`Bot "${entry.name}" has unsupported type: ${definition.type}`);
}

// ── Persistent Outbox Consumer ────────────────────────────────────────────────
// One consumer reads ALL outbox topics and routes responses to pending promises
// via correlation ID. No race conditions — consumer is running before requests.

interface PendingRequest {
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingRequests = new Map<string, PendingRequest>();
let outboxConsumerReady = false;

/**
 * Start a single persistent consumer for ALL bot outbox topics.
 * Routes responses to pending `callBotByName` promises via correlationId.
 * Call once at startup (after ensureBotTopics).
 */
export async function startOutboxConsumer(): Promise<void> {
  const outboxTopics = getAllBots().map(b => b.outboxTopic);
  if (outboxTopics.length === 0) return;

  const consumer = getKafkaClient().consumer({ groupId: 'foreman-outbox-router' });
  await consumer.connect();

  for (const topic of outboxTopics) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const envelope = JSON.parse(message.value?.toString() ?? '{}') as {
          correlationId?: string;
          result?: string;
        };
        const cid = envelope.correlationId;
        if (cid && pendingRequests.has(cid)) {
          const pending = pendingRequests.get(cid)!;
          clearTimeout(pending.timer);
          pendingRequests.delete(cid);
          pending.resolve(envelope.result ?? '');
        }
      } catch { /* skip malformed */ }
    },
  });

  outboxConsumerReady = true;
  console.log(`[kafka] Outbox router ready — listening on ${outboxTopics.length} outbox topic(s)`);
}

/**
 * Call a bot via Kafka: produce to inbox, wait for response on outbox.
 * Every message flows through Redpanda — observable, persistent, replayable.
 * Falls back to direct LLM call if Kafka is unavailable.
 */
export async function callBotByName(botName: string, prompt: string): Promise<string> {
  const entry = getBot(botName);
  if (!entry) throw new Error(`Bot not found: ${botName}`);

  // If outbox consumer isn't running, fall back to direct call
  if (!outboxConsumerReady) {
    console.warn(`[kafka] Outbox consumer not ready — direct call for ${botName}`);
    return callBot(entry, prompt);
  }

  const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    // Register the pending request BEFORE producing (no race condition)
    const responsePromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(correlationId);
        reject(new Error(`Timeout waiting for ${botName} response (correlationId=${correlationId})`));
      }, 120_000);

      pendingRequests.set(correlationId, { resolve, reject, timer });
    });

    // Produce to inbox
    const p = await getProducer();
    await p.send({
      topic: entry.inboxTopic,
      messages: [{
        key: correlationId,
        value: JSON.stringify({
          correlationId,
          botName,
          prompt,
          timestamp: new Date().toISOString(),
        }),
      }],
    });

    return await responsePromise;
  } catch (err: any) {
    pendingRequests.delete(correlationId);
    console.warn(`[kafka] Kafka round-trip failed for ${botName}: ${err.message} — falling back to direct call`);
    return callBot(entry, prompt);
  }
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
