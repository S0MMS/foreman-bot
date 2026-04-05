/**
 * bot-status.ts — In-memory bot status tracking
 *
 * Tracks online/busy/offline status per bot. Emits change events
 * so the UI can push real-time status updates via SSE.
 */

export type BotStatus = 'online' | 'busy' | 'offline';

type StatusListener = (botName: string, status: BotStatus) => void;

const statuses = new Map<string, BotStatus>();
const listeners: StatusListener[] = [];

/** Get the current status of a bot (defaults to 'offline'). */
export function getBotStatus(botName: string): BotStatus {
  return statuses.get(botName) ?? 'offline';
}

/** Get all bot statuses as a plain object. */
export function getAllBotStatuses(): Record<string, BotStatus> {
  const result: Record<string, BotStatus> = {};
  for (const [name, status] of statuses) {
    result[name] = status;
  }
  return result;
}

/** Set a bot's status and notify listeners if it changed. */
export function setBotStatus(botName: string, status: BotStatus): void {
  const prev = statuses.get(botName);
  if (prev === status) return;
  statuses.set(botName, status);
  for (const listener of listeners) {
    try { listener(botName, status); } catch { /* swallow */ }
  }
}

/** Register a listener for status changes. Returns an unsubscribe function. */
export function onBotStatusChange(listener: StatusListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
