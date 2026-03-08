import { createInterface } from "readline";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { CONFIG_DIR, CONFIG_FILE, readConfig } from "./config.js";
import type { ForemanConfig } from "./config.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

export async function runInit(): Promise<void> {
  console.log("\nForeman Setup Wizard\n");

  // Check for existing config
  if (existsSync(CONFIG_FILE)) {
    const answer = await ask("Config already exists at ~/.foreman/config.json. Reconfigure? (y/N): ");
    if (answer.toLowerCase() !== "y") {
      console.log("Keeping existing config. Run `foreman` to start.");
      rl.close();
      return;
    }
    console.log();
  }

  console.log("Step 1: Create your Slack app");
  console.log("─────────────────────────────");
  console.log("You need to create a Slack app in your workspace:");
  console.log("  1. Go to https://api.slack.com/apps");
  console.log("  2. Click 'Create New App' -> 'From Manifest'");
  console.log("  3. Paste the contents of slack-manifest.json from the Foreman repo");
  console.log("  4. Install the app to your workspace");
  console.log("  5. From 'OAuth & Permissions', copy your Bot Token (xoxb-...)");
  console.log("  6. From 'Basic Information' -> 'App-Level Tokens', create a token");
  console.log("     with the connections:write scope and copy it (xapp-...)");
  console.log();
  await ask("Press Enter when your app is ready...");

  console.log("\nStep 2: Enter your tokens");
  console.log("─────────────────────────");

  const existing = readConfig();

  const botTokenHint = existing.slackBotToken ? " [keep existing: press Enter]" : " [required]";
  const appTokenHint = existing.slackAppToken ? " [keep existing: press Enter]" : " [required]";
  const apiKeyHint = existing.anthropicApiKey ? " [keep existing: press Enter]" : " [required]";
  const cwdHint = `[default: ${existing.defaultCwd || homedir()}]`;

  const slackBotToken = await ask(`Slack Bot Token (xoxb-...)${botTokenHint}: `);
  const slackAppToken = await ask(`Slack App Token (xapp-...)${appTokenHint}: `);
  const anthropicApiKey = await ask(`Anthropic API Key (sk-ant-...)${apiKeyHint}: `);
  const defaultCwd = await ask(`Default working directory ${cwdHint}: `);

  const config: ForemanConfig = {
    slackBotToken: slackBotToken || existing.slackBotToken,
    slackAppToken: slackAppToken || existing.slackAppToken,
    anthropicApiKey: anthropicApiKey || existing.anthropicApiKey,
    defaultCwd: defaultCwd || existing.defaultCwd || homedir(),
  };

  if (!config.slackBotToken || !config.slackAppToken) {
    console.error("\nError: Slack Bot Token and App Token are required.");
    rl.close();
    process.exit(1);
  }

  if (!config.anthropicApiKey) {
    console.error("\nError: Anthropic API Key is required.");
    rl.close();
    process.exit(1);
  }

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  console.log("\nConfig saved to ~/.foreman/config.json");
  console.log("Run `foreman` to start!\n");

  rl.close();
}
