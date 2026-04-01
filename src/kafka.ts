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

import { Kafka, Producer, Admin, logLevel } from 'kafkajs';
import { getAllTopics } from './bots.js';

const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:19092').split(',');

let kafka: Kafka | null = null;
let producer: Producer | null = null;

export function getKafkaClient(): Kafka {
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
  return producer;
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
