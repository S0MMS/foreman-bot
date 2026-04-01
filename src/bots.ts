/**
 * bots.ts — Bot Registry
 *
 * Parses bots.yaml and provides the canonical registry of all bot definitions.
 * Everything in Foreman that needs to know about a bot reads from here:
 * - Kafka consumer loop (which topics to create and consume)
 * - SDK adapter selection (which provider/model to use)
 * - foreman ui (bot list in left nav)
 * - FlowSpec dispatcher (resolving @betty to the right runtime)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BotType = 'sdk' | 'webhook' | 'agentcore' | 'human' | 'mock';
export type SdkProvider = 'anthropic' | 'openai' | 'gemini';

interface BotBase {
  type: BotType;
  system_prompt: string;
}

export interface SdkBot extends BotBase {
  type: 'sdk';
  provider: SdkProvider;
  model: string;
}

export interface WebhookBot extends BotBase {
  type: 'webhook';
  url: string;
  headers?: Record<string, string>;
}

export interface AgentCoreBot extends BotBase {
  type: 'agentcore';
  agent_id: string;
  alias_id: string;
}

export interface HumanBot extends BotBase {
  type: 'human';
  slack_user: string;
  timeout_seconds: number;
}

export interface MockBot extends BotBase {
  type: 'mock';
  response: string;
}

export type BotDefinition = SdkBot | WebhookBot | AgentCoreBot | HumanBot | MockBot;

export interface BotEntry {
  name: string;
  definition: BotDefinition;
  inboxTopic: string;
  outboxTopic: string;
}

// ── Registry ──────────────────────────────────────────────────────────────────

let registry: Map<string, BotEntry> | null = null;

function resolveEnvVars(obj: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] || '');
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolveEnvVars(v)]));
  }
  return obj;
}

function validate(name: string, def: any): BotDefinition {
  if (!def.type) throw new Error(`Bot "${name}" is missing required field: type`);
  if (!def.system_prompt) throw new Error(`Bot "${name}" is missing required field: system_prompt`);

  switch (def.type) {
    case 'sdk':
      if (!def.provider) throw new Error(`Bot "${name}" (sdk) is missing required field: provider`);
      if (!def.model) throw new Error(`Bot "${name}" (sdk) is missing required field: model`);
      if (!['anthropic', 'openai', 'gemini'].includes(def.provider))
        throw new Error(`Bot "${name}" has unknown provider: ${def.provider}`);
      return def as SdkBot;

    case 'webhook':
      if (!def.url) throw new Error(`Bot "${name}" (webhook) is missing required field: url`);
      return def as WebhookBot;

    case 'agentcore':
      if (!def.agent_id) throw new Error(`Bot "${name}" (agentcore) is missing required field: agent_id`);
      if (!def.alias_id) throw new Error(`Bot "${name}" (agentcore) is missing required field: alias_id`);
      return def as AgentCoreBot;

    case 'human':
      if (!def.slack_user) throw new Error(`Bot "${name}" (human) is missing required field: slack_user`);
      return def as HumanBot;

    case 'mock':
      if (!def.response) throw new Error(`Bot "${name}" (mock) is missing required field: response`);
      return def as MockBot;

    default:
      throw new Error(`Bot "${name}" has unknown type: ${def.type}`);
  }
}

export function loadBotRegistry(yamlPath?: string): Map<string, BotEntry> {
  const path = yamlPath || join(process.cwd(), 'bots.yaml');

  if (!existsSync(path)) {
    console.warn(`[bots] No bots.yaml found at ${path} — bot registry is empty`);
    return new Map();
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = resolveEnvVars(parse(raw));

  if (!parsed?.bots || typeof parsed.bots !== 'object') {
    throw new Error(`bots.yaml must have a top-level "bots" object`);
  }

  const map = new Map<string, BotEntry>();

  for (const [name, def] of Object.entries(parsed.bots)) {
    const definition = validate(name, def);
    map.set(name, {
      name,
      definition,
      inboxTopic: `${name}.inbox`,
      outboxTopic: `${name}.outbox`,
    });
  }

  console.log(`[bots] Loaded ${map.size} bot(s): ${[...map.keys()].join(', ')}`);
  return map;
}

/** Get the singleton registry (loads once on first call). */
export function getBotRegistry(): Map<string, BotEntry> {
  if (!registry) registry = loadBotRegistry();
  return registry;
}

/** Get a single bot by name. Throws if not found. */
export function getBot(name: string): BotEntry {
  const bot = getBotRegistry().get(name);
  if (!bot) throw new Error(`Unknown bot: "${name}". Is it defined in bots.yaml?`);
  return bot;
}

/** Get all bots as an array. */
export function getAllBots(): BotEntry[] {
  return [...getBotRegistry().values()];
}

/** Get all bots of a specific type. */
export function getBotsByType(type: BotType): BotEntry[] {
  return getAllBots().filter((b) => b.definition.type === type);
}

/** Check if a bot exists by name. */
export function botExists(name: string): boolean {
  return getBotRegistry().has(name);
}

/** Get all Kafka topic names across all bots. */
export function getAllTopics(): string[] {
  return getAllBots().flatMap((b) => [b.inboxTopic, b.outboxTopic]);
}
