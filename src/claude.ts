import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalResult } from "./types.js";
import { AUTO_APPROVE_TOOLS } from "./types.js";
import {
  getState,
  setSessionId,
  setRunning,
  setAbortController,
  getPlugins,
} from "./session.js";

type OnApprovalNeeded = (
  toolName: string,
  input: Record<string, unknown>
) => Promise<ApprovalResult>;

interface QueryResult {
  result: string;
  sessionId: string;
  cost: number;
  turns: number;
}

/**
 * Build the plugins array for the Agent SDK from stored plugin paths.
 */
function buildPluginsOption(channelId: string): { type: "local"; path: string }[] {
  return getPlugins(channelId).map((p) => ({ type: "local" as const, path: p }));
}

/**
 * Start a new Claude session with the given prompt.
 */
export async function startSession(
  channelId: string,
  prompt: string,
  cwd: string,
  name: string,
  onApprovalNeeded: OnApprovalNeeded
): Promise<QueryResult> {
  const abortController = new AbortController();
  setAbortController(channelId, abortController);
  setRunning(channelId, true);

  try {
    const state = getState(channelId);
    const q = query({
      prompt,
      options: {
        model: state.model,
        cwd,
        abortController,

        settingSources: ["user", "project"],
        plugins: buildPluginsOption(channelId),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: `The user communicates with you remotely via a Slack bridge called Foreman. Your name in this channel is ${name}. Introduce yourself as ${name} when relevant.`,
        },
        canUseTool: createCanUseTool(onApprovalNeeded),
        stderr: (data: string) => console.error("[claude stderr]", data),
      },
    });

    return await collectMessages(channelId, q);
  } finally {
    setRunning(channelId, false);
  }
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
  onApprovalNeeded: OnApprovalNeeded
): Promise<QueryResult> {
  const abortController = new AbortController();
  setAbortController(channelId, abortController);
  setRunning(channelId, true);

  try {
    const state = getState(channelId);
    const q = query({
      prompt,
      options: {
        model: state.model,
        resume: sessionId,
        cwd,
        abortController,

        settingSources: ["user", "project"],
        plugins: buildPluginsOption(channelId),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: `The user communicates with you remotely via a Slack bridge called Foreman. Your name in this channel is ${name}. Introduce yourself as ${name} when relevant.`,
        },
        canUseTool: createCanUseTool(onApprovalNeeded),
        stderr: (data: string) => console.error("[claude stderr]", data),
      },
    });

    return await collectMessages(channelId, q);
  } finally {
    setRunning(channelId, false);
  }
}

/**
 * Abort the currently running query for a specific channel.
 */
export function abortCurrentQuery(channelId: string): void {
  const state = getState(channelId);
  if (state.abortController) {
    state.abortController.abort();
  }
}

/**
 * Creates the canUseTool callback for the Agent SDK.
 * Auto-approves read-only tools; delegates mutating tools to onApprovalNeeded.
 */
function createCanUseTool(onApprovalNeeded: OnApprovalNeeded) {
  return async (
    toolName: string,
    input: Record<string, unknown>
  ): Promise<
    | { behavior: "allow"; updatedInput?: Record<string, unknown> }
    | { behavior: "deny"; message: string }
  > => {
    if (AUTO_APPROVE_TOOLS.has(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }

    try {
      const result = await onApprovalNeeded(toolName, input);
      if (result.approved) {
        return {
          behavior: "allow",
          updatedInput: result.updatedInput || input,
        };
      } else {
        return { behavior: "deny", message: "User denied this action via Slack" };
      }
    } catch {
      return { behavior: "deny", message: "Approval request failed" };
    }
  };
}

/**
 * Collect all messages from the query async generator
 * and extract the session ID and final result.
 */
async function collectMessages(channelId: string, q: AsyncIterable<any>): Promise<QueryResult> {
  let resultText = "";
  let sessionId = "";
  let cost = 0;
  let turns = 0;

  for await (const message of q) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
      setSessionId(channelId, sessionId);
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        resultText = message.result;
      } else {
        resultText = `Error (${message.subtype}): ${(message.errors || []).join(", ")}`;
      }
      cost = message.total_cost_usd || 0;
      turns = message.num_turns || 0;
    }
  }

  return { result: resultText, sessionId, cost, turns };
}
