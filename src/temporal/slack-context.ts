/**
 * Slack context for Temporal activities.
 * Activities run in the same Node.js process as Foreman, so we share
 * the Bolt app instance and processChannelMessage via module-level singletons.
 * slack.ts calls setSlackApp() and setProcessChannelMessage() on startup.
 */

import type { App } from '@slack/bolt';

export type ProcessChannelResult = {
  result: string;
  sessionId: string;
  cost: number;
  turns: number;
};

type ProcessChannelFn = (
  app: App,
  channel: string,
  text: string,
  requesterId: string,
  imagePaths?: string[],
  onRateLimit?: (retryInMs: number) => void,
  noSlackMcp?: boolean,
) => Promise<ProcessChannelResult>;

let _app: App | null = null;
let _processFn: ProcessChannelFn | null = null;

export function setSlackApp(app: App): void {
  _app = app;
}

export function getSlackApp(): App {
  if (!_app) throw new Error('[Temporal] Slack app not initialized — call setSlackApp() first');
  return _app;
}

export function setProcessChannelMessage(fn: ProcessChannelFn): void {
  _processFn = fn;
}

export function getProcessChannelMessage(): ProcessChannelFn {
  if (!_processFn) throw new Error('[Temporal] processChannelMessage not set — call setProcessChannelMessage() first');
  return _processFn;
}
