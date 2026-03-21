import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const CONFIG_DIR = join(homedir(), ".foreman");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface ForemanConfig {
  slackBotToken?: string;
  slackAppToken?: string;
  anthropicApiKey?: string;
  defaultCwd?: string;
  openaiApiKey?: string;
  bitriseToken?: string;
  bitriseAppSlug?: string;
  buildWorkspace?: string;   // absolute path to .xcworkspace or .xcodeproj
  buildScheme?: string;      // Xcode scheme name
  buildSimulatorUDID?: string; // target simulator UDID
  buildBundleId?: string;    // bundle ID to launch after install
  jiraHost?: string;         // e.g. https://myfitnesspal.atlassian.net
  jiraEmail?: string;        // Jira account email
  jiraApiToken?: string;     // Jira API token
  jiraProjectKey?: string;   // e.g. POW
  mentionsChannel?: string;  // Slack channel ID to route Jira mentions to (e.g. C08XXXXXXX)
  mentionsPollMinutes?: number; // How often to poll for mentions (default: 1)
}

export function readConfig(): ForemanConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as ForemanConfig;
  } catch (err) {
    console.error("[config] Failed to read config file:", err);
    return {};
  }
}

/**
 * Apply ~/.foreman/config.json values to env vars (only if not already set).
 * Call this before dotenv so config.json takes priority over .env.
 */
export function applyConfig(): void {
  const config = readConfig();
  if (config.slackBotToken) process.env.SLACK_BOT_TOKEN ??= config.slackBotToken;
  if (config.slackAppToken) process.env.SLACK_APP_TOKEN ??= config.slackAppToken;
  if (config.anthropicApiKey) process.env.ANTHROPIC_API_KEY ??= config.anthropicApiKey;
  if (config.defaultCwd) process.env.CLAUDE_CWD ??= config.defaultCwd;
}

/**
 * Validate that required tokens are present. Exit with a helpful message if not.
 */
export function validateConfig(): void {
  const missing: string[] = [];
  if (!process.env.SLACK_BOT_TOKEN) missing.push("SLACK_BOT_TOKEN");
  if (!process.env.SLACK_APP_TOKEN) missing.push("SLACK_APP_TOKEN");

  if (missing.length > 0) {
    console.error("[config] Missing required configuration:", missing.join(", "));
    console.error("[config] Run `foreman init` to set up your configuration.");
    console.error(`[config] Or create ${CONFIG_FILE} with your tokens.`);
    process.exit(1);
  }
}
