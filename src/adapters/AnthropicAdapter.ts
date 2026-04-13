import { query } from "@anthropic-ai/claude-agent-sdk";
import { AUTO_APPROVE_TOOLS } from "../types.js";
import {
  getState,
  setSessionId,
  setRunning,
  setAbortController,
  getPlugins,
} from "../session.js";
import type { AgentAdapter, AgentOptions, QueryResult } from "./AgentAdapter.js";

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
  const note =
    `Please use the Read tool to view the following image(s) before responding:\n` +
    imagePaths.map((p) => `- ${p}`).join("\n");
  return text ? `${text}\n\n${note}` : note;
}

/**
 * Creates the canUseTool callback for the Agent SDK.
 * Auto-approves read-only tools; delegates mutating tools to onApprovalNeeded.
 */
function createCanUseTool(
  channelId: string,
  onApprovalNeeded: AgentOptions["onApprovalNeeded"]
) {
  return async (
    toolName: string,
    input: Record<string, unknown>
  ): Promise<
    | { behavior: "allow"; updatedInput?: Record<string, unknown> }
    | { behavior: "deny"; message: string }
  > => {
    if (getState(channelId).autoApprove) {
      return { behavior: "allow", updatedInput: input };
    }
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
function buildProgressHooks(onProgress: AgentOptions["onProgress"]) {
  if (!onProgress) return [];
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
 * Build the mcpServers record, combining foreman-toolbelt with any
 * user-level MCP servers (like the official Slack MCP).
 */
function buildMcpServers(
  canvasMcp?: AgentOptions["mcpServer"],
  noSlackMcp?: boolean
): Record<string, any> | undefined {
  const servers: Record<string, any> = {};

  if (canvasMcp) {
    servers["foreman-toolbelt"] = canvasMcp;
  }

  // Include the official Slack MCP (authenticated via Claude Code's OAuth proxy).
  // Disabled for focused sessions like Delphi where it adds noise and distracts from code research.
  if (!noSlackMcp) {
    servers["slack"] = {
      type: "claudeai-proxy",
      url: "https://mcp.slack.com/mcp",
      id: "slack",
    };
  }

  return Object.keys(servers).length > 0 ? servers : undefined;
}

/**
 * Collect all messages from the query async generator
 * and extract the session ID and final result.
 */
async function collectMessages(
  channelId: string,
  q: AsyncIterable<any>,
  onSessionId?: (sessionId: string) => void
): Promise<QueryResult> {
  let resultText = "";
  let sessionId = "";
  let cost = 0;
  let turns = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  for await (const message of q) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
      setSessionId(channelId, sessionId);
      if (onSessionId) {
        onSessionId(sessionId);
      }
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        resultText = message.result;
      } else {
        resultText = `Error (${message.subtype}): ${(message.errors || []).join(", ")}`;
      }
      cost = message.total_cost_usd || 0;
      turns = message.num_turns || 0;
      tokensIn = message.usage?.input_tokens || 0;
      tokensOut = message.usage?.output_tokens || 0;
    }
  }

  return { result: resultText, sessionId, cost, turns, tokensIn, tokensOut };
}

export class AnthropicAdapter implements AgentAdapter {
  async start(
    options: AgentOptions & { cwd: string; name: string }
  ): Promise<QueryResult> {
    const {
      channelId,
      prompt,
      systemPrompt,
      imagePaths,
      mcpServer,
      onProgress,
      onApprovalNeeded,
      onSessionId,
      cwd,
      name,
    } = options;

    const abortController = options.abortController ?? new AbortController();
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
            append: systemPrompt,
          },
          canUseTool: createCanUseTool(channelId, onApprovalNeeded),
          mcpServers: buildMcpServers(mcpServer, options.noSlackMcp),
          hooks: onProgress ? { PreToolUse: buildProgressHooks(onProgress) } : undefined,
          stderr: (data: string) => {
            console.error("[claude stderr]", data);
            stderrLines.push(data.trim());
          },
        },
      });

      return await collectMessages(channelId, q, onSessionId);
    } catch (err) {
      const detail =
        stderrLines.length > 0
          ? `\nstderr: ${stderrLines.slice(-3).join(" | ")}`
          : "";
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}${detail}`
      );
    } finally {
      setRunning(channelId, false);
    }
  }

  async resume(
    options: AgentOptions & { sessionId: string; cwd: string; name: string }
  ): Promise<QueryResult> {
    const {
      channelId,
      prompt,
      systemPrompt,
      imagePaths,
      mcpServer,
      onProgress,
      onApprovalNeeded,
      onSessionId,
      sessionId,
      cwd,
    } = options;

    const abortController = options.abortController ?? new AbortController();
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
            append: systemPrompt,
          },
          canUseTool: createCanUseTool(channelId, onApprovalNeeded),
          mcpServers: buildMcpServers(mcpServer, options.noSlackMcp),
          hooks: onProgress ? { PreToolUse: buildProgressHooks(onProgress) } : undefined,
          stderr: (data: string) => {
            console.error("[claude stderr]", data);
            stderrLines.push(data.trim());
          },
        },
      });

      return await collectMessages(channelId, q, onSessionId);
    } catch (err) {
      const detail =
        stderrLines.length > 0
          ? `\nstderr: ${stderrLines.slice(-3).join(" | ")}`
          : "";
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}${detail}`
      );
    } finally {
      setRunning(channelId, false);
    }
  }

  abort(channelId: string): void {
    const state = getState(channelId);
    if (state.abortController) {
      state.abortController.abort();
    }
  }
}
