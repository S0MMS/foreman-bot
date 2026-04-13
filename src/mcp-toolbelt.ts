/**
 * mcp-toolbelt.ts — foreman-toolbelt orchestrator
 *
 * Combines all domain-specific toolbelts into a single MCP server.
 * Each domain is implemented in its own file:
 *
 *   foreman-slack      → mcp-slack.ts      (canvas, post, read channel, diagram)
 *   foreman-atlassian  → mcp-atlassian.ts  (jira, confluence)
 *   foreman-github     → mcp-github.ts     (prs, issues, search)
 *   foreman-bitrise    → mcp-bitrise.ts    (CI builds)
 *   foreman-admin      → mcp-admin.ts      (self reboot)
 *   foreman-xcode      → mcp-xcode.ts      (iOS/Android launch)
 *
 * Pass `enabledServers` to restrict which toolbelts are loaded for a given bot.
 * Omit (or pass undefined) to load all tools — backward-compatible default.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import { getState } from "./session.js";
import { createSlackTools } from "./mcp-slack.js";
import { createAtlassianTools } from "./mcp-atlassian.js";
import { createGitHubTools } from "./mcp-github.js";
import { createBitriseTools } from "./mcp-bitrise.js";
import { createAdminTools } from "./mcp-admin.js";
import { createXcodeTools } from "./mcp-xcode.js";

export function createCanvasMcpServer(
  channelId: string,
  app: App,
  isDM = false,
  transport: "slack" | "mattermost" = "slack",
  enabledServers?: string[],
) {
  const getBotName = () => getState(channelId).name ?? "Foreman";

  const domainTools: Array<{ server: string; tools: any[] }> = [
    { server: "foreman-slack",      tools: createSlackTools({ channelId, app, getBotName }) },
    { server: "foreman-atlassian",  tools: createAtlassianTools() },
    { server: "foreman-github",     tools: createGitHubTools({ channelId }) },
    { server: "foreman-bitrise",    tools: createBitriseTools({ channelId }) },
    { server: "foreman-admin",      tools: createAdminTools({ channelId, isDM, transport }) },
    { server: "foreman-xcode",      tools: createXcodeTools({ channelId }) },
  ];

  const allTools = enabledServers
    ? domainTools.filter(d => enabledServers.includes(d.server)).flatMap(d => d.tools)
    : domainTools.flatMap(d => d.tools);

  return createSdkMcpServer({
    name: "foreman-toolbelt",
    tools: allTools,
  });
}
