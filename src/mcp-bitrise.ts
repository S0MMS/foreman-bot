/**
 * mcp-bitrise.ts — foreman-bitrise toolbelt
 *
 * Bitrise CI/CD tools. Requires bitriseToken and bitriseAppSlug in
 * ~/.foreman/config.json.
 *
 * Kept as its own domain because CI/CD is a distinct concern from Slack
 * communication, project management, or code hosting.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execSync } from "child_process";
import { readConfig } from "./config.js";
import { getState } from "./session.js";

export interface BitriseMcpContext {
  channelId: string;
}

export function createBitriseTools(ctx: BitriseMcpContext) {
  const { channelId } = ctx;

  return [
    tool(
      "TriggerBitrise",
      "Trigger a Bitrise CI workflow on the current git branch. Use this when asked to run a Bitrise build, trigger CI, or ship to TestFlight. " +
      "Reads bitriseToken and bitriseAppSlug from ~/.foreman/config.json. Returns the build number and URL.",
      {
        workflow: z.string().describe("The Bitrise workflow ID to trigger (e.g. 'TestFlightAndS3', 'BuildQaRelease')"),
      },
      async ({ workflow }) => {
        try {
          const config = readConfig();
          const token = config.bitriseToken;
          const appSlug = config.bitriseAppSlug;
          if (!token || !appSlug) {
            return { content: [{ type: "text" as const, text: ":x: Bitrise not configured. Add `bitriseToken` and `bitriseAppSlug` to `~/.foreman/config.json`." }] };
          }
          const cwd = getState(channelId).cwd;
          const branch = execSync("git branch --show-current", { cwd, encoding: "utf8" }).trim();
          if (!branch) return { content: [{ type: "text" as const, text: ":x: Could not determine current git branch." }] };

          const res = await fetch(`https://api.bitrise.io/v0.1/apps/${appSlug}/builds`, {
            method: "POST",
            headers: { "Authorization": token, "Content-Type": "application/json" },
            body: JSON.stringify({
              hook_info: { type: "bitrise" },
              build_params: { branch, workflow_id: workflow },
            }),
          });
          const json = await res.json() as Record<string, unknown>;
          if (!res.ok || json.status !== "ok") {
            return { content: [{ type: "text" as const, text: `:x: Bitrise API error: ${JSON.stringify(json)}` }] };
          }
          const buildUrl = json.build_url as string;
          const buildNumber = json.build_number as number;
          return { content: [{ type: "text" as const, text: `:white_check_mark: Build *#${buildNumber}* triggered!\n• Workflow: \`${workflow}\`\n• Branch: \`${branch}\`\n• ${buildUrl}` }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `:x: Failed to trigger Bitrise: ${err instanceof Error ? err.message : String(err)}` }] };
        }
      }
    ),
  ];
}
