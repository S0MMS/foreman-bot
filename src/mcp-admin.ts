/**
 * mcp-admin.ts — foreman-admin toolbelt
 *
 * Administrative tools that only privileged bots (e.g. Architect) should have.
 * Currently: SelfReboot.
 *
 * These tools are intentionally kept separate from foreman-slack so that
 * regular bots cannot accidentally (or maliciously) reboot the Foreman process.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface AdminMcpContext {
  channelId: string;
  isDM: boolean;
  transport: string;
}

export function createAdminTools(ctx: AdminMcpContext) {
  const { channelId, isDM, transport } = ctx;

  return [
    tool(
      "SelfReboot",
      "Reboot the Foreman process. This kills the current process and launchd restarts it automatically. " +
      "ONLY available from DM channels — will refuse if called from a public/private channel. " +
      "Use this when the user asks you to reboot yourself. The bot will post a confirmation message after restarting.",
      {},
      async () => {
        // Only allow from DM channels or the UI Architect session
        // isDM covers Mattermost DMs (no "D" prefix); channelId.startsWith("D") covers Slack DMs
        if (!isDM && !channelId.startsWith("D") && channelId !== "ui:architect") {
          return { content: [{ type: "text" as const, text: "SelfReboot is only available from the DM channel." }] };
        }

        try {
          const markerPath = join(homedir(), ".foreman", "reboot-channel.txt");
          writeFileSync(markerPath, `${transport}:${channelId}`, "utf-8");

          setTimeout(() => {
            console.log("SelfReboot requested — exiting for restart");
            process.exit(0);
          }, 2000);

          return { content: [{ type: "text" as const, text: "Rebooting now... I'll be right back." }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error initiating reboot: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
  ];
}
