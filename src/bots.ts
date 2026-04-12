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
import { getRosterOverrides, getCustomFolders } from './roster-overrides.js';
import { listWorkspaces } from './workspaces.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BotType = 'sdk' | 'webhook' | 'agentcore' | 'human' | 'mock';
export type SdkProvider = 'anthropic' | 'openai' | 'gemini';
export type BotTransport = 'mattermost' | 'kafka';

interface BotBase {
  type: BotType;
  system_prompt: string;
  roster?: string;
  transport?: BotTransport;
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
  transport: BotTransport;
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
      transport: (def as any).transport === 'kafka' ? 'kafka' : 'mattermost',
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

/** Force-reload the bot registry from bots.yaml. Returns the new registry size. */
export function reloadBotRegistry(): number {
  registry = loadBotRegistry();
  return registry.size;
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

/** Get the transport for a bot by name. Returns 'mattermost' if bot not found. */
export function getBotTransport(name: string): BotTransport {
  const bot = getBotRegistry().get(name);
  return bot?.transport ?? 'mattermost';
}

/** Get all Kafka topic names across all bots. */
export function getAllTopics(): string[] {
  return getAllBots().flatMap((b) => [b.inboxTopic, b.outboxTopic]);
}

/**
 * Register workspace bots into the global bot registry.
 * Each workspace bot is namespaced as "slug/botname" with matching Kafka topics.
 * Call this at startup after loadBotRegistry().
 */
export function registerWorkspaceBots(): void {
  const reg = getBotRegistry();
  const workspaces = listWorkspaces();
  let count = 0;

  for (const ws of workspaces) {
    for (const bot of ws.bots) {
      const namespacedName = `${ws.slug}/${bot.name}`;

      // Skip if already registered (e.g. after hot reload)
      if (reg.has(namespacedName)) continue;

      const definition: BotDefinition = validate(namespacedName, {
        type: bot.type ?? 'sdk',
        provider: bot.provider ?? 'anthropic',
        model: bot.model ?? 'claude-sonnet-4-6',
        system_prompt: bot.system_prompt ?? `You are ${bot.name}, a bot in the ${ws.name} workspace.`,
      });

      // Kafka doesn't allow '/' in topic names — use '.' as separator
      const topicPrefix = namespacedName.replace(/\//g, '.');
      reg.set(namespacedName, {
        name: namespacedName,
        definition,
        inboxTopic: `${topicPrefix}.inbox`,
        outboxTopic: `${topicPrefix}.outbox`,
        transport: 'mattermost',
      });
      count++;
    }
  }

  if (count > 0) {
    console.log(`[bots] Registered ${count} workspace bot(s): ${[...reg.keys()].filter(k => k.includes('/')).join(', ')}`);
  }
}

// ── Roster Tree ────────────────────────────────────────────────────────────────

export interface RosterNode {
  id: string;
  label: string;
  type: 'folder' | 'bot';
  botName?: string;       // only for type === 'bot'
  botType?: string;       // sdk | mock | webhook etc
  provider?: string | null;
  children?: RosterNode[]; // only for type === 'folder'
}

/**
 * Build a roster tree from the bot registry.
 * - Bots with a `roster` field are placed into folders based on slash-delimited path segments.
 * - Bots without a `roster` field go into a "GENERAL" folder.
 * - The tree is purely recursive with no hardcoded depth limit.
 */
export function getRosterTree(): RosterNode[] {
  const bots = getAllBots();
  const overrides = getRosterOverrides();
  const customFolders = getCustomFolders();

  // folder map: folder id path (e.g. "TECHOPS/Batch-1") → child nodes
  const folderMap = new Map<string, RosterNode[]>();

  // Seed custom (possibly empty) folders first
  for (const folderPath of customFolders) {
    const segments = folderPath.split('/').filter(Boolean);
    for (let i = 1; i <= segments.length; i++) {
      const key = segments.slice(0, i).join('/');
      if (!folderMap.has(key)) folderMap.set(key, []);
    }
  }

  function ensureFolder(pathSegments: string[]): RosterNode[] {
    const key = pathSegments.join('/');
    if (!folderMap.has(key)) {
      folderMap.set(key, []);
    }
    return folderMap.get(key)!;
  }

  function insertBot(pathSegments: string[], botNode: RosterNode): void {
    // Ensure all ancestor folders exist
    for (let i = 1; i <= pathSegments.length; i++) {
      ensureFolder(pathSegments.slice(0, i));
    }
    // Insert the bot into the deepest folder
    ensureFolder(pathSegments).push(botNode);
  }

  for (const bot of bots) {
    const rosterPath = overrides[bot.name] ?? ((bot.definition as any).roster as string | undefined);
    const segments = rosterPath ? rosterPath.split('/').filter(Boolean) : ['GENERAL'];

    const botNode: RosterNode = {
      id: `bot:${bot.name}`,
      label: bot.name,
      type: 'bot',
      botName: bot.name,
      botType: bot.definition.type,
      provider: (bot.definition as any).provider ?? null,
    };

    insertBot(segments, botNode);
  }

  function buildFolderNode(pathSegments: string[]): RosterNode {
    const key = pathSegments.join('/');
    const label = pathSegments[pathSegments.length - 1];
    const directChildren = folderMap.get(key) ?? [];

    // Find sub-folders: keys that are exactly one level deeper than this path
    const subFolderNodes: RosterNode[] = [];
    for (const [k] of folderMap) {
      const parts = k.split('/');
      if (parts.length === pathSegments.length + 1 &&
          parts.slice(0, pathSegments.length).join('/') === key) {
        subFolderNodes.push(buildFolderNode(parts));
      }
    }

    return {
      id: `folder:${key}`,
      label,
      type: 'folder',
      children: [...subFolderNodes, ...directChildren],
    };
  }

  // Find top-level folder keys (segments of length 1)
  const topLevelKeys = new Set<string>();
  for (const [k] of folderMap) {
    topLevelKeys.add(k.split('/')[0]);
  }

  return Array.from(topLevelKeys).map((key) => buildFolderNode([key]));
}
