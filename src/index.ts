#!/usr/bin/env node

// Handle `foreman init` before any bot startup
if (process.argv[2] === "init") {
  const { runInit } = await import("./init.js");
  await runInit();
  process.exit(0);
}

import dotenv from "dotenv";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { applyConfig, validateConfig } from "./config.js";
import { App } from "@slack/bolt";
import { registerHandlers } from "./slack.js";
import { loadSessions } from "./session.js";
import { startSession, resumeSession } from "./claude.js";
import { getState } from "./session.js";
import { startWebhookServer } from "./webhook.js";

applyConfig();   // ~/.foreman/config.json (highest priority)
dotenv.config(); // .env fills any gaps (doesn't override already-set vars)
validateConfig(); // Exit early with helpful message if tokens missing

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

loadSessions();

(async () => {
  await app.start();
  const auth = await app.client.auth.test();
  const botUserId = auth.user_id as string;
  const botId = auth.bot_id as string;
  registerHandlers(app, botUserId, botId);
  startWebhookServer();
  console.log("Foreman is running");
  console.log(`  Working directory: ${process.env.CLAUDE_CWD || process.cwd()}`);

  // Check for self-reboot marker and post confirmation
  const markerPath = join(homedir(), ".foreman", "reboot-channel.txt");
  try {
    const channelId = readFileSync(markerPath, "utf-8").trim();
    unlinkSync(markerPath);
    if (channelId) {
      await app.client.chat.postMessage({
        channel: channelId,
        text: ":white_check_mark: Reboot successful — up and running!",
      });
      console.log(`Self-reboot complete — notified channel ${channelId}`);
    }
  } catch {
    // No marker file — normal startup, nothing to do
  }

  // Jira mentions polling — disabled (Chrisbot-5000 on hold)
  // const config = readConfig();
  // if (config.mentionsChannel && config.jiraHost && config.jiraApiToken) { ... }
})();
