import { AnthropicAdapter } from "./AnthropicAdapter.js";
import { OpenAIAdapter } from "./OpenAIAdapter.js";
import type { AgentAdapter } from "./AgentAdapter.js";

const adapters: Record<string, AgentAdapter> = {
  anthropic: new AnthropicAdapter(),
  openai: new OpenAIAdapter(),
};

export function getAdapter(name: string): AgentAdapter {
  return adapters[name] ?? adapters["anthropic"];
}
