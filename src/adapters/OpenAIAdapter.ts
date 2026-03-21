import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { readConfig } from "../config.js";
import { getState, setRunning, setAbortController } from "../session.js";
import type { AgentAdapter, AgentOptions, QueryResult } from "./AgentAdapter.js";

// Tool definitions in OpenAI function-calling schema
const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "ReadFile",
      description: "Read the full contents of a file. Use absolute paths or paths relative to the working directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or cwd-relative path to the file." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "WriteFile",
      description: "Write content to a file, creating it (and any parent directories) if it does not exist, or overwriting it if it does.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or cwd-relative path to the file." },
          content: { type: "string", description: "The full content to write to the file." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ListFiles",
      description: "List files matching a glob pattern. Use this to explore directory structure or find files by name.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. 'src/**/*.ts', '*.json'). Relative to cwd." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "SearchFiles",
      description: "Search file contents for a regex pattern. Returns matching lines with file path and line number.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for." },
          path: { type: "string", description: "Directory or file to search in. Defaults to cwd." },
          glob: { type: "string", description: "Optional glob to filter files (e.g. '*.ts')." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "RunBash",
      description: "Run a shell command and return stdout and stderr. Use for git commands, running tests, installing dependencies, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "EditFile",
      description: "Replace an exact string in a file with a new string. The old_string must match exactly (including whitespace and indentation). Fails if old_string is not found or matches more than once.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or cwd-relative path to the file." },
          old_string: { type: "string", description: "The exact string to find and replace." },
          new_string: { type: "string", description: "The string to replace it with." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
];

// Tools that require user approval before executing
const APPROVAL_REQUIRED = new Set(["WriteFile", "EditFile", "RunBash"]);

// Execute a tool call and return the result as a string
function executeTool(name: string, args: Record<string, unknown>, cwd: string): string {
  if (name === "ReadFile") {
    const path = args.path as string;
    try {
      const resolved = path.startsWith("/") ? path : resolve(cwd, path);
      return readFileSync(resolved, "utf8");
    } catch (err) {
      return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "WriteFile") {
    const path = args.path as string;
    const content = args.content as string;
    try {
      const resolved = path.startsWith("/") ? path : resolve(cwd, path);
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, content, "utf8");
      return `File written: ${resolved}`;
    } catch (err) {
      return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "EditFile") {
    const path = args.path as string;
    const oldString = args.old_string as string;
    const newString = args.new_string as string;
    try {
      const resolved = path.startsWith("/") ? path : resolve(cwd, path);
      const content = readFileSync(resolved, "utf8");
      const count = content.split(oldString).length - 1;
      if (count === 0) return `Error: old_string not found in ${resolved}`;
      if (count > 1) return `Error: old_string matched ${count} times — must be unique`;
      writeFileSync(resolved, content.replace(oldString, newString), "utf8");
      return `File edited: ${resolved}`;
    } catch (err) {
      return `Error editing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "ListFiles") {
    const pattern = args.pattern as string;
    try {
      const output = execSync(`find . -path "./${pattern}" -o -path "${pattern}" 2>/dev/null | sort`, {
        cwd,
        encoding: "utf8",
        timeout: 15000,
      });
      return output.trim() || "(no files matched)";
    } catch (err) {
      return `Error listing files: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "SearchFiles") {
    const pattern = args.pattern as string;
    const searchPath = args.path ? resolve(cwd, args.path as string) : cwd;
    const fileGlob = args.glob as string | undefined;
    try {
      const globArg = fileGlob ? `--glob "${fileGlob}"` : "";
      const output = execSync(`rg --line-number ${globArg} "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null || true`, {
        encoding: "utf8",
        timeout: 15000,
      });
      return output.trim() || "(no matches)";
    } catch (err) {
      return `Error searching files: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "RunBash") {
    const command = args.command as string;
    try {
      const output = execSync(command, { cwd, encoding: "utf8", timeout: 5 * 60 * 1000, stdio: ["pipe", "pipe", "pipe"] });
      return output || "(no output)";
    } catch (err: any) {
      const stdout = err.stdout || "";
      const stderr = err.stderr || "";
      return [stdout, stderr].filter(Boolean).join("\n") || `Error: ${err.message}`;
    }
  }
  return `Unknown tool: ${name}`;
}

/**
 * OpenAIAdapter — chat completions with an agentic tool loop.
 * Maintains per-channel conversation history in memory.
 */
export class OpenAIAdapter implements AgentAdapter {
  private histories = new Map<string, OpenAI.Chat.ChatCompletionMessageParam[]>();

  private getClient(): OpenAI {
    const config = readConfig();
    const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key not configured. Add `openaiApiKey` to ~/.foreman/config.json");
    return new OpenAI({ apiKey });
  }

  async start(options: AgentOptions & { cwd: string; name: string }): Promise<QueryResult> {
    this.histories.set(options.channelId, []);
    return this.chat(options);
  }

  async resume(options: AgentOptions & { sessionId: string; cwd: string; name: string }): Promise<QueryResult> {
    return this.chat(options);
  }

  abort(channelId: string): void {
    const state = getState(channelId);
    if (state.abortController) {
      state.abortController.abort();
    }
  }

  private async chat(options: AgentOptions & { cwd: string; name: string }): Promise<QueryResult> {
    const { channelId, prompt, systemPrompt, onMessage, onProgress, onApprovalNeeded, abortController, cwd } = options;

    setRunning(channelId, true);
    if (abortController) setAbortController(channelId, abortController);

    try {
      const client = this.getClient();
      const state = getState(channelId);
      const model = (state.model && !state.model.startsWith("claude-")) ? state.model : "o4-mini";

      if (!this.histories.has(channelId)) {
        this.histories.set(channelId, []);
      }
      const history = this.histories.get(channelId)!;
      history.push({ role: "user", content: prompt });

      let finalText = "";
      let turns = 0;

      // Agentic loop: run → tool calls → run → ... → final response
      while (true) {
        if (abortController?.signal.aborted) break;
        turns++;

        const response = await client.chat.completions.create({
          model,
          messages: [{ role: "system", content: systemPrompt }, ...history],
          tools: TOOLS,
          tool_choice: "auto",
        });

        const message = response.choices[0].message;
        history.push(message);

        // No tool calls — we have the final answer
        if (!message.tool_calls?.length) {
          finalText = message.content || "";
          break;
        }

        // Execute each tool call and feed results back
        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== "function") continue;
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

          let result: string;
          if (APPROVAL_REQUIRED.has(toolName)) {
            const approval = await onApprovalNeeded(toolName, toolArgs);
            if (!approval.approved) {
              result = "User denied this action.";
            } else {
              result = executeTool(toolName, toolArgs, cwd);
            }
          } else {
            if (onProgress) onProgress(toolName, toolArgs);
            result = executeTool(toolName, toolArgs, cwd);
          }

          history.push({ role: "tool", tool_call_id: toolCall.id, content: result });
        }
      }

      if (onMessage && finalText) {
        onMessage({ type: "text", text: finalText });
      }

      return { result: finalText, sessionId: channelId, cost: 0, turns };
    } finally {
      setRunning(channelId, false);
      setAbortController(channelId, null);
    }
  }
}
