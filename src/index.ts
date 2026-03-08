#!/usr/bin/env node

// Handle `foreman init` before any bot startup
if (process.argv[2] === "init") {
  const { runInit } = await import("./init.js");
  await runInit();
  process.exit(0);
}

import dotenv from "dotenv";
import { applyConfig, validateConfig } from "./config.js";
import { App } from "@slack/bolt";
import { registerHandlers } from "./slack.js";
import { loadSessions } from "./session.js";

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
  registerHandlers(app, botUserId);
  console.log("Foreman is running");
  console.log(`  Working directory: ${process.env.CLAUDE_CWD || process.cwd()}`);
})();
