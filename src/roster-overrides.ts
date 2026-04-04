/**
 * roster-overrides.ts — UI-driven roster placement overrides
 *
 * Stores bot→folder mappings in ~/.foreman/roster-overrides.json.
 * bots.yaml is never modified. Overrides take precedence over the
 * roster: field in bots.yaml at render time.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const OVERRIDES_PATH = join(homedir(), '.foreman', 'roster-overrides.json');

interface OverridesFile {
  _folders?: string[];
  [botName: string]: string | string[] | undefined;
}

function readOverrides(): OverridesFile {
  if (!existsSync(OVERRIDES_PATH)) return {};
  try {
    return JSON.parse(readFileSync(OVERRIDES_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeOverrides(data: OverridesFile): void {
  writeFileSync(OVERRIDES_PATH, JSON.stringify(data, null, 2));
}

/** Returns the full overrides map: botName → folder path string */
export function getRosterOverrides(): Record<string, string> {
  const data = readOverrides();
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k !== '_folders' && typeof v === 'string') result[k] = v;
  }
  return result;
}

/** Persist a bot's folder assignment */
export function setRosterOverride(botName: string, folder: string): void {
  const data = readOverrides();
  data[botName] = folder;
  writeOverrides(data);
}

/** Returns custom folders created via the UI (may be empty) */
export function getCustomFolders(): string[] {
  const data = readOverrides();
  return Array.isArray(data._folders) ? data._folders : [];
}

/** Add a custom folder (no-op if it already exists) */
export function addCustomFolder(folderPath: string): void {
  const data = readOverrides();
  const folders = Array.isArray(data._folders) ? data._folders : [];
  if (!folders.includes(folderPath)) {
    data._folders = [...folders, folderPath];
    writeOverrides(data);
  }
}

/** Remove a custom folder */
export function removeCustomFolder(folderPath: string): void {
  const data = readOverrides();
  data._folders = (Array.isArray(data._folders) ? data._folders : []).filter(f => f !== folderPath);
  writeOverrides(data);
}
