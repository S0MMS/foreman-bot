/**
 * FlowSpec Bot Registry — maps @bot names in .flow files to Slack channel IDs.
 *
 * Config file: ~/.foreman/bots.json
 * Format:
 * {
 *   "writer":   "C0ABC123",
 *   "reviewer":  "C0DEF456",
 *   "general":   "C0GHI789"
 * }
 *
 * Bot names are case-insensitive. Channel names (without #) can also be
 * used as values — they'll be resolved to IDs at runtime.
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const REGISTRY_PATH = join(homedir(), '.foreman', 'bots.json');

export interface BotRegistry {
  [botName: string]: string; // bot name → channel ID or channel name
}

/** Load the bot registry from ~/.foreman/bots.json. Returns empty object if missing. */
export function loadBotRegistry(): BotRegistry {
  if (!existsSync(REGISTRY_PATH)) return {};
  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Save the bot registry to ~/.foreman/bots.json. */
export function saveBotRegistry(registry: BotRegistry): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
}

/** Get the registry file path (for display in commands). */
export function getRegistryPath(): string {
  return REGISTRY_PATH;
}
