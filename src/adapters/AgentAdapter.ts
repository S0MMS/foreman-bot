import type { McpSdkServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import type { ApprovalResult } from "../types.js";

export type OnApprovalNeeded = (
  toolName: string,
  input: Record<string, unknown>
) => Promise<ApprovalResult>;

export type OnProgress = (toolName: string, input: Record<string, unknown>) => void;

export type OnMessage = (message: any) => void;

export interface AgentOptions {
  channelId: string;
  prompt: string;
  systemPrompt: string;
  imagePaths?: string[];
  mcpServer?: McpSdkServerConfig & { instance: any };
  noSlackMcp?: boolean;
  app?: App;
  onMessage?: OnMessage;
  onProgress?: OnProgress;
  onRateLimit?: (retryInMs: number) => void;
  onApprovalNeeded: OnApprovalNeeded;
  onSessionId?: (sessionId: string) => void;
  abortController?: AbortController;
}

export interface QueryResult {
  result: string;
  sessionId: string;
  cost: number;
  turns: number;
  tokensIn: number;
  tokensOut: number;
}

export interface AgentAdapter {
  start(options: AgentOptions & { cwd: string; name: string }): Promise<QueryResult>;
  resume(options: AgentOptions & { sessionId: string; cwd: string; name: string }): Promise<QueryResult>;
  abort(channelId: string): void;
}
