/**
 * mcp-github.ts — foreman-github toolbelt
 *
 * GitHub tools: PR and issue management, code search.
 * Requires a GitHub personal access token in ~/.foreman/config.json.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createPR, readPR, readPRComments, readIssue, searchGitHub, listPRs } from "./github.js";
import { getState } from "./session.js";

export interface GitHubMcpContext {
  channelId: string;
}

export function createGitHubTools(ctx: GitHubMcpContext) {
  const { channelId } = ctx;

  return [
    tool(
      "GitHubCreatePR",
      "Create a GitHub pull request from the current branch. Requires the branch to be pushed to origin first.",
      {
        title: z.string().describe("PR title"),
        body: z.string().describe("PR description/body in markdown"),
        base: z.string().optional().describe("Base branch (defaults to repo default branch)"),
        draft: z.boolean().optional().describe("Create as draft PR"),
      },
      async ({ title, body, base, draft }) => {
        try {
          const cwd = getState(channelId).cwd;
          const result = createPR({ title, body, base, draft }, cwd);
          return { content: [{ type: "text" as const, text: `Created PR #${result.number}: ${result.url}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error creating PR: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "GitHubReadPR",
      "Read details of a GitHub pull request including title, state, author, branch, and body. " +
      "Optionally includes comments.",
      {
        prNumber: z.number().describe("The PR number"),
        includeComments: z.boolean().optional().describe("Include PR comments (default false)"),
      },
      async ({ prNumber, includeComments }) => {
        try {
          const cwd = getState(channelId).cwd;
          const pr = readPR(prNumber, cwd);
          const lines = [
            `**PR #${pr.number}: ${pr.title}**`,
            `State: ${pr.state} | Author: ${pr.author} | Branch: ${pr.branch}`,
            `URL: ${pr.url}`,
            "",
            pr.body || "(no description)",
          ];
          if (includeComments) {
            lines.push("", "---", "**Comments:**", "", readPRComments(prNumber, cwd));
          }
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error reading PR: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "GitHubReadIssue",
      "Read details of a GitHub issue including title, state, author, labels, and body.",
      {
        issueNumber: z.number().describe("The issue number"),
      },
      async ({ issueNumber }) => {
        try {
          const cwd = getState(channelId).cwd;
          const issue = readIssue(issueNumber, cwd);
          const lines = [
            `**#${issue.number}: ${issue.title}**`,
            `State: ${issue.state} | Author: ${issue.author}`,
            issue.labels.length > 0 ? `Labels: ${issue.labels.join(", ")}` : "",
            `URL: ${issue.url}`,
            "",
            issue.body || "(no description)",
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error reading issue: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "GitHubSearch",
      "Search GitHub issues and pull requests. Uses GitHub's search syntax.",
      {
        query: z.string().describe("Search query (e.g. 'is:pr is:open author:username', 'label:bug is:open')"),
      },
      async ({ query }) => {
        try {
          const cwd = getState(channelId).cwd;
          const json = searchGitHub(query, cwd);
          const results = JSON.parse(json);
          if (results.length === 0) {
            return { content: [{ type: "text" as const, text: "No results found." }] };
          }
          const lines = results.map((r: any) =>
            `**#${r.number}** [${r.state}] ${r.title}\n${r.url}`
          );
          return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error searching GitHub: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "GitHubListPRs",
      "List pull requests for the repository in the current working directory.",
      {
        state: z.string().optional().describe("Filter by state: open, closed, merged, or all. Default: open."),
      },
      async ({ state }) => {
        try {
          const cwd = getState(channelId).cwd;
          const results = listPRs(cwd, state || "open");
          if (results.length === 0) {
            return { content: [{ type: "text" as const, text: `No ${state || "open"} PRs found.` }] };
          }
          const lines = results.map((r: any) =>
            `**#${r.number}** [${r.state}] ${r.title} — ${r.author}\n${r.url}`
          );
          return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error listing PRs: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
  ];
}
