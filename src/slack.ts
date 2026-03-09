import type { App } from "@slack/bolt";
import type { ApprovalResult } from "./types.js";
import { existsSync } from "fs";
import { join, resolve } from "path";
import {
  getState,
  setCwd,
  setModel,
  setName,
  clearSession,
  setPendingApproval,
  addPlugin,
  getPlugins,
} from "./session.js";
import { MODEL_ALIASES } from "./types.js";
import { startSession, resumeSession, abortCurrentQuery } from "./claude.js";
import { markdownToSlack, chunkMessage, formatToolRequest } from "./format.js";


/**
 * Register all Slack event handlers on the Bolt app.
 * Each channel gets its own independent session.
 */
export function registerHandlers(app: App, botUserId: string): void {
  app.message(async ({ message, client }) => {
    if (
      !("text" in message) ||
      !message.text ||
      ("bot_id" in message && message.bot_id) ||
      ("subtype" in message && message.subtype)
    ) {
      return;
    }

    const raw = message.text.trim();
    // Allow ! prefix as an escape hatch for Claude slash commands (e.g. !freud:pull main → /freud:pull main)
    const text = raw.startsWith("!") ? "/" + raw.slice(1) : raw;
    const channel = message.channel;
    const ts = message.ts;

    // Add thinking reaction
    try {
      await client.reactions.add({ channel, timestamp: ts, name: "thinking_face" });
    } catch {
      // Ignore
    }

    try {
      const state = getState(channel);

      // Resolve channel name (persona) on first encounter
      if (state.name === null) {
        // DM channels start with 'D' — no meaningful channel name, use default
        if (channel.startsWith("D")) {
          setName(channel, "Foreman");
        } else {
          try {
            const info = await client.conversations.info({ channel });
            const ch = info.channel as any;
            const rawName = ch?.name || null;
            const resolved = rawName
              ? rawName.charAt(0).toUpperCase() + rawName.slice(1)
              : "Foreman";
            setName(channel, resolved);
          } catch {
            setName(channel, "Foreman");
          }
        }
      }

      const name = state.name ?? "Foreman";

      const onApprovalNeeded = async (
        toolName: string,
        input: Record<string, unknown>
      ): Promise<ApprovalResult> => {
        return new Promise<ApprovalResult>((resolve) => {
          setPendingApproval(channel, { resolve, toolName, input });

          const description = formatToolRequest(toolName, input);
          app.client.chat.postMessage({
            channel,
            text: `Tool approval needed: ${toolName}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:wrench: *${toolName}*\n${description}`,
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Approve" },
                    style: "primary",
                    action_id: "approve_tool",
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Deny" },
                    style: "danger",
                    action_id: "deny_tool",
                  },
                ],
              },
            ],
          });
        });
      };

      let result;
      if (state.sessionId) {
        try {
          result = await resumeSession(channel, text, state.sessionId, state.cwd, name, onApprovalNeeded);
        } catch {
          // Stale session — clear and start fresh
          clearSession(channel);
          result = await startSession(channel, text, state.cwd, name, onApprovalNeeded);
        }
      } else {
        result = await startSession(channel, text, state.cwd, name, onApprovalNeeded);
      }

      // Post response in chunks
      const slackText = markdownToSlack(result.result || "(no response)");
      const chunks = chunkMessage(slackText);
      for (const chunk of chunks) {
        await client.chat.postMessage({ channel, text: chunk });
      }

      // Post cost info
      if (result.cost > 0) {
        await client.chat.postMessage({
          channel,
          text: `_${result.turns} turns | $${result.cost.toFixed(4)}_`,
        });
      }

      // Swap reaction to checkmark
      try {
        await client.reactions.remove({ channel, timestamp: ts, name: "thinking_face" });
        await client.reactions.add({ channel, timestamp: ts, name: "white_check_mark" });
      } catch {
        // Ignore
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await client.chat.postMessage({ channel, text: `:x: Error: ${errorMsg}` });

      try {
        await client.reactions.remove({ channel, timestamp: ts, name: "thinking_face" });
        await client.reactions.add({ channel, timestamp: ts, name: "x" });
      } catch {
        // Ignore
      }
    }
  });

  // Slash command: /cc
  app.command("/cc", async ({ command, ack, respond }) => {
    await ack();

    const channel = command.channel_id;
    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "cwd": {
        const path = args[1];
        if (!path) {
          await respond("Usage: `/cc cwd /path/to/directory`");
          return;
        }
        const resolved = resolve(path);
        if (!existsSync(resolved)) {
          await respond(`:x: Directory not found: \`${resolved}\``);
          return;
        }
        setCwd(channel, resolved);
        await respond(`Working directory set to \`${resolved}\``);
        break;
      }

      case "model": {
        const modelArg = args[1]?.toLowerCase();
        if (!modelArg) {
          const state = getState(channel);
          const aliases = Object.entries(MODEL_ALIASES)
            .map(([alias, id]) => `\`${alias}\` → \`${id}\``)
            .join(", ");
          await respond(`Current model: \`${state.model}\`\nAliases: ${aliases}`);
          return;
        }
        const modelId = MODEL_ALIASES[modelArg] || modelArg;
        setModel(channel, modelId);
        await respond(`Model set to \`${modelId}\``);
        break;
      }

      case "stop": {
        const state = getState(channel);
        if (state.isRunning) {
          abortCurrentQuery(channel);
          await respond("Stopping current query...");
        } else {
          await respond("No query is currently running.");
        }
        break;
      }

      case "session": {
        const state = getState(channel);
        const plugins = getPlugins(channel);
        const lines = [
          "*Session Info*",
          `• Channel: \`${channel}\``,
          `• Name: \`${state.name ?? "Foreman"}\``,
          `• Session ID: \`${state.sessionId?.slice(0, 8) || "none"}...\``,
          `• Model: \`${state.model}\``,
          `• Working dir: \`${state.cwd}\``,
          `• Running: ${state.isRunning ? "yes" : "no"}`,
          `• Plugins: ${plugins.length === 0 ? "none" : plugins.map((p) => p.split("/").pop()).join(", ")}`,
        ];
        await respond(lines.join("\n"));
        break;
      }

      case "name": {
        const newName = args.slice(1).join(" ");
        if (!newName) {
          const state = getState(channel);
          await respond(`Current name: \`${state.name ?? "Foreman"}\``);
          return;
        }
        setName(channel, newName);
        await respond(`Name set to \`${newName}\``);
        break;
      }

      case "plugin": {
        const nameOrPath = args[1];
        if (!nameOrPath) {
          // List loaded plugins
          const plugins = getPlugins(channel);
          if (plugins.length === 0) {
            await respond("No plugins loaded. Use `/cc plugin <name-or-path>` to load one.");
          } else {
            const lines = ["*Loaded Plugins*"];
            for (const p of plugins) {
              lines.push(`• \`${p}\``);
            }
            await respond(lines.join("\n"));
          }
          return;
        }

        // Resolve path: absolute if starts with /, otherwise relative to cwd
        const state = getState(channel);
        const pluginPath = nameOrPath.startsWith("/")
          ? nameOrPath
          : join(state.cwd, nameOrPath);

        if (!existsSync(pluginPath)) {
          await respond(`:x: Plugin directory not found: \`${pluginPath}\``);
          return;
        }

        addPlugin(channel, pluginPath);
        await respond(`Plugin loaded: \`${pluginPath}\``);
        break;
      }

      case "new": {
        clearSession(channel);
        await respond("Session cleared (plugins cleared too). Next message starts fresh.");
        break;
      }

      case "reboot": {
        await respond(":recycle: Rebooting Foreman...");
        // Give Slack time to deliver the response, then exit.
        // launchd (or wrapper script) will restart the process.
        setTimeout(() => {
          console.log("Reboot requested via /cc reboot — exiting for restart");
          process.exit(0);
        }, 1500);
        break;
      }

      default:
        await respond(
          [
            "*Foreman Commands*",
            "• `/cc cwd <path>` — set working directory",
            "• `/cc model <name>` — set model (opus, sonnet, haiku, or full ID)",
            "• `/cc name <name>` — set bot persona name for this channel",
            "• `/cc plugin <name-or-path>` — load a plugin (or list loaded plugins)",
            "• `/cc stop` — cancel active query",
            "• `/cc session` — show session info",
            "• `/cc new` — start fresh session (resets model, clears plugins)",
            "• `/cc reboot` — restart Foreman",
          ].join("\n")
        );
    }
  });

  // Button interactions for approve/deny
  app.action("approve_tool", async ({ ack, body, client }) => {
    await ack();

    const channelId = body.channel?.id;
    if (!channelId) return;

    const state = getState(channelId);
    if (state.pendingApproval) {
      const toolName = state.pendingApproval.toolName;
      state.pendingApproval.resolve({ approved: true });
      setPendingApproval(channelId, null);

      if ("message" in body) {
        await client.chat.update({
          channel: channelId,
          ts: (body.message as any).ts,
          text: `:white_check_mark: *Approved* — ${toolName}`,
          blocks: [],
        });
      }
    }
  });

  app.action("deny_tool", async ({ ack, body, client }) => {
    await ack();

    const channelId = body.channel?.id;
    if (!channelId) return;

    const state = getState(channelId);
    if (state.pendingApproval) {
      const toolName = state.pendingApproval.toolName;
      state.pendingApproval.resolve({ approved: false });
      setPendingApproval(channelId, null);

      if ("message" in body) {
        await client.chat.update({
          channel: channelId,
          ts: (body.message as any).ts,
          text: `:no_entry_sign: *Denied* — ${toolName}`,
          blocks: [],
        });
      }
    }
  });
}
