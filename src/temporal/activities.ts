/**
 * Temporal Activities — the actual work units.
 * Activities run in the Node.js environment and can call external APIs,
 * talk to Slack, run Foreman bots, etc.
 */

import { Context } from '@temporalio/activity';
import { getSlackApp, getProcessChannelMessage } from './slack-context.js';

const POLL_MS = 5_000;

const isWorkerDone = (m: any) =>
  m.text && /^_Done in \d+/.test((m.text as string).trim());

const isMetaMsg = (text: string) =>
  /^_Done in \d+/.test(text.trim()) || /^_[^\n]*_$/.test(text.trim());

// ── Hello ─────────────────────────────────────────────────────────────────────

export async function greet(name: string): Promise<string> {
  return `Hello ${name}!`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Post a status message to a Slack channel. */
export async function postStatus(channelId: string, text: string): Promise<void> {
  const app = getSlackApp();
  await app.client.chat.postMessage({ channel: channelId, text });
}

/**
 * Capture the current epoch in seconds with a 60s clock-skew buffer.
 * Call this immediately before dispatching messages so timestamps are stable.
 */
export async function getEpochSec(): Promise<number> {
  return (Date.now() - 60_000) / 1000;
}

/**
 * Post Delphi completion banner with elapsed time.
 * startEpochMs is captured at workflow start using real wall-clock time
 * (from this activity, not workflow context).
 */
export async function postCompletion(channelId: string, startEpochMs: number): Promise<void> {
  const app = getSlackApp();
  const elapsedSec = Math.round((Date.now() - startEpochMs) / 1000);
  const elapsedStr =
    elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
  await app.client.chat.postMessage({
    channel: channelId,
    text: `_Delphi complete in ${elapsedStr}_`,
  });
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Post a prompt to a channel and start its Claude session (fire-and-forget).
 * Returns immediately — use waitForWorkers/waitForJudge to poll for completion.
 */
export async function runClaudeInChannel(
  channelId: string,
  prompt: string,
  reportChannelId: string,
): Promise<void> {
  const app = getSlackApp();
  const processChannelMessage = getProcessChannelMessage();
  await app.client.chat.postMessage({ channel: channelId, text: prompt });
  processChannelMessage(
    app,
    channelId,
    prompt,
    '',
    [],
    (retryInMs: number) => {
      const secs = Math.round(retryInMs / 1000);
      app.client.chat
        .postMessage({
          channel: reportChannelId,
          text: `:hourglass: *<#${channelId}>* rate limited — retrying in ${secs}s...`,
        })
        .catch(() => {});
    },
    true, // noSlackMcp
  ).catch((err: any) => {
    app.client.chat
      .postMessage({
        channel: reportChannelId,
        text: `:x: <#${channelId}> error: ${err instanceof Error ? err.message : String(err)}`,
      })
      .catch(() => {});
  });
  // fire-and-forget — poll for completion with waitForWorkers / waitForJudge
}

// ── Polling ───────────────────────────────────────────────────────────────────

/** Poll all worker channels until each posts a "Done in N turns" message. */
export async function waitForWorkers(
  workerIds: string[],
  afterEpochSec: number,
  mode: string,
  deep: boolean,
): Promise<void> {
  const app = getSlackApp();
  const PHASE_TIMEOUT = deep ? 20 * 60_000 : mode !== 'code' ? 10 * 60_000 : 5 * 60_000;
  await Promise.allSettled(
    workerIds.map(async (wId) => {
      const deadline = Date.now() + PHASE_TIMEOUT;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        Context.current().heartbeat(wId);
        try {
          const hist = await app.client.conversations.history({ channel: wId, limit: 10 });
          const done = (hist.messages || []).some(
            (m: any) => m.bot_id && parseFloat(m.ts) > afterEpochSec && isWorkerDone(m),
          );
          if (done) return;
        } catch {
          /* ignore */
        }
      }
    }),
  );
}

/** Poll the judge channel until it posts a "Done in N turns" message. */
export async function waitForJudge(
  judgeChannelId: string,
  afterEpochSec: number,
): Promise<void> {
  const app = getSlackApp();
  const JUDGE_TIMEOUT = 10 * 60_000;
  const deadline = Date.now() + JUDGE_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    Context.current().heartbeat(judgeChannelId);
    try {
      const hist = await app.client.conversations.history({ channel: judgeChannelId, limit: 10 });
      const done = (hist.messages || []).some(
        (m: any) => m.bot_id && parseFloat(m.ts) > afterEpochSec && isWorkerDone(m),
      );
      if (done) return;
    } catch {
      /* ignore */
    }
  }
}

// ── Collection ────────────────────────────────────────────────────────────────

/** Collect non-meta bot messages from multiple worker channels since a given epoch. */
export async function collectWorkerMessages(
  workerIds: string[],
  afterEpochSec: number,
): Promise<Array<{ channelId: string; text: string }>> {
  const app = getSlackApp();
  const results: Array<{ channelId: string; text: string }> = [];
  for (const wId of workerIds) {
    try {
      const hist = await app.client.conversations.history({ channel: wId, limit: 50 });
      const msgs = ((hist as any).messages || [])
        .filter(
          (m: any) =>
            m.bot_id &&
            parseFloat(m.ts) > afterEpochSec &&
            !isWorkerDone(m) &&
            !isMetaMsg(m.text || ''),
        )
        .reverse()
        .map((m: any) => m.text as string);
      if (msgs.length > 0) results.push({ channelId: wId, text: msgs.join('\n\n') });
    } catch {
      /* ignore */
    }
  }
  return results;
}

/** Collect non-meta bot messages from the judge channel since a given epoch. */
export async function collectJudgeMessage(
  judgeChannelId: string,
  afterEpochSec: number,
): Promise<string> {
  const app = getSlackApp();
  try {
    const hist = await app.client.conversations.history({ channel: judgeChannelId, limit: 50 });
    const msgs = ((hist as any).messages || [])
      .filter(
        (m: any) =>
          m.bot_id &&
          parseFloat(m.ts) > afterEpochSec &&
          !isWorkerDone(m) &&
          !isMetaMsg(m.text || ''),
      )
      .reverse()
      .map((m: any) => m.text as string);
    return msgs.join('\n\n');
  } catch {
    return '';
  }
}
