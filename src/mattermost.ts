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
import { getBotTransport } from "./bots.js";
import { callBotByName } from "./kafka.js";

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
let MM_ARCHITECT_USER_ID = "";
let MM_FOREMAN_TOKEN = "";
// Mattermost runs in Docker — it calls this URL when a button is clicked.
// "localhost" inside Docker = the container, not the host. Use host.docker.internal to reach host.
let MM_ACTION_URL = "http://host.docker.internal:3001";

// Map of Mattermost bot user IDs — messages from these are filtered out
const botUserIds = new Set<string>();

// Bot routing: mmUserId → bot config (name, system prompt, token)
interface BotConfig { name: string; displayName: string; systemPrompt: string; token: string; userId: string; }
const botUserMap = new Map<string, BotConfig>();
// Cache channel → bot so we don't re-fetch members every message
const channelBotCache = new Map<string, BotConfig | null>();

async function identifyChannelBot(channelId: string): Promise<BotConfig | null> {
  if (channelBotCache.has(channelId)) return channelBotCache.get(channelId)!;
  try {
    const members = await mmFetch("GET", `/channels/${channelId}/members?per_page=50`, undefined, MM_ADMIN_TOKEN);
    if (Array.isArray(members)) {
      for (const member of members) {
        const cfg = botUserMap.get(member.user_id);
        if (cfg) {
          channelBotCache.set(channelId, cfg);
          return cfg;
        }
      }
    }
  } catch { /* ignore */ }
  // Don't cache null — allow retries (bot may not be initialized on first call)
  return null;
}

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

