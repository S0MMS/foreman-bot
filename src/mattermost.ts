/**
 * mattermost.ts — Mattermost bridge (1:1 port of slack.ts)
 *
 * Connects to Mattermost via WebSocket for real-time events and uses the REST
 * API (raw fetch) to post messages.  No @mattermost/client SDK — it's CJS and
 * browser-oriented, fighting our ESM Node.js setup.
 *
 * Mirrors the Slack bridge: each Mattermost channel gets its own independent
 * Claude session with its own model, working directory, and persona.
 */

import WebSocket from "ws";
import { existsSync } from "fs";
import { isAbsolute, join } from "path";
import { createRequire } from "module";
import { dirname } from "path";
import type { ApprovalResult } from "./types.js";
import {
  getState,
  setCwd,
  setModel,
  setName,
  setOwner,
  setSessionId,
  clearSession,
  setPendingApproval,
  addPlugin,
  getPlugins,
  setAutoApprove,
  setAdapter,
  setContextPrimer,
} from "./session.js";
import { MODEL_ALIASES, generateCuteName } from "./types.js";
import { startSession, resumeSession, abortCurrentQuery } from "./claude.js";
import { readConfig } from "./config.js";
import { createCanvasMcpServer } from "./mcp-canvas.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const _require = createRequire(import.meta.url);
const FOREMAN_VERSION: string = _require("../package.json").version;
const sdkEntry = _require.resolve("@anthropic-ai/claude-agent-sdk");
const sdkPkgPath = join(dirname(sdkEntry).replace(/\/dist.*$/, "").replace(/\/src.*$/, ""), "package.json");
const SDK_VERSION: string = _require(sdkPkgPath).version;

let MM_URL = "";
let MM_ADMIN_TOKEN = "";
let MM_TEAM_ID = "";
let MM_BOT_TOKENS: Record<string, string> = {};
let MM_ARCHITECT_TOKEN = "";

// Map of Mattermost bot user IDs — messages from these are filtered out
const botUserIds = new Set<string>();

// ── REST API helpers ──────────────────────────────────────────────────────────

async function mmFetch(method: string, endpoint: string, body?: unknown, token?: string): Promise<any> {
  const res = await fetch(`${MM_URL}/api/v4${endpoint}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token || MM_ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mattermost API ${method} ${endpoint}: ${res.status} ${text}`);
  }
  return res.json();
}

async function postMessage(channelId: string, text: string, botToken?: string): Promise<void> {
  await mmFetch("POST", "/posts", { channel_id: channelId, message: text }, botToken || MM_ARCHITECT_TOKEN);
}

async function postInteractiveMessage(
  channelId: string,
  text: string,
  actions: Array<{ name: string; integration: { url: string; context: Record<string, string> } }>,
  botToken?: string,
): Promise<string> {
  const result = await mmFetch("POST", "/posts", {
    channel_id: channelId,
    message: "",
    props: {
      attachments: [{
        text,
        actions: actions.map(a => ({
          id: a.name,
          name: a.name,
          type: "button",
          integration: a.integration,
        })),
      }],
    },
  }, botToken || MM_ARCHITECT_TOKEN);
  return result.id;
}

async function updatePost(postId: string, text: string, botToken?: string): Promise<void> {
  await mmFetch("PUT", `/posts/${postId}`, {
    id: postId,
    message: text,
    props: { attachments: [] },
  }, botToken || MM_ARCHITECT_TOKEN);
}

// ── Tool progress formatting ──────────────────────────────────────────────────

function formatProgress(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
      return `*Reading \`${input.file_path}\`...*`;
    case "Glob":
      return `*Searching for \`${input.pattern}\`...*`;
    case "Grep":
      return `*Searching code for \`${input.pattern}\`...*`;
    case "WebSearch":
      return `*Searching the web: \`${input.query}\`...*`;
    case "WebFetch":
      return `*Fetching \`${input.url}\`...*`;
    case "Task":
    case "Explore":
      return `*Spawning subagent...*`;
    default:
      return `*${toolName}...*`;
  }
}

function formatToolRequest(toolName: string, input: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const val = typeof value === "string" ? value : JSON.stringify(value);
    const short = val.length > 200 ? val.slice(0, 200) + "…" : val;
    lines.push(`\`${key}\`: ${short}`);
  }
  return lines.join("\n");
}

