/**
 * FlowSpec Bot Registry — maps @bot names in .flow files to channel IDs.
 *
 * Config file: config/channel-registry.yaml (in repo root)
 * Format:
 *   slack:
 *     flowbot-01: C0AP5TEMBL2
 *   mattermost:
 *     flowbot-01: w3fkpfdzd38z5fkei3sdabnhyo
 *
 * Bot names are case-insensitive at lookup time. The registry is built as a
 * flat map with transport-prefixed keys for non-Slack transports:
 *   { "flowbot-01": "C0AP5TEMBL2", "mm:flowbot-01": "mm:w3fkpfdzd38z5fkei3sdabnhyo" }
 *
 * This preserves backwards compatibility with resolveBot() in runtime.ts.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

/** Resolve the repo root by walking up from this file's directory. */
function findRepoRoot(): string {
  let dir = join(import.meta.dirname ?? __dirname, '..', '..');
  // Normalize in case we're running from dist/
  if (dir.endsWith('/dist')) {
    dir = dir.slice(0, -5);
  }
  return dir;
}

const REGISTRY_FILENAME = 'config/channel-registry.yaml';

function getRegistryFullPath(): string {
  return join(findRepoRoot(), REGISTRY_FILENAME);
}

export interface BotRegistry {
  [botName: string]: string; // bot name → channel ID (with optional transport prefix)
}

/** Transport key → prefix used in the flat registry. Slack is the default (no prefix). */
const TRANSPORT_PREFIX: Record<string, string> = {
  slack: '',
  mattermost: 'mm:',
};

/**
 * Load the channel registry from config/channel-registry.yaml.
 * Returns a flat map compatible with resolveBot():
 *   { "botName": "slackChannelId", "mm:botName": "mm:mattermostChannelId" }
 */
export function loadBotRegistry(): BotRegistry {
  const fullPath = getRegistryFullPath();
  if (!existsSync(fullPath)) return {};
  try {
    const raw = readFileSync(fullPath, 'utf-8');
    const parsed = parse(raw) as Record<string, Record<string, string>> | null;
    if (!parsed || typeof parsed !== 'object') return {};

    const registry: BotRegistry = {};
    for (const [transport, bots] of Object.entries(parsed)) {
      if (!bots || typeof bots !== 'object') continue;
      const prefix = TRANSPORT_PREFIX[transport] ?? `${transport}:`;
      for (const [botName, channelId] of Object.entries(bots)) {
        if (prefix) {
          registry[`${prefix}${botName}`] = `${prefix}${channelId}`;
        } else {
          // Slack (default) — no prefix
          registry[botName] = channelId;
        }
      }
    }
    return registry;
  } catch {
    return {};
  }
}

/** Save is no longer supported — edit config/channel-registry.yaml directly. */
export function saveBotRegistry(_registry: BotRegistry): void {
  throw new Error(
    'saveBotRegistry() is deprecated. Edit config/channel-registry.yaml directly.'
  );
}

/** Get the registry file path (for display in commands). */
export function getRegistryPath(): string {
  return getRegistryFullPath();
}
