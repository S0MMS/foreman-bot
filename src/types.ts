export interface SessionState {
  sessionId: string | null;
  name: string | null;
  cwd: string;
  model: string;
  plugins: string[];
  isRunning: boolean;
  abortController: AbortController | null;
  pendingApproval: PendingApproval | null;
}

export const MODEL_ALIASES: Record<string, string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface PendingApproval {
  resolve: (result: ApprovalResult) => void;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ApprovalResult {
  approved: boolean;
  updatedInput?: Record<string, unknown>;
}

// Tools that are auto-approved without needing a Slack button tap
export const AUTO_APPROVE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "Explore",
  "AskUserQuestion",
]);
