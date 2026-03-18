import { query, type McpSdkServerConfig } from "@anthropic-ai/claude-agent-sdk";
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

type OnProgress = (toolName: string, input: Record<string, unknown>) => void;

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
 * Build the prompt string, appending image file paths when present.
 * Claude Code will read the files using its Read tool (auto-approved).
 */
function buildPrompt(text: string, imagePaths: string[]): string {
  if (imagePaths.length === 0) return text;
  const note = `Please use the Read tool to view the following image(s) before responding:\n` +
    imagePaths.map((p) => `- ${p}`).join("\n");
  return text ? `${text}\n\n${note}` : note;
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
  mcpServer?: McpSdkServerConfig & { instance: any }
): Promise<QueryResult> {
  const abortController = new AbortController();
  setAbortController(channelId, abortController);
  setRunning(channelId, true);

  const stderrLines: string[] = [];

  try {
    const state = getState(channelId);
    const q = query({
      prompt: buildPrompt(prompt, imagePaths || []),
      options: {
        model: state.model,
        cwd,
        abortController,

        settingSources: ["user", "project"],
        plugins: buildPluginsOption(channelId),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: `The user communicates with you remotely via a Slack bridge called Foreman. Your name in this channel is ${name}. Introduce yourself as ${name} when relevant. You have two canvas tools available: CanvasRead (reads this channel's Slack canvas) and CanvasWrite (writes markdown content to the canvas). Use these tools naturally when the user asks you to interact with the canvas. Never attempt to find or modify the Foreman codebase yourself.`,
        },
        canUseTool: createCanUseTool(onApprovalNeeded),
        mcpServers: mcpServer ? { "foreman-canvas": mcpServer as any } : undefined,
        hooks: onProgress ? { PreToolUse: buildProgressHooks(onProgress) } : undefined,
        stderr: (data: string) => {
          console.error("[claude stderr]", data);
          stderrLines.push(data.trim());
        },
      },
    });

    return await collectMessages(channelId, q);
  } catch (err) {
    const detail = stderrLines.length > 0 ? `\nstderr: ${stderrLines.slice(-3).join(" | ")}` : "";
    throw new Error(`${err instanceof Error ? err.message : String(err)}${detail}`);
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
  onApprovalNeeded: OnApprovalNeeded,
  onProgress?: OnProgress,
  imagePaths?: string[],
  mcpServer?: McpSdkServerConfig & { instance: any }
): Promise<QueryResult> {
  const abortController = new AbortController();
  setAbortController(channelId, abortController);
  setRunning(channelId, true);

  const stderrLines: string[] = [];

  try {
    const state = getState(channelId);
    const q = query({
      prompt: buildPrompt(prompt, imagePaths || []),
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
          append: `The user communicates with you remotely via a Slack bridge called Foreman. Your name in this channel is ${name}. Introduce yourself as ${name} when relevant. You have two canvas tools available: CanvasRead (reads this channel's Slack canvas) and CanvasWrite (writes markdown content to the canvas). Use these tools naturally when the user asks you to interact with the canvas. Never attempt to find or modify the Foreman codebase yourself.`,
        },
        canUseTool: createCanUseTool(onApprovalNeeded),
        mcpServers: mcpServer ? { "foreman-canvas": mcpServer as any } : undefined,
        hooks: onProgress ? { PreToolUse: buildProgressHooks(onProgress) } : undefined,
        stderr: (data: string) => {
          console.error("[claude stderr]", data);
          stderrLines.push(data.trim());
        },
      },
    });

    return await collectMessages(channelId, q);
  } catch (err) {
    const detail = stderrLines.length > 0 ? `\nstderr: ${stderrLines.slice(-3).join(" | ")}` : "";
    throw new Error(`${err instanceof Error ? err.message : String(err)}${detail}`);
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
    const baseName = toolName.replace(/^mcp__[^_]+__/, "");
    if (AUTO_APPROVE_TOOLS.has(toolName) || AUTO_APPROVE_TOOLS.has(baseName)) {
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
 * Builds PreToolUse hooks that fire onProgress for auto-approved tools.
 */
function buildProgressHooks(onProgress: OnProgress) {
  const makeHook = (toolName: string) => async (input: any) => {
    onProgress(toolName, input?.tool_input || input?.input || {});
    return {};
  };
  return Array.from(AUTO_APPROVE_TOOLS).map((toolName) => ({
    matcher: toolName,
    hooks: [makeHook(toolName)],
  }));
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
