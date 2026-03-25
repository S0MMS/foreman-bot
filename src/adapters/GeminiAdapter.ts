import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content, FunctionDeclaration, Tool } from "@google/generative-ai";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { readConfig } from "../config.js";
import { getState, setRunning, setAbortController } from "../session.js";
import type { AgentAdapter, AgentOptions, QueryResult } from "./AgentAdapter.js";
import { TOOLS, APPROVAL_REQUIRED, executeTool } from "./OpenAIAdapter.js";

// Persist Gemini conversation histories across reboots
const HISTORIES_FILE = join(homedir(), ".foreman", "gemini-histories.json");
const MAX_HISTORY_MESSAGES = 200;

function loadHistoriesFromDisk(): Map<string, Content[]> {
  const map = new Map<string, Content[]>();
  try {
    const data = JSON.parse(readFileSync(HISTORIES_FILE, "utf8")) as Record<string, Content[]>;
    for (const [k, v] of Object.entries(data)) map.set(k, v);
  } catch { /* no file yet */ }
  return map;
}

function saveHistoriesToDisk(histories: Map<string, Content[]>): void {
  try {
    mkdirSync(join(homedir(), ".foreman"), { recursive: true });
    const obj: Record<string, Content[]> = {};
    for (const [k, v] of histories) obj[k] = v.slice(-MAX_HISTORY_MESSAGES);
    writeFileSync(HISTORIES_FILE, JSON.stringify(obj));
  } catch { /* ignore */ }
}

// Convert OpenAI tool definitions to Gemini FunctionDeclarations
function toGeminiTools(): Tool[] {
  const declarations: FunctionDeclaration[] = TOOLS
    .filter((t): t is { type: "function"; function: { name: string; description?: string; parameters?: any } } => t.type === "function")
    .map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as any,
    }));
  return [{ functionDeclarations: declarations }];
}

const GEMINI_TOOLS = toGeminiTools();

export class GeminiAdapter implements AgentAdapter {
  private histories: Map<string, Content[]> = loadHistoriesFromDisk();

  private getClient(): GoogleGenerativeAI {
    const config = readConfig();
    const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API key not configured. Add `geminiApiKey` to ~/.foreman/config.json");
    return new GoogleGenerativeAI(apiKey);
  }

  async start(options: AgentOptions & { cwd: string; name: string }): Promise<QueryResult> {
    this.histories.set(options.channelId, []);
    saveHistoriesToDisk(this.histories);
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
    const { channelId, prompt, systemPrompt, onProgress, onRateLimit, onApprovalNeeded, abortController, cwd, app } = options;

    setRunning(channelId, true);
    if (abortController) setAbortController(channelId, abortController);

    try {
      const genAI = this.getClient();
      const state = getState(channelId);

      // Use the channel model if it looks like a Gemini model, else default
      const model = (state.model && !state.model.startsWith("claude-") && !state.model.startsWith("gpt") && !state.model.startsWith("o"))
        ? state.model
        : "gemini-2.0-flash";

      const generativeModel = genAI.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
        tools: GEMINI_TOOLS,
      });

      if (!this.histories.has(channelId)) {
        this.histories.set(channelId, []);
      }

      // Build chat from persisted history (exclude the last user turn — we send it fresh)
      const history = this.histories.get(channelId)!;
      const chat = generativeModel.startChat({ history });

      // Retry wrapper for 429 rate-limit errors. Parses Google's suggested delay,
      // notifies the caller via onRateLimit, then waits before retrying.
      const sendWithRetry = async (message: string | any[]): Promise<any> => {
        const MAX_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            return await chat.sendMessage(message);
          } catch (err: any) {
            const is429 = String(err?.message || "").includes("429");
            if (is429 && attempt < MAX_RETRIES - 1) {
              const delayMatch = String(err.message).match(/retryDelay['":\s]+(\d+(?:\.\d+)?)s/);
              const retryMs = delayMatch ? Math.ceil(parseFloat(delayMatch[1])) * 1000 + 1000 : 60_000;
              onRateLimit?.(retryMs);
              await new Promise(r => setTimeout(r, retryMs));
              continue;
            }
            throw err;
          }
        }
      };

      let finalText = "";
      let turns = 0;
      let currentMessage: string | any[] = prompt;

      // Agentic loop
      while (true) {
        if (abortController?.signal.aborted) break;
        turns++;

        const response = await sendWithRetry(currentMessage);
        const candidate = response.response.candidates?.[0];
        if (!candidate || !candidate.content) {
          // Blocked or empty response — use promptFeedback text if available
          finalText = (response.response as any).text?.() || "";
          break;
        }

        const parts: any[] = candidate.content.parts ?? [];
        const functionCalls = parts.filter((p) => p.functionCall);
        const textParts = parts.filter((p) => p.text).map((p) => p.text || "");

        if (functionCalls.length === 0) {
          // No tool calls — final response
          finalText = textParts.join("").trim();
          break;
        }

        // Execute tool calls and collect responses
        const toolResponses: any[] = [];
        for (const part of functionCalls) {
          const { name, args: toolArgs } = part.functionCall!;
          const argMap = (toolArgs || {}) as Record<string, unknown>;

          let result: string;
          if (APPROVAL_REQUIRED.has(name) && !getState(channelId).autoApprove) {
            const approval = await onApprovalNeeded(name, argMap);
            if (!approval.approved) {
              result = "User denied this action.";
            } else {
              result = await executeTool(name, argMap, cwd, channelId, app);
            }
          } else {
            if (onProgress) onProgress(name, argMap);
            result = await executeTool(name, argMap, cwd, channelId, app);
          }

          toolResponses.push({
            functionResponse: {
              name,
              response: { output: result },
            },
          });
        }

        // Feed all tool results back in one message
        currentMessage = toolResponses;
      }

      // Persist the full history from the chat session
      const updatedHistory = await chat.getHistory();
      this.histories.set(channelId, updatedHistory.slice(-MAX_HISTORY_MESSAGES));
      saveHistoriesToDisk(this.histories);

      return { result: finalText, sessionId: channelId, cost: 0, turns };
    } finally {
      setRunning(channelId, false);
      setAbortController(channelId, null);
    }
  }
}