// ── Channel message processing ────────────────────────────────────────────────

async function processChannelMessage(
  channel: string,
  text: string,
  requesterId: string,
): Promise<{ result: string; sessionId: string; cost: number; turns: number }> {
  const state = getState(channel);

  // Inject context primer if set
  if (state.contextPrimer) {
    text = state.contextPrimer + text;
    state.contextPrimer = null;
  }

  // Resolve channel name (persona) on first encounter
  if (state.name === null) {
    setName(channel, generateCuteName());
  }

  // First person to message becomes the channel owner
  if (state.ownerId === null && requesterId) {
    setOwner(channel, requesterId);
  }

  const name = state.name ?? "Foreman";

  // Tool approval: post interactive buttons
  const onApprovalNeeded = async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ApprovalResult> => {
    return new Promise<ApprovalResult>((resolve) => {
      setPendingApproval(channel, { resolve, toolName, input, requesterId });
      const description = formatToolRequest(toolName, input);
      postInteractiveMessage(channel, `**${toolName}**\n${description}`, [
        {
          name: "Approve",
          integration: {
            url: `http://localhost:3001/api/mm/actions`,
            context: { action: "approve", channel },
          },
        },
        {
          name: "Deny",
          integration: {
            url: `http://localhost:3001/api/mm/actions`,
            context: { action: "deny", channel },
          },
        },
      ]).catch(() => {});
    });
  };

  const onProgress = (toolName: string, input: Record<string, unknown>) => {
    postMessage(channel, formatProgress(toolName, input)).catch(() => {});
  };

  // Create MCP server — pass null for Slack app (not used in MM bridge)
  const mcpServer = createCanvasMcpServer(channel, null as any);

  const sessionStartMs = Date.now();
  let result;
  if (state.sessionId) {
    try {
      result = await resumeSession(channel, text, state.sessionId, state.cwd, name, onApprovalNeeded, onProgress, undefined, mcpServer, null as any);
    } catch {
      clearSession(channel);
      result = await startSession(channel, text, state.cwd, name, onApprovalNeeded, onProgress, undefined, mcpServer, null as any);
    }
  } else {
    result = await startSession(channel, text, state.cwd, name, onApprovalNeeded, onProgress, undefined, mcpServer, null as any);
  }
  if (result.sessionId) setSessionId(channel, result.sessionId);

  // Post response — Markdown works natively in Mattermost (no format conversion!)
  const responseText = result.result || "(no response)";
  // Mattermost max post size is ~16383 chars, chunk if needed
  const chunks = responseText.length > 15000
    ? responseText.match(/.{1,15000}/gs) || [responseText]
    : [responseText];
  for (const chunk of chunks) {
    await postMessage(channel, chunk);
  }

  if (result.cost > 0) {
    const totalSec = Math.round((Date.now() - sessionStartMs) / 1000);
    const elapsedStr = totalSec >= 60 ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s` : `${totalSec}s`;
    await postMessage(channel, `*Done in ${result.turns} turns | $${result.cost.toFixed(4)} | ${elapsedStr}*`);
  }

  return { result: result.result || "", sessionId: result.sessionId || "", cost: result.cost || 0, turns: result.turns || 0 };
}

// ── /cc command handler ───────────────────────────────────────────────────────

async function handleCommand(channel: string, text: string, userId: string): Promise<void> {
  const args = text.replace(/^\/cc\s+/, "").trim().split(/\s+/);
  const subcommand = args[0]?.toLowerCase();
  const respond = (msg: string) => postMessage(channel, msg);

  switch (subcommand) {
    case "cwd": {
      const path = args[1];
      if (!path) { await respond("Usage: `/cc cwd /absolute/path`"); return; }
      if (!isAbsolute(path)) { await respond("Path must be absolute."); return; }
      if (!existsSync(path)) { await respond(`Directory not found: \`${path}\``); return; }
      setCwd(channel, path);
      await respond(`Working directory set to \`${path}\``);
      break;
    }

    case "model": {
      const modelArg = args[1]?.toLowerCase();
      if (!modelArg) {
        const state = getState(channel);
        const aliases = Object.entries(MODEL_ALIASES).map(([a, id]) => `\`${a}\` → \`${id}\``).join(", ");
        await respond(`Current model: \`${state.model}\` (vendor: \`${state.adapter ?? "anthropic"}\`)\nAliases: ${aliases}`);
        return;
      }
      const colonIdx = modelArg.indexOf(":");
      if (colonIdx !== -1) {
        setAdapter(channel, modelArg.slice(0, colonIdx));
        setModel(channel, modelArg.slice(colonIdx + 1));
        await respond(`Switched to vendor \`${modelArg.slice(0, colonIdx)}\`, model \`${modelArg.slice(colonIdx + 1)}\``);
      } else {
        const modelId = MODEL_ALIASES[modelArg] || modelArg;
        setModel(channel, modelId);
        await respond(`Switched to model \`${modelId}\``);
      }
      break;
    }

    case "auto-approve": {
      const flag = args[1]?.toLowerCase();
      if (flag === "on") { setAutoApprove(channel, true); await respond("Auto-approve enabled."); }
      else if (flag === "off") { setAutoApprove(channel, false); await respond("Auto-approve disabled."); }
      else { await respond(`Auto-approve is ${getState(channel).autoApprove ? "on" : "off"}.`); }
      break;
    }

    case "stop": {
      const state = getState(channel);
      if (state.isRunning) { abortCurrentQuery(channel); await respond("Stopping current query..."); }
      else { await respond("No query is currently running."); }
      break;
    }

    case "session": {
      const state = getState(channel);
      const plugins = getPlugins(channel);
      await respond([
        "**Session Info**",
        `- Channel: \`${channel}\``,
        `- Name: \`${state.name ?? "Foreman"}\``,
        `- Session ID: \`${state.sessionId?.slice(0, 8) || "none"}...\``,
        `- Vendor: \`${state.adapter ?? "anthropic"}\``,
        `- Model: \`${state.model}\``,
        `- Working dir: \`${state.cwd}\``,
        `- Running: ${state.isRunning ? "yes" : "no"}`,
        `- Auto-approve: ${state.autoApprove ? "on" : "off"}`,
        `- Plugins: ${plugins.length === 0 ? "none" : plugins.map(p => p.split("/").pop()).join(", ")}`,
        `- Foreman: v${FOREMAN_VERSION} | SDK: v${SDK_VERSION}`,
      ].join("\n"));
      break;
    }

    case "name": {
      const newName = args.slice(1).join(" ");
      if (!newName) { await respond(`Current name: \`${getState(channel).name ?? "Foreman"}\``); return; }
      setName(channel, newName);
      await respond(`Name set to \`${newName}\``);
      break;
    }

    case "plugin": {
      const nameOrPath = args[1];
      if (!nameOrPath) {
        const plugins = getPlugins(channel);
        if (plugins.length === 0) { await respond("No plugins loaded."); }
        else { await respond("**Loaded Plugins**\n" + plugins.map(p => `- \`${p}\``).join("\n")); }
        return;
      }
      const state = getState(channel);
      const pluginPath = nameOrPath.startsWith("/") ? nameOrPath : join(state.cwd, nameOrPath);
      if (!existsSync(pluginPath)) { await respond(`Plugin not found: \`${pluginPath}\``); return; }
      addPlugin(channel, pluginPath);
      await respond(`Plugin loaded: \`${pluginPath}\``);
      break;
    }

    case "new": {
      clearSession(channel);
      await respond("Session cleared. Next message starts fresh.");
      break;
    }

    default: {
      await respond(
        "**Available commands:**\n" +
        "- `/cc cwd <path>` — set working directory\n" +
        "- `/cc model <name>` — switch model (e.g. `opus`, `openai:gpt-4o`)\n" +
        "- `/cc name <name>` — set bot persona name\n" +
        "- `/cc session` — show session info\n" +
        "- `/cc new` — reset session\n" +
        "- `/cc stop` — abort current query\n" +
        "- `/cc auto-approve on|off` — toggle tool auto-approval\n" +
        "- `/cc plugin <path>` — load a plugin directory"
      );
      break;
    }
  }
}