export async function postMessage(channelId: string, text: string, botToken?: string): Promise<void> {
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
    case "Bash": {
      const cmd = String(input.command || "").trim();
      const short = cmd.length > 120 ? cmd.slice(0, 120) + "…" : cmd;
      return `*Running \`${short}\`...*`;
    }
    case "Edit":
      return `*Editing \`${input.file_path}\`...*`;
    case "Write":
      return `*Writing \`${input.file_path}\`...*`;
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
  isDM = false,
  onBeforePost?: () => Promise<void>,
  botConfig?: BotConfig,
): Promise<{ result: string; sessionId: string; cost: number; turns: number }> {
  const state = getState(channel);

  // Inject context primer if set
  if (state.contextPrimer) {
    text = state.contextPrimer + text;
    state.contextPrimer = null;
  }

  // Resolve channel name (persona) — use bot's display name if routing to a named bot
  if (botConfig) {
    if (state.name !== botConfig.displayName) setName(channel, botConfig.displayName);
  } else if (state.name === null) {
    setName(channel, generateCuteName());
  }

  // First person to message becomes the channel owner
  if (state.ownerId === null && requesterId) {
    setOwner(channel, requesterId);
  }

  const name = state.name ?? "Foreman";
  const botToken = botConfig?.token;

  // Tool approval: post interactive buttons — uses explicit botToken, no defaults
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
            url: `${MM_ACTION_URL}/api/mm/actions`,
            context: { action: "approve", channel },
          },
        },
        {
          name: "Deny",
          integration: {
            url: `${MM_ACTION_URL}/api/mm/actions`,
            context: { action: "deny", channel },
          },
        },
      ], botToken).catch(() => {});
    });
  };

  // Progress messages — uses explicit botToken, no defaults
  const onProgress = (toolName: string, input: Record<string, unknown>) => {
    postMessage(channel, formatProgress(toolName, input), botToken).catch(() => {});
  };

  // Create MCP server — pass null for Slack app (not used in MM bridge)
  const mcpServer = createCanvasMcpServer(channel, null as any, isDM, "mattermost");

  const systemPromptOverride = botConfig?.systemPrompt;
  const sessionStartMs = Date.now();
  let result;
  if (state.sessionId) {
    try {
      result = await resumeSession(channel, text, state.sessionId, state.cwd, name, onApprovalNeeded, onProgress, undefined, mcpServer, null as any, undefined, undefined, systemPromptOverride);
    } catch {
      clearSession(channel);
      result = await startSession(channel, text, state.cwd, name, onApprovalNeeded, onProgress, undefined, mcpServer, null as any, undefined, undefined, systemPromptOverride);
    }
  } else {
    result = await startSession(channel, text, state.cwd, name, onApprovalNeeded, onProgress, undefined, mcpServer, null as any, undefined, undefined, systemPromptOverride);
  }
  if (result.sessionId) setSessionId(channel, result.sessionId);

  // Fire pre-post hook (e.g. typing indicator) before posting response
  if (onBeforePost) await onBeforePost();

  // Post response — Markdown works natively in Mattermost (no format conversion!)
  const responseText = result.result || "(no response)";
  // Mattermost max post size is ~16383 chars, chunk if needed
  const chunks = responseText.length > 15000
    ? responseText.match(/.{1,15000}/gs) || [responseText]
    : [responseText];
  for (const chunk of chunks) {
    await postMessage(channel, chunk, botToken);
  }

  if (result.cost > 0) {
    const totalSec = Math.round((Date.now() - sessionStartMs) / 1000);
    const elapsedStr = totalSec >= 60 ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s` : `${totalSec}s`;
    await postMessage(channel, `*Done in ${result.turns} turns | $${result.cost.toFixed(4)} | ${elapsedStr}*`, botToken);
  }

  return { result: result.result || "", sessionId: result.sessionId || "", cost: result.cost || 0, turns: result.turns || 0 };
}

/** Get the foreman bot token for FlowSpec dispatch. Throws if not configured. */
export function getForemanToken(): string {
  if (!MM_FOREMAN_TOKEN) {
    throw new Error("Foreman bot token not configured. Add 'foreman' to mattermostBotTokens in config.json.");
  }
  return MM_FOREMAN_TOKEN;
}

/** Get the Foreman bot's Mattermost user ID (for inviting to channels). */
async function getForemanBotUserId(): Promise<string | null> {
  if (!MM_FOREMAN_TOKEN) return null;
  try {
    const me = await mmFetch("GET", "/users/me", undefined, MM_FOREMAN_TOKEN);
    return me?.id || null;
  } catch {
    return null;
  }
}

// ── Kafka Transport Handler ───────────────────────────────────────────────────

/**
 * Handle a message for a Kafka-transport bot.
 * Produces to the bot's Kafka inbox, waits for the outbox response,
 * and posts it back to the Mattermost channel (truncated if needed).
 */
async function handleKafkaTransportMessage(
  channel: string,
  text: string,
  botConfig: BotConfig,
): Promise<void> {
  try {
    console.log(`[mattermost] Kafka transport for ${botConfig.name}: dispatching via Kafka`);
    const result = await callBotByName(botConfig.name, text);

    const MAX_CHARS = 15_000;
    let responseText = result || '(no response)';
    if (responseText.length > MAX_CHARS) {
      responseText = responseText.slice(0, MAX_CHARS) +
        '\n\n... [truncated — full response available in Kafka]';
    }

    await postMessage(channel, responseText, botConfig.token);
  } catch (err) {
    console.error(`[mattermost] Kafka transport error for ${botConfig.name}:`, err);
    await postMessage(
      channel,
      `Kafka transport error: ${err instanceof Error ? err.message : String(err)}`,
      botConfig.token,
    );
  }
}

// ── FlowSpec integration ──────────────────────────────────────────────────────

/**
 * FlowSpec dispatch — runs a Claude session in a Mattermost channel.
 * Uses the foreman bot token exclusively. No per-bot routing, no defaults.
 * Mirrors Slack: one bot token, posts everything.
 */
export async function processChannelMessageForFlowSpec(channelId: string, prompt: string): Promise<string> {
  const token = getForemanToken();
  await postMessage(channelId, `📋 *FlowSpec dispatch:*\n${prompt}`, token);
  // Build a synthetic BotConfig so processChannelMessage uses the foreman token
  // throughout all closures (onProgress, onApprovalNeeded, response posting).
  // System prompt and model will come from the channel's session config (workspace).
  const foremanConfig: BotConfig = {
    name: "foreman",
    displayName: "Foreman",
    systemPrompt: "",  // no override — use channel session's system prompt
    token,
    userId: "",
  };
  const result = await processChannelMessage(channelId, prompt, '', true, undefined, foremanConfig);
  return result.result;
}

/**
 * Post a status/send message to a Mattermost channel using the foreman token.
 * Used by postStatus activity for all mm: channels (both bot channels and
 * report channels). The foreman bot must be a member of all workspace channels.
 */
export async function postStatusMessage(channelId: string, text: string): Promise<void> {
  const token = getForemanToken();
  await postMessage(channelId, text, token);
}

// ── Shell-style argument parser (quote-aware) ────────────────────────────────

function parseShellArgs(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (/\s/.test(ch) && !inDouble && !inSingle) {
      if (current) { result.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) result.push(current);
  return result;
}

// ── /f command handler ────────────────────────────────────────────────────────

async function handleCommand(channel: string, text: string, userId: string, botToken?: string): Promise<void> {
  const args = parseShellArgs(text.replace(/^\/f\s+/, "").trim());
  const subcommand = args[0]?.toLowerCase();
  const respond = (msg: string) => postMessage(channel, msg, botToken);

  switch (subcommand) {
    case "cwd": {
      const path = args[1];
      if (!path) { await respond("Usage: `/f cwd /absolute/path`"); return; }
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

    case "run": {
      // Syntax:
      //   /f run <file.flow> [key=value ...]           — auto-selects first workflow
      //   /f run <file.flow> --name "Workflow Name" [key=value ...]
      //   /f run <file.flow> topic=the meaning of life — unquoted multi-word values work
      const flowFile = args[1];
      if (!flowFile || !flowFile.endsWith(".flow")) {
        await respond(
          "**Usage:**\n" +
          "- `/f run <file.flow>` — run the workflow\n" +
          "- `/f run <file.flow> key=value` — run with inputs\n" +
          "- `/f run <file.flow> --name \"Name\" key=value` — pick a specific workflow\n\n" +
          "Multi-word values: `topic=\"the meaning of life\"` or `topic=the meaning of life`"
        );
        return;
      }
      try {
        const { resolve, isAbsolute } = await import("path");
        const { readFileSync, existsSync } = await import("fs");
        const { parseFlowSpec } = await import("./flowspec/parser.js");
        const { loadBotRegistry, getRegistryPath } = await import("./flowspec/registry.js");
        const { getTemporalClient } = await import("./temporal/client.js");
        const { flowspecWorkflow } = await import("./temporal/workflows.js");

        const session = getState(channel);
        const filePath = isAbsolute(flowFile) ? flowFile : resolve(session.cwd, flowFile);
        if (!existsSync(filePath)) {
          await respond(`File not found: \`${filePath}\``);
          return;
        }
        const source = readFileSync(filePath, "utf-8");
        const workflows = parseFlowSpec(source);

        // Parse remaining args (after "run" and the flow file)
        const restArgs = args.slice(2);
        let workflowName: string | undefined;

        // Check for --name flag
        const nameIdx = restArgs.indexOf("--name");
        if (nameIdx !== -1 && nameIdx + 1 < restArgs.length) {
          workflowName = restArgs[nameIdx + 1];
          restArgs.splice(nameIdx, 2); // remove --name and its value
        }

        // Auto-select first workflow if no --name provided
        if (!workflowName) {
          workflowName = workflows[0].name;
        }

        const workflow = workflows.find((w: any) => w.name === workflowName);
        if (!workflow) {
          await respond(`Workflow "${workflowName}" not found.\nAvailable: ${workflows.map((w: any) => w.name).join(", ")}`);
          return;
        }

        const botRegistry = loadBotRegistry();
        if (Object.keys(botRegistry).length === 0) {
          await respond(`No bots registered. Check \`${getRegistryPath()}\`.`);
          return;
        }

        // Build inputs: start with defaults, then override with user args.
        // Supports: key=value, key="multi word value", key=multi word value (greedy)
        const inputs: Record<string, string> = {};
        for (const inp of workflow.inputs || []) {
          if (inp.defaultValue !== undefined) inputs[inp.name] = inp.defaultValue;
        }
        let lastKey: string | null = null;
        for (const arg of restArgs) {
          const eq = arg.indexOf("=");
          if (eq > 0) {
            lastKey = arg.slice(0, eq);
            inputs[lastKey] = arg.slice(eq + 1);
          } else if (lastKey) {
            // Append to previous key's value (unquoted multi-word)
            inputs[lastKey] += " " + arg;
          }
        }

        const client = await getTemporalClient();
        const workflowId = `flowspec-${workflowName.replace(/\s+/g, "-")}-${Date.now()}`;
        await client.workflow.start(flowspecWorkflow, {
          args: [workflows, workflowName, inputs, botRegistry, `mm:${channel}`],
          taskQueue: "foreman",
          workflowId,
        });

        await respond(`**FlowSpec started**\n- File: \`${flowFile}\`\n- Workflow: \`${workflowName}\`\n- ID: \`${workflowId}\`\n\nUse \`/f check ${workflowId}\` to check status.`);
      } catch (err) {
        await respond(`FlowSpec error: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "check": {
      const workflowId = args[1];
      if (!workflowId) {
        await respond("Usage: `/f check <workflowId>`");
        return;
      }
      try {
        const { getTemporalClient } = await import("./temporal/client.js");
        const client = await getTemporalClient();
        const handle = client.workflow.getHandle(workflowId);
        const desc = await handle.describe();
        await respond(`**Workflow \`${workflowId}\`**\n- Status: \`${desc.status.name}\`\n- Started: ${desc.startTime?.toISOString() ?? "unknown"}`);
      } catch (err) {
        await respond(`Check error: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "provision": {
      const flowFile = args[1];
      if (!flowFile) {
        await respond("Usage: `/f provision <file.flow>`\n\nReads the flow file, finds all @bot references, and creates Mattermost channels for any that don't exist yet.");
        return;
      }
      try {
        const { resolve, isAbsolute } = await import("path");
        const { readFileSync, existsSync } = await import("fs");
        const { parseFlowSpec } = await import("./flowspec/parser.js");
        const { extractBotNames } = await import("./flowspec/runtime.js");
        const { loadRawRegistry, addToChannelRegistry } = await import("./flowspec/registry.js");

        const session = getState(channel);
        const filePath = isAbsolute(flowFile) ? flowFile : resolve(session.cwd, flowFile);
        if (!existsSync(filePath)) {
          await respond(`File not found: \`${filePath}\``);
          return;
        }

        const source = readFileSync(filePath, "utf-8");
        const workflows = parseFlowSpec(source);
        const botNames = extractBotNames(workflows);

        if (botNames.length === 0) {
          await respond("No @bot references found in this flow file.");
          return;
        }

        const registry = loadRawRegistry();
        const mmBots = registry["mattermost"] || {};
        const results: string[] = [];
        let created = 0;

        for (const botName of botNames) {
          if (mmBots[botName]) {
            results.push(`  ✓ ${botName} — already exists`);
            continue;
          }

          // Try to create the channel; if it already exists, look it up instead
          let chRes: any;
          let adopted = false;
          try {
            chRes = await mmFetch("POST", "/channels", {
              team_id: MM_TEAM_ID,
              name: botName,
              display_name: botName,
              type: "O",
              purpose: `FlowSpec bot channel — provisioned for ${flowFile}`,
            });
          } catch (createErr: any) {
            if (createErr?.message?.includes("exists")) {
              // Channel already exists in Mattermost — adopt it
              try {
                chRes = await mmFetch("GET", `/teams/${MM_TEAM_ID}/channels/name/${botName}`);
                adopted = true;
              } catch {
                results.push(`  ✗ ${botName} — exists but lookup failed`);
                continue;
              }
            } else {
              results.push(`  ✗ ${botName} — ${createErr?.message || "failed to create channel"}`);
              continue;
            }
          }

          if (!chRes?.id) {
            results.push(`  ✗ ${botName} — failed to create channel`);
            continue;
          }

          // Invite the Foreman bot
          const foremanUserId = await getForemanBotUserId();
          if (foremanUserId) {
            await mmFetch("POST", `/channels/${chRes.id}/members`, { user_id: foremanUserId }).catch(() => {});
          }

          // Add to channel registry
          addToChannelRegistry("mattermost", botName, chRes.id);

          if (adopted) {
            results.push(`  ↩ ${botName} — adopted existing channel (${chRes.id})`);
          } else {
            results.push(`  + ${botName} — created (channel: ${chRes.id})`);
          }
          created++;
        }

        await respond(
          `**Provisioned for \`${flowFile}\`:**\n${results.join("\n")}\n\n` +
          (created > 0 ? `${created} channel(s) created. \`channel-registry.yaml\` updated.` : "All bots already provisioned.")
        );
      } catch (err) {
        await respond(`Provision error: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    default: {
      await respond(
        "**Available commands:**\n" +
        "- `/f cwd <path>` — set working directory\n" +
        "- `/f model <name>` — switch model (e.g. `opus`, `openai:gpt-4o`)\n" +
        "- `/f name <name>` — set bot persona name\n" +
        "- `/f session` — show session info\n" +
        "- `/f new` — reset session\n" +
        "- `/f stop` — abort current query\n" +
        "- `/f auto-approve on|off` — toggle tool auto-approval\n" +
        "- `/f plugin <path>` — load a plugin directory\n" +
        "- `/f run <file.flow> [key=value ...]` — run a FlowSpec workflow\n" +
        "- `/f provision <file.flow>` — create channels for bots in a flow file\n" +
        "- `/f check <workflowId>` — check FlowSpec workflow status"
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
      // Mattermost channel_type "D" = direct message, "G" = group DM
      const isDM = msg.data?.channel_type === "D" || msg.data?.channel_type === "G";

      // Handle /f commands — either from registered slash command or typed as text
      if (text.startsWith("/f ") || text === "/f") {
        const fBotConfig = await identifyChannelBot(channel);
        try {
          await handleCommand(channel, text, requesterId, fBotConfig?.token);
        } catch (err) {
          await postMessage(channel, `Error: ${err instanceof Error ? err.message : String(err)}`, fBotConfig?.token);
        }
        return;
      }

      // Handle ! escape for Claude slash commands
      const processedText = text.startsWith("!") ? "/" + text.slice(1) : text;

      // Identify which bot (if any) owns this channel — routes persona + token + reactions
      const botConfig = await identifyChannelBot(channel);
      const reactUserId = botConfig?.userId ?? MM_ARCHITECT_USER_ID;
      const reactToken = botConfig?.token ?? MM_ARCHITECT_TOKEN;

      // Add thinking reaction (signals: "I see your message")
      // Small delay gives the browser time to set up its reaction listener for the new post
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        await mmFetch("POST", "/reactions", {
          user_id: reactUserId,
          post_id: post.id,
          emoji_name: "thinking_face",
        }, reactToken);
      } catch { /* ignore */ }

      // onBeforePost: fires just before response is posted — show typing indicator
      const onBeforePost = async () => {
        try {
          await mmFetch("POST", `/users/${reactUserId}/typing`, { channel_id: channel }, reactToken);
        } catch { /* ignore */ }
        // Keep indicator visible for a moment before the response lands
        await new Promise(resolve => setTimeout(resolve, 1500));
      };

      try {
        if (botConfig && getBotTransport(botConfig.name) === 'kafka') {
          await handleKafkaTransportMessage(channel, processedText, botConfig);
        } else {
          await processChannelMessage(channel, processedText, requesterId, isDM, onBeforePost, botConfig ?? undefined);
        }
      } catch (err) {
        await postMessage(channel, `Error: ${err instanceof Error ? err.message : String(err)}`);
        try {
          await mmFetch("POST", "/reactions", { user_id: MM_ARCHITECT_USER_ID, post_id: post.id, emoji_name: "x" }, MM_ARCHITECT_TOKEN);
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

// ── Slash command registration + handler ──────────────────────────────────────

async function registerSlashCommand(): Promise<void> {
  if (!MM_TEAM_ID) return;
  try {
    const commands = await mmFetch("GET", `/commands?team_id=${MM_TEAM_ID}&custom_only=true`);
    if (Array.isArray(commands) && commands.some((c: any) => c.trigger === "f")) {
      console.log("[mattermost] /f slash command already registered");
      return;
    }
    await mmFetch("POST", "/commands", {
      team_id: MM_TEAM_ID,
      trigger: "f",
      method: "P",
      url: `${MM_ACTION_URL}/api/mm/slash`,
      display_name: "Foreman",
      description: "Control your Foreman bot session",
      auto_complete: true,
      auto_complete_hint: "session|model|cwd|new|stop|name|plugin|auto-approve|run|provision|check",
      auto_complete_desc: "Foreman bot commands",
    });
    console.log("[mattermost] Registered /f slash command");
  } catch (err) {
    console.warn("[mattermost] Could not register /f slash command:", (err as Error).message);
  }
}

export function handleSlashCommand(req: any, res: any): void {
  const { channel_id, text, user_id } = req.body;
  res.json({ response_type: "ephemeral", text: "" }); // immediate ACK
  const fullText = `/f ${(text || "").trim()}`.trim();
  identifyChannelBot(channel_id).then(botConfig => {
    const botToken = botConfig?.token;
    handleCommand(channel_id, fullText, user_id, botToken).catch(err => {
      postMessage(channel_id, `Error: ${err instanceof Error ? err.message : String(err)}`, botToken).catch(() => {});
    });
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
  MM_FOREMAN_TOKEN = MM_BOT_TOKENS.foreman || "";
  if (config.mattermostActionUrl) MM_ACTION_URL = config.mattermostActionUrl;

  if (!MM_URL || !MM_ADMIN_TOKEN) {
    console.log("[mattermost] No Mattermost config found — bridge not started");
    return;
  }

  // Validate foreman token — required for FlowSpec
  if (MM_FOREMAN_TOKEN) {
    console.log("[mattermost] Foreman bot token loaded (FlowSpec infrastructure)");
  } else {
    console.warn("[mattermost] No foreman bot token — FlowSpec Mattermost dispatch will fail");
  }

  // Discover architect bot's user ID (needed for reactions + typing indicator)
  try {
    const me = await mmFetch("GET", "/users/me", undefined, MM_ARCHITECT_TOKEN);
    MM_ARCHITECT_USER_ID = me.id;
    console.log(`[mattermost] Architect bot user ID: ${MM_ARCHITECT_USER_ID}`);
  } catch (err) {
    console.warn("[mattermost] Could not fetch architect user ID:", (err as Error).message);
  }

  // Discover bot user IDs so we can filter their messages + build routing map
  try {
    const bots = await mmFetch("GET", "/bots?per_page=200");
    const { getAllBots } = await import("./bots.js");
    const botDefMap = new Map(getAllBots().map(b => [b.name, b.definition]));
    for (const bot of bots) {
      botUserIds.add(bot.user_id);
      // Build routing map for bots that have a token + system_prompt
      const botName: string = bot.username; // e.g. "betty"
      const token = MM_BOT_TOKENS[botName];
      const def = botDefMap.get(botName);
      if (token && def?.system_prompt && bot.user_id !== MM_ARCHITECT_USER_ID) {
        const displayName = botName.charAt(0).toUpperCase() + botName.slice(1);
        botUserMap.set(bot.user_id, { name: botName, displayName, systemPrompt: def.system_prompt, token, userId: bot.user_id });
        console.log(`[mattermost] Bot routing: ${displayName} → ${bot.user_id}`);
      }
    }
    console.log(`[mattermost] Registered ${botUserIds.size} bot user IDs for filtering`);
  } catch (err) {
    console.warn("[mattermost] Could not fetch bot list:", (err as Error).message);
  }

  // Auto-register /f slash command
  await registerSlashCommand();

  // Connect WebSocket
  connectWebSocket();

  console.log(`[mattermost] Bridge started — ${MM_URL}`);
}
