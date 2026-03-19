export interface SessionState {
  sessionId: string | null;
  name: string | null;
  ownerId: string | null;
  cwd: string;
  model: string;
  plugins: string[];
  canvasFileId: string | null;
  autoApprove: boolean;
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
  requesterId: string;
}

export interface ApprovalResult {
  approved: boolean;
  updatedInput?: Record<string, unknown>;
}

export interface ImageAttachment {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export { SUPPORTED_IMAGE_TYPES };

// Pirate name generator for non-DM channels
const ADJECTIVES = [
  "Dread", "Scurvy", "Plunderin'", "Fearsome", "Barnacled", "Seafarin'",
  "Cursed", "Salty", "Swashbucklin'", "Bilge-soaked", "Rum-soaked", "Pillaging",
  "Storm-weathered", "One-eyed", "Hook-handed", "Blackhearted", "Roguish",
  "Wretched", "Marooned", "Treacherous",
];

const NAMES = [
  "Blackbeard", "Redbeard", "Silverteeth", "Ironjaw", "Cutlass", "Flintlock",
  "Stormcrow", "Gallows", "Barnacle", "Kraken", "Tortuga", "Davy", "Jolly",
  "Cannon", "Mainsail", "Brine", "Scallywag", "Bosun", "Quarterdeck", "Foulweather",
  "Broadside", "Crow", "Bilge", "Starboard",
];

export function generateCuteName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  return `${adj} ${name}`;
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
  "CanvasRead",
  "CanvasCreate",
  "CanvasUpdate",
  "CanvasDelete",
  "CanvasReadById",
  "CanvasUpdateById",
  "CanvasDeleteById",
  "DiagramCreate",
  "SelfReboot",
  "JiraCreateTicket",
  "JiraUpdateTicket",
  "JiraReadTicket",
  "JiraSearch",
  "JiraAddComment",
  "JiraUpdateComment",
  "JiraDeleteComment",
  "ConfluenceReadPage",
  "ConfluenceSearch",
  "ConfluenceCreatePage",
  "ConfluenceUpdatePage",
  "GitHubCreatePR",
  "GitHubReadPR",
  "GitHubReadIssue",
  "GitHubSearch",
  "GitHubListPRs",
  "LaunchApp",
  "PostMessage",
  "TriggerBitrise",
  "Bash",
]);
