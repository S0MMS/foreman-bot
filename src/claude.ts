import type { McpSdkServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import type { ApprovalResult } from "./types.js";
import { getState } from "./session.js";
import { getAdapter } from "./adapters/index.js";

type OnApprovalNeeded = (
  toolName: string,
  input: Record<string, unknown>
) => Promise<ApprovalResult>;

type OnProgress = (toolName: string, input: Record<string, unknown>) => void;

interface QueryResult {
  result: string;
  sessionId: string;
  cost: number;
  turns: number;
  tokensIn: number;
  tokensOut: number;
}

function buildSystemPrompt(name: string): string {
  return `The user communicates with you remotely via a Slack bridge called Foreman. Your name in this channel is ${name}. Introduce yourself as ${name} when relevant. You have two canvas tools available: CanvasRead (reads this channel's Slack canvas) and CanvasWrite (writes markdown content to the canvas). Use these tools naturally when the user asks you to interact with the canvas. Never attempt to find or modify the Foreman codebase yourself.`;
}

/**
 * Start a new Claude session with the given prompt.
 */
export async function startSession(
  channelId: string,
  prompt: string,
  cwd: string,
  name: string,
  onApprovalNeeded: OnApprovalNeeded,
  onProgress?: OnProgress,
  imagePaths?: string[],
  mcpServer?: McpSdkServerConfig & { instance: any },
  app?: App,
  onRateLimit?: (retryInMs: number) => void,
  noSlackMcp?: boolean,
  systemPromptOverride?: string
): Promise<QueryResult> {
  const state = getState(channelId);
  const adapter = getAdapter(state.adapter ?? "anthropic");
  return adapter.start({
    channelId,
    prompt,
    systemPrompt: systemPromptOverride ?? buildSystemPrompt(name),
    imagePaths,
    mcpServer,
    noSlackMcp,
    app,
    onApprovalNeeded,
    onProgress,
    onRateLimit,
    cwd,
    name,
  });
}

/**
 * Resume an existing Claude session with a new prompt.
 */
export async function resumeSession(
  channelId: string,
  prompt: string,
  sessionId: string,
  cwd: string,
  name: string,
  onApprovalNeeded: OnApprovalNeeded,
  onProgress?: OnProgress,
  imagePaths?: string[],
  mcpServer?: McpSdkServerConfig & { instance: any },
  app?: App,
  onRateLimit?: (retryInMs: number) => void,
  noSlackMcp?: boolean,
  systemPromptOverride?: string
): Promise<QueryResult> {
  const state = getState(channelId);
  const adapter = getAdapter(state.adapter ?? "anthropic");
  return adapter.resume({
    channelId,
    prompt,
    sessionId,
    systemPrompt: systemPromptOverride ?? buildSystemPrompt(name),
    imagePaths,
    mcpServer,
    noSlackMcp,
    app,
    onApprovalNeeded,
    onProgress,
    onRateLimit,
    cwd,
    name,
  });
}

/**
 * Abort the currently running query for a specific channel.
 */
export function abortCurrentQuery(channelId: string): void {
  const state = getState(channelId);
  const adapter = getAdapter(state.adapter ?? "anthropic");
  adapter.abort(channelId);
}