// ── WebSocket connection ──────────────────────────────────────────────────────

function connectWebSocket(): void {
  const wsUrl = MM_URL.replace(/^http/, "ws") + "/api/v4/websocket";
  console.log(`[mattermost] Connecting to ${wsUrl}`);

  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    // Authenticate
    ws.send(JSON.stringify({
      seq: 1,
      action: "authentication_challenge",
      data: { token: MM_ADMIN_TOKEN },
    }));
    console.log("[mattermost] WebSocket connected and authenticated");
  });

  ws.on("message", async (raw: Buffer) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Handle posted events (new messages)
    if (msg.event === "posted" && msg.data?.post) {
      let post: any;
      try { post = JSON.parse(msg.data.post); } catch { return; }

      // Skip bot messages (including our own)
      if (botUserIds.has(post.user_id)) return;

      const channel = post.channel_id;
      const text = (post.message || "").trim();
      if (!text) return;

      const requesterId = post.user_id;

      // Handle /cc commands (from message text, since we might not have slash commands set up)
      if (text.startsWith("/cc ") || text === "/cc") {
        try {
          await handleCommand(channel, text, requesterId);
        } catch (err) {
          await postMessage(channel, `Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      // Handle ! escape for Claude slash commands
      const processedText = text.startsWith("!") ? "/" + text.slice(1) : text;

      // Add thinking reaction (emoji) — Mattermost uses reactions on posts
      try {
        await mmFetch("POST", "/reactions", {
          user_id: Object.keys(MM_BOT_TOKENS).length > 0 ? undefined : undefined,
          post_id: post.id,
          emoji_name: "hourglass_flowing_sand",
        });
      } catch { /* ignore */ }

      try {
        await processChannelMessage(channel, processedText, requesterId);
        // Remove hourglass, add checkmark
        try {
          await mmFetch("DELETE", `/users/me/posts/${post.id}/reactions/hourglass_flowing_sand`);
          await mmFetch("POST", "/reactions", { post_id: post.id, emoji_name: "white_check_mark" });
        } catch { /* ignore */ }
      } catch (err) {
        await postMessage(channel, `Error: ${err instanceof Error ? err.message : String(err)}`);
        try {
          await mmFetch("DELETE", `/users/me/posts/${post.id}/reactions/hourglass_flowing_sand`);
          await mmFetch("POST", "/reactions", { post_id: post.id, emoji_name: "x" });
        } catch { /* ignore */ }
      }
    }
  });

  ws.on("close", (code: number) => {
    console.log(`[mattermost] WebSocket closed (code ${code}), reconnecting in 5s...`);
    setTimeout(connectWebSocket, 5000);
  });

  ws.on("error", (err: Error) => {
    console.error("[mattermost] WebSocket error:", err.message);
  });
}

// ── Interactive message action handler (Express route) ────────────────────────

export function handleMattermostAction(req: any, res: any): void {
  const { context } = req.body;
  if (!context?.channel || !context?.action) {
    res.json({ update: { message: "Invalid action" } });
    return;
  }

  const channel = context.channel;
  const state = getState(channel);

  if (!state.pendingApproval) {
    res.json({ update: { message: "No pending approval." } });
    return;
  }

  const toolName = state.pendingApproval.toolName;
  const approved = context.action === "approve";
  state.pendingApproval.resolve({ approved });
  setPendingApproval(channel, null);

  res.json({
    update: {
      message: approved
        ? `**Approved** — ${toolName}`
        : `**Denied** — ${toolName}`,
      props: { attachments: [] },
    },
  });
}

// ── Initialization ────────────────────────────────────────────────────────────

export async function startMattermostBridge(): Promise<void> {
  const config = readConfig();
  MM_URL = (config as any).mattermostUrl;
  MM_ADMIN_TOKEN = (config as any).mattermostAdminToken;
  MM_TEAM_ID = (config as any).mattermostTeamId;
  MM_BOT_TOKENS = (config as any).mattermostBotTokens || {};
  MM_ARCHITECT_TOKEN = MM_BOT_TOKENS.architect || MM_ADMIN_TOKEN;

  if (!MM_URL || !MM_ADMIN_TOKEN) {
    console.log("[mattermost] No Mattermost config found — bridge not started");
    return;
  }

  // Discover bot user IDs so we can filter their messages
  try {
    const bots = await mmFetch("GET", "/bots?per_page=200");
    for (const bot of bots) {
      botUserIds.add(bot.user_id);
    }
    console.log(`[mattermost] Registered ${botUserIds.size} bot user IDs for filtering`);
  } catch (err) {
    console.warn("[mattermost] Could not fetch bot list:", (err as Error).message);
  }

  // Connect WebSocket
  connectWebSocket();

  console.log(`[mattermost] Bridge started — ${MM_URL}`);
}
