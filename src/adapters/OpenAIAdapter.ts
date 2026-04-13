import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname, join } from "path";
import { homedir } from "os";
import { readConfig } from "../config.js";
import { getState, setRunning, setAbortController } from "../session.js";
import type { AgentAdapter, AgentOptions, QueryResult } from "./AgentAdapter.js";
import type { App } from "@slack/bolt";
import { createJiraIssue, readJiraIssue, updateJiraIssue, deleteJiraIssue, searchJiraIssues, addJiraComment, updateJiraComment, deleteJiraComment, getJiraProjectKey, getJiraHost } from "../jira.js";
import { readConfluencePage, searchConfluencePages, createConfluencePage, updateConfluencePage } from "../confluence.js";
import { createPR, readPR, readPRComments, readIssue, searchGitHub, listPRs } from "../github.js";
import { fetchChannelCanvas, appendCanvasContent, updateCanvasSection, deleteCanvasSection, readCanvasById, updateCanvasById, deleteCanvasById } from "../canvas.js";

// Tool definitions in OpenAI function-calling schema
export const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "ReadFile",
      description: "Read the full contents of a file. Use absolute paths or paths relative to the working directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or cwd-relative path to the file." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "WriteFile",
      description: "Write content to a file, creating it (and any parent directories) if it does not exist, or overwriting it if it does.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or cwd-relative path to the file." },
          content: { type: "string", description: "The full content to write to the file." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ListFiles",
      description: "List files matching a glob pattern. Use this to explore directory structure or find files by name.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. 'src/**/*.ts', '*.json'). Relative to cwd." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "SearchFiles",
      description: "Search file contents for a regex pattern. Returns matching lines with file path and line number.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for." },
          path: { type: "string", description: "Directory or file to search in. Defaults to cwd." },
          glob: { type: "string", description: "Optional glob to filter files (e.g. '*.ts')." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "RunBash",
      description: "Run a shell command and return stdout and stderr. Use for git commands, running tests, installing dependencies, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "EditFile",
      description: "Replace an exact string in a file with a new string. The old_string must match exactly (including whitespace and indentation). Fails if old_string is not found or matches more than once.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or cwd-relative path to the file." },
          old_string: { type: "string", description: "The exact string to find and replace." },
          new_string: { type: "string", description: "The string to replace it with." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  // Jira
  { type: "function", function: { name: "JiraCreateTicket", description: "Create a Jira ticket.", parameters: { type: "object", properties: { summary: { type: "string" }, description: { type: "string" }, issueType: { type: "string", description: "Task, Story, Bug, or Epic. Default: Task." }, labels: { type: "array", items: { type: "string" } }, priority: { type: "string", description: "Highest, High, Medium, Low, or Lowest." }, project: { type: "string", description: "Jira project key (e.g. TECHOPS, POW). Defaults to the configured project." } }, required: ["summary", "description"] } } },
  { type: "function", function: { name: "JiraReadTicket", description: "Read a Jira ticket by key (e.g. POW-123).", parameters: { type: "object", properties: { issueKey: { type: "string" } }, required: ["issueKey"] } } },
  { type: "function", function: { name: "JiraUpdateTicket", description: "Update fields on a Jira ticket.", parameters: { type: "object", properties: { issueKey: { type: "string" }, summary: { type: "string" }, description: { type: "string" }, priority: { type: "string" }, labels: { type: "array", items: { type: "string" } } }, required: ["issueKey"] } } },
  { type: "function", function: { name: "JiraDeleteTicket", description: "Permanently delete a Jira ticket. IRREVERSIBLE — cannot be recovered. Only use when explicitly asked to delete, not to close or resolve.", parameters: { type: "object", properties: { issueKey: { type: "string", description: "The Jira issue key (e.g. POW-123, TECHOPS-456)" } }, required: ["issueKey"] } } },
  { type: "function", function: { name: "JiraSearch", description: "Search Jira using JQL.", parameters: { type: "object", properties: { jql: { type: "string" }, maxResults: { type: "number" } }, required: ["jql"] } } },
  { type: "function", function: { name: "JiraAddComment", description: "Add a comment to a Jira ticket.", parameters: { type: "object", properties: { issueKey: { type: "string" }, body: { type: "string" } }, required: ["issueKey", "body"] } } },
  { type: "function", function: { name: "JiraUpdateComment", description: "Update a comment on a Jira ticket.", parameters: { type: "object", properties: { issueKey: { type: "string" }, commentId: { type: "string" }, body: { type: "string" } }, required: ["issueKey", "commentId", "body"] } } },
  { type: "function", function: { name: "JiraDeleteComment", description: "Delete a comment from a Jira ticket.", parameters: { type: "object", properties: { issueKey: { type: "string" }, commentId: { type: "string" } }, required: ["issueKey", "commentId"] } } },
  // Confluence
  { type: "function", function: { name: "ConfluenceReadPage", description: "Read a Confluence page by ID.", parameters: { type: "object", properties: { pageId: { type: "string" } }, required: ["pageId"] } } },
  { type: "function", function: { name: "ConfluenceSearch", description: "Search Confluence using CQL.", parameters: { type: "object", properties: { cql: { type: "string" }, maxResults: { type: "number" } }, required: ["cql"] } } },
  { type: "function", function: { name: "ConfluenceCreatePage", description: "Create a Confluence page.", parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, spaceId: { type: "string" }, parentId: { type: "string" } }, required: ["title", "body", "spaceId"] } } },
  { type: "function", function: { name: "ConfluenceUpdatePage", description: "Update a Confluence page.", parameters: { type: "object", properties: { pageId: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["pageId"] } } },
  // GitHub
  { type: "function", function: { name: "GitHubCreatePR", description: "Create a GitHub pull request.", parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, base: { type: "string" }, draft: { type: "boolean" } }, required: ["title", "body"] } } },
  { type: "function", function: { name: "GitHubReadPR", description: "Read a GitHub pull request.", parameters: { type: "object", properties: { prNumber: { type: "number" }, includeComments: { type: "boolean" } }, required: ["prNumber"] } } },
  { type: "function", function: { name: "GitHubReadIssue", description: "Read a GitHub issue.", parameters: { type: "object", properties: { issueNumber: { type: "number" } }, required: ["issueNumber"] } } },
  { type: "function", function: { name: "GitHubSearch", description: "Search GitHub issues and PRs.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "GitHubListPRs", description: "List pull requests for the current repo.", parameters: { type: "object", properties: { state: { type: "string", description: "open, closed, merged, or all. Default: open." } }, required: [] } } },
  // Canvas
  { type: "function", function: { name: "CanvasRead", description: "Read the current channel's Slack canvas as markdown. Pass channel_id to read a different channel's canvas.", parameters: { type: "object", properties: { channel_id: { type: "string", description: "Optional channel ID to read from a different channel. Omit for current channel." } }, required: [] } } },
  { type: "function", function: { name: "CanvasCreate", description: "Append new content to the channel canvas. Always start with a heading (## Heading).", parameters: { type: "object", properties: { markdown: { type: "string" } }, required: ["markdown"] } } },
  { type: "function", function: { name: "CanvasUpdate", description: "Update a section of the canvas by heading text. Call CanvasRead first.", parameters: { type: "object", properties: { sectionHeading: { type: "string" }, markdown: { type: "string" } }, required: ["sectionHeading", "markdown"] } } },
  { type: "function", function: { name: "CanvasDelete", description: "Delete a section from the canvas by heading text.", parameters: { type: "object", properties: { sectionHeading: { type: "string" } }, required: ["sectionHeading"] } } },
  { type: "function", function: { name: "CanvasReadById", description: "Read a canvas element by its raw ID.", parameters: { type: "object", properties: { sectionId: { type: "string" } }, required: ["sectionId"] } } },
  { type: "function", function: { name: "CanvasUpdateById", description: "Update a canvas element by its raw ID.", parameters: { type: "object", properties: { sectionId: { type: "string" }, markdown: { type: "string" } }, required: ["sectionId", "markdown"] } } },
  { type: "function", function: { name: "CanvasDeleteById", description: "Delete a canvas element by its raw ID.", parameters: { type: "object", properties: { sectionId: { type: "string" } }, required: ["sectionId"] } } },
  // Messaging
  { type: "function", function: { name: "PostMessage", description: "Post a message to any Slack channel.", parameters: { type: "object", properties: { channel: { type: "string", description: "Channel ID or name." }, text: { type: "string" } }, required: ["channel", "text"] } } },
  { type: "function", function: { name: "ReadChannel", description: "Read recent messages from a Slack channel. The bot must be a member.", parameters: { type: "object", properties: { channel: { type: "string", description: "Channel ID or name." }, limit: { type: "number", description: "Number of messages to fetch (default: 20, max: 100)." } }, required: ["channel"] } } },
  { type: "function", function: { name: "DiagramCreate", description: "Render a Mermaid diagram and post it as an image to the Slack channel.", parameters: { type: "object", properties: { mermaid: { type: "string", description: "Valid Mermaid syntax." }, title: { type: "string" } }, required: ["mermaid"] } } },
  // Utility
  { type: "function", function: { name: "TriggerBitrise", description: "Trigger a Bitrise CI workflow on the current git branch.", parameters: { type: "object", properties: { workflow: { type: "string" } }, required: ["workflow"] } } },
  { type: "function", function: { name: "LaunchApp", description: "Build and launch the iOS or Android app on a booted simulator/emulator.", parameters: { type: "object", properties: {}, required: [] } } },
];

// Tools that require user approval before executing
export const APPROVAL_REQUIRED = new Set(["WriteFile", "EditFile", "RunBash"]);

// Execute a tool call and return the result as a string
export async function executeTool(name: string, args: Record<string, unknown>, cwd: string, channelId: string, app?: App): Promise<string> {
  if (name === "ReadFile") {
    const path = args.path as string;
    try {
      const resolved = path.startsWith("/") ? path : resolve(cwd, path);
      return readFileSync(resolved, "utf8");
    } catch (err) {
      return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "WriteFile") {
    const path = args.path as string;
    const content = args.content as string;
    try {
      const resolved = path.startsWith("/") ? path : resolve(cwd, path);
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, content, "utf8");
      return `File written: ${resolved}`;
    } catch (err) {
      return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "EditFile") {
    const path = args.path as string;
    const oldString = args.old_string as string;
    const newString = args.new_string as string;
    try {
      const resolved = path.startsWith("/") ? path : resolve(cwd, path);
      const content = readFileSync(resolved, "utf8");
      const count = content.split(oldString).length - 1;
      if (count === 0) return `Error: old_string not found in ${resolved}`;
      if (count > 1) return `Error: old_string matched ${count} times — must be unique`;
      writeFileSync(resolved, content.replace(oldString, newString), "utf8");
      return `File edited: ${resolved}`;
    } catch (err) {
      return `Error editing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "ListFiles") {
    const pattern = args.pattern as string;
    try {
      const output = execSync(`find . -path "./${pattern}" -o -path "${pattern}" 2>/dev/null | sort`, {
        cwd,
        encoding: "utf8",
        timeout: 15000,
      });
      return output.trim() || "(no files matched)";
    } catch (err) {
      return `Error listing files: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "SearchFiles") {
    const pattern = args.pattern as string;
    const searchPath = args.path ? resolve(cwd, args.path as string) : cwd;
    const fileGlob = args.glob as string | undefined;
    try {
      const globArg = fileGlob ? `--glob "${fileGlob}"` : "";
      const output = execSync(`rg --line-number ${globArg} "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null || true`, {
        encoding: "utf8",
        timeout: 15000,
      });
      return output.trim() || "(no matches)";
    } catch (err) {
      return `Error searching files: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (name === "RunBash") {
    const command = args.command as string;
    try {
      const output = execSync(command, { cwd, encoding: "utf8", timeout: 5 * 60 * 1000, stdio: ["pipe", "pipe", "pipe"] });
      return output || "(no output)";
    } catch (err: any) {
      const stdout = err.stdout || "";
      const stderr = err.stderr || "";
      return [stdout, stderr].filter(Boolean).join("\n") || `Error: ${err.message}`;
    }
  }
  // Jira
  if (name === "JiraCreateTicket") {
    try {
      const result = await createJiraIssue({ summary: args.summary as string, description: args.description as string, issueType: args.issueType as string | undefined, labels: args.labels as string[] | undefined, priority: args.priority as string | undefined, projectKey: args.project as string | undefined });
      return `Created ${result.key}: ${result.url}`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "JiraReadTicket") {
    try {
      const issue = await readJiraIssue(args.issueKey as string);
      const lines = [`**${issue.key}**: ${issue.summary}`, `Type: ${issue.issueType} | Status: ${issue.status} | Priority: ${issue.priority}`, issue.assignee ? `Assignee: ${issue.assignee}` : "Assignee: Unassigned", issue.labels.length > 0 ? `Labels: ${issue.labels.join(", ")}` : "", "", issue.description || "(no description)"].filter(Boolean);
      if (issue.comments.length > 0) { lines.push("", "---", "Comments:"); for (const c of issue.comments) lines.push(`${c.author}: ${c.body}`); }
      return lines.join("\n");
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "JiraUpdateTicket") {
    try {
      const result = await updateJiraIssue(args.issueKey as string, { summary: args.summary as string | undefined, description: args.description as string | undefined, priority: args.priority as string | undefined, labels: args.labels as string[] | undefined });
      return `Updated ${result.key}: ${result.url}`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "JiraDeleteTicket") {
    try {
      await deleteJiraIssue(args.issueKey as string);
      return `Deleted ${args.issueKey}.`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "JiraSearch") {
    try {
      const issues = await searchJiraIssues(args.jql as string, Math.min((args.maxResults as number) || 10, 50));
      if (issues.length === 0) return "No tickets found.";
      return issues.map(i => `**${i.key}** [${i.status}] ${i.summary}`).join("\n");
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "JiraAddComment") {
    try {
      const result = await addJiraComment(args.issueKey as string, args.body as string);
      return `Comment added to ${args.issueKey} (id: ${result.id})`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "JiraUpdateComment") {
    try {
      await updateJiraComment(args.issueKey as string, args.commentId as string, args.body as string);
      return `Comment ${args.commentId} updated on ${args.issueKey}`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "JiraDeleteComment") {
    try {
      await deleteJiraComment(args.issueKey as string, args.commentId as string);
      return `Comment ${args.commentId} deleted from ${args.issueKey}`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  // Confluence
  if (name === "ConfluenceReadPage") {
    try {
      const page = await readConfluencePage(args.pageId as string);
      return [`**${page.title}**`, `Status: ${page.status} | URL: ${page.url}`, "", page.body || "(empty)"].join("\n");
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "ConfluenceSearch") {
    try {
      const pages = await searchConfluencePages(args.cql as string, Math.min((args.maxResults as number) || 10, 25));
      if (pages.length === 0) return "No pages found.";
      return pages.map(p => `**${p.title}** (ID: ${p.id}) — ${p.url}`).join("\n");
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "ConfluenceCreatePage") {
    try {
      const result = await createConfluencePage({ title: args.title as string, body: args.body as string, spaceId: args.spaceId as string, parentId: args.parentId as string | undefined });
      return `Created page: ${result.url}`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "ConfluenceUpdatePage") {
    try {
      const result = await updateConfluencePage(args.pageId as string, { title: args.title as string | undefined, body: args.body as string | undefined });
      return `Updated page: ${result.url}`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  // GitHub
  if (name === "GitHubCreatePR") {
    try {
      const result = createPR({ title: args.title as string, body: args.body as string, base: args.base as string | undefined, draft: args.draft as boolean | undefined }, cwd);
      return `Created PR #${result.number}: ${result.url}`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "GitHubReadPR") {
    try {
      const pr = readPR(args.prNumber as number, cwd);
      const lines = [`**PR #${pr.number}: ${pr.title}**`, `State: ${pr.state} | Author: ${pr.author}`, `URL: ${pr.url}`, "", pr.body || "(no description)"];
      if (args.includeComments) lines.push("", "---", readPRComments(args.prNumber as number, cwd));
      return lines.join("\n");
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "GitHubReadIssue") {
    try {
      const issue = readIssue(args.issueNumber as number, cwd);
      return [`**#${issue.number}: ${issue.title}**`, `State: ${issue.state} | Author: ${issue.author}`, `URL: ${issue.url}`, "", issue.body || "(no description)"].join("\n");
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "GitHubSearch") {
    try {
      const results = JSON.parse(searchGitHub(args.query as string, cwd));
      if (results.length === 0) return "No results found.";
      return results.map((r: any) => `**#${r.number}** [${r.state}] ${r.title}\n${r.url}`).join("\n\n");
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "GitHubListPRs") {
    try {
      const prs = listPRs(cwd, (args.state as string) || "open");
      if (prs.length === 0) return "No PRs found.";
      return prs.map((pr: any) => `**#${pr.number}** [${pr.state}] ${pr.title}\n${pr.url}`).join("\n\n");
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  // Utility
  if (name === "TriggerBitrise") {
    try {
      const config = readConfig();
      if (!config.bitriseToken || !config.bitriseAppSlug) return "Bitrise not configured. Add bitriseToken and bitriseAppSlug to ~/.foreman/config.json";
      const branch = execSync("git branch --show-current", { cwd, encoding: "utf8" }).trim();
      const res = await fetch(`https://api.bitrise.io/v0.1/apps/${config.bitriseAppSlug}/builds`, {
        method: "POST",
        headers: { "Authorization": config.bitriseToken, "Content-Type": "application/json" },
        body: JSON.stringify({ hook_info: { type: "bitrise" }, build_params: { branch, workflow_id: args.workflow } }),
      });
      const json = await res.json() as Record<string, unknown>;
      if (!res.ok || json.status !== "ok") return `Bitrise API error: ${JSON.stringify(json)}`;
      return `Build #${json.build_number} triggered on branch ${branch}: ${json.build_url}`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "LaunchApp") {
    try {
      const hasXcworkspace = execSync("find . -maxdepth 1 -name '*.xcworkspace' | head -1", { cwd, encoding: "utf8" }).trim() !== "";
      const hasGradlew = existsSync(join(cwd, "gradlew"));
      if (hasXcworkspace) {
        const workspace = execSync("find . -maxdepth 1 -name '*.xcworkspace' | head -1", { cwd, encoding: "utf8" }).trim().replace(/^\.\//, "");
        const scheme = workspace.replace(/\.xcworkspace$/, "");
        const simList = execSync("xcrun simctl list devices --json", { encoding: "utf8" });
        const json = JSON.parse(simList) as { devices: Record<string, { udid: string; name: string; state: string }[]> };
        const booted = Object.values(json.devices).flat().find(d => d.state === "Booted");
        if (!booted) return "No booted simulator found.";
        const derivedDataRoot = join(homedir(), "Library/Developer/Xcode/DerivedData");
        const ddEntries = execSync(`ls "${derivedDataRoot}"`, { encoding: "utf8" }).trim().split("\n");
        let appPath = "";
        for (const entry of ddEntries) {
          const infoPlist = join(derivedDataRoot, entry, "info.plist");
          if (!existsSync(infoPlist)) continue;
          try {
            const wsPath = execSync(`plutil -extract WorkspacePath raw "${infoPlist}" 2>/dev/null`, { encoding: "utf8" }).trim();
            if (wsPath === join(cwd, workspace)) {
              const productsDir = join(derivedDataRoot, entry, "Build/Products/Debug-iphonesimulator");
              const apps = execSync(`ls -d "${productsDir}"/*.app 2>/dev/null`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
              if (apps.length > 0) { appPath = apps[0]; break; }
            }
          } catch { /* skip */ }
        }
        if (!appPath) return "No built app found. Run a build first.";
        execSync(`xcrun simctl install "${booted.udid}" "${appPath}"`, { encoding: "utf8" });
        const bundleId = execSync(`plutil -extract CFBundleIdentifier raw "${appPath}/Info.plist" 2>/dev/null`, { encoding: "utf8" }).trim();
        if (bundleId) execSync(`xcrun simctl launch "${booted.udid}" "${bundleId}"`, { encoding: "utf8" });
        return `Launched ${scheme} on ${booted.name}`;
      } else if (hasGradlew) {
        return "Android launch via OpenAI adapter not yet implemented. Use RunBash to run gradlew manually.";
      }
      return `Could not detect platform in ${cwd}. No .xcworkspace or gradlew found.`;
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}`; }
  }
  // Canvas (requires app)
  if (name === "CanvasRead") {
    if (!app) return "Canvas tools require Slack app context.";
    try {
      const targetChannel = (args.channel_id as string) || channelId;
      const canvas = await fetchChannelCanvas(app, targetChannel);
      if (!canvas) return `No canvas found for channel ${targetChannel}.`;
      if (!args.channel_id) { const { setCanvasFileId } = await import("../session.js"); setCanvasFileId(channelId, canvas.fileId); }
      return canvas.content;
    } catch (err) { return `Error reading canvas: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "CanvasCreate") {
    if (!app) return "Canvas tools require Slack app context.";
    try {
      const state = getState(channelId);
      if (!state.canvasFileId) return "No canvas loaded. Call CanvasRead first.";
      const botName = state.name ?? "Foreman";
      await appendCanvasContent(app, state.canvasFileId, args.markdown as string, botName);
      return "Content appended to canvas.";
    } catch (err) { return `Error appending to canvas: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "CanvasUpdate") {
    if (!app) return "Canvas tools require Slack app context.";
    try {
      const state = getState(channelId);
      if (!state.canvasFileId) return "No canvas loaded. Call CanvasRead first.";
      const botName = state.name ?? "Foreman";
      const result = await updateCanvasSection(app, state.canvasFileId, args.sectionHeading as string, args.markdown as string, botName);
      return result.found ? `Section "${args.sectionHeading}" updated.` : result.reason || `Section not found. Call CanvasRead to see current sections.`;
    } catch (err) { return `Error updating canvas: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "CanvasDelete") {
    if (!app) return "Canvas tools require Slack app context.";
    try {
      const state = getState(channelId);
      if (!state.canvasFileId) return "No canvas loaded. Call CanvasRead first.";
      const botName = state.name ?? "Foreman";
      const count = await deleteCanvasSection(app, state.canvasFileId, args.sectionHeading as string, botName);
      return count === 0 ? "Section not found." : `Deleted ${count} section(s).`;
    } catch (err) { return `Error deleting canvas section: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "CanvasReadById") {
    if (!app) return "Canvas tools require Slack app context.";
    try {
      const canvas = await fetchChannelCanvas(app, channelId);
      if (!canvas) return "No canvas found.";
      const text = readCanvasById(canvas.content, args.sectionId as string);
      return text ?? `No element found with ID "${args.sectionId}".`;
    } catch (err) { return `Error reading canvas element: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "CanvasUpdateById") {
    if (!app) return "Canvas tools require Slack app context.";
    try {
      const state = getState(channelId);
      if (!state.canvasFileId) return "No canvas loaded. Call CanvasRead first.";
      const botName = state.name ?? "Foreman";
      await updateCanvasById(app, state.canvasFileId, args.sectionId as string, args.markdown as string, botName);
      return `Updated element ${args.sectionId}.`;
    } catch (err) { return `Error updating canvas element: ${err instanceof Error ? err.message : String(err)}`; }
  }
  if (name === "CanvasDeleteById") {
    if (!app) return "Canvas tools require Slack app context.";
    try {
      const state = getState(channelId);
      if (!state.canvasFileId) return "No canvas loaded. Call CanvasRead first.";
      await deleteCanvasById(app, state.canvasFileId, args.sectionId as string);
      return `Deleted element ${args.sectionId}.`;
    } catch (err) { return `Error deleting canvas element: ${err instanceof Error ? err.message : String(err)}`; }
  }
  // PostMessage
  if (name === "PostMessage") {
    if (!app) return "PostMessage requires Slack app context.";
    try {
      let target = args.channel as string;
      const mentionMatch = target.match(/<#([A-Z0-9]+)/);
      if (mentionMatch) {
        target = mentionMatch[1];
      } else if (!target.match(/^[A-Z0-9]{8,}$/)) {
        const listRes = await app.client.conversations.list({ types: "public_channel,private_channel", limit: 1000 }).catch(() => ({ channels: [] }));
        const found = (listRes.channels || []).find((c: any) => c.name === target.replace(/^#/, ""));
        if (found?.id) target = found.id;
      }
      const state = getState(channelId);
      const botName = state.name ?? "Foreman";
      const signedText = `${args.text as string}\n\n_— ${botName} (${state.model})_`;
      await app.client.chat.postMessage({ channel: target, text: signedText });
      return `Message posted to ${args.channel}.`;
    } catch (err) { return `Error posting message: ${err instanceof Error ? err.message : String(err)}`; }
  }
  // ReadChannel
  if (name === "ReadChannel") {
    if (!app) return "ReadChannel requires Slack app context.";
    try {
      let target = args.channel as string;
      const mentionMatch = target.match(/<#([A-Z0-9]+)/);
      if (mentionMatch) {
        target = mentionMatch[1];
      } else if (!target.match(/^[A-Z0-9]{8,}$/)) {
        const listRes = await app.client.conversations.list({ types: "public_channel,private_channel", limit: 1000 }).catch(() => ({ channels: [] }));
        const found = (listRes.channels || []).find((c: any) => c.name === target.replace(/^#/, ""));
        if (found?.id) target = found.id;
      }
      const msgLimit = Math.min((args.limit as number) ?? 20, 100);
      const res = await app.client.conversations.history({ channel: target, limit: msgLimit });
      const messages = (res.messages || []).reverse();
      if (messages.length === 0) return `No messages found in channel ${args.channel}.`;
      const lines = messages.map((msg: any) => {
        const ts = msg.ts ? new Date(Number(msg.ts) * 1000).toISOString() : "?";
        const sender = msg.bot_id ? `[bot:${msg.username || "unknown"}]` : `<@${msg.user || "unknown"}>`;
        return `[${ts}] ${sender}: ${msg.text || "(no text)"}`;
      });
      return lines.join("\n");
    } catch (err) { return `Error reading channel: ${err instanceof Error ? err.message : String(err)}`; }
  }
  // DiagramCreate
  if (name === "DiagramCreate") {
    if (!app) return "DiagramCreate requires Slack app context.";
    try {
      const encoded = Buffer.from(args.mermaid as string).toString("base64url");
      const url = `https://mermaid.ink/img/${encoded}?type=png&bgColor=white`;
      const res = await fetch(url);
      if (!res.ok) return `Mermaid rendering failed: HTTP ${res.status}. Check your syntax.`;
      const imageBuffer = Buffer.from(await res.arrayBuffer());
      const title = (args.title as string) || "diagram";
      const fileName = `${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
      await app.client.filesUploadV2({ channel_id: channelId, file: imageBuffer, filename: fileName, title });
      return `Diagram "${title}" posted to the channel.`;
    } catch (err) { return `Error creating diagram: ${err instanceof Error ? err.message : String(err)}`; }
  }
  return `Unknown tool: ${name}`;
}

const HISTORIES_FILE = join(homedir(), ".foreman", "openai-histories.json");
const MAX_HISTORY_MESSAGES = 200; // cap per channel to prevent unbounded growth

function loadHistoriesFromDisk(): Map<string, OpenAI.Chat.ChatCompletionMessageParam[]> {
  try {
    const data = JSON.parse(readFileSync(HISTORIES_FILE, "utf8")) as Record<string, OpenAI.Chat.ChatCompletionMessageParam[]>;
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function saveHistoriesToDisk(histories: Map<string, OpenAI.Chat.ChatCompletionMessageParam[]>): void {
  try {
    mkdirSync(dirname(HISTORIES_FILE), { recursive: true });
    const data: Record<string, OpenAI.Chat.ChatCompletionMessageParam[]> = {};
    for (const [channelId, history] of histories) {
      data[channelId] = history.slice(-MAX_HISTORY_MESSAGES);
    }
    writeFileSync(HISTORIES_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[openai] Failed to persist histories:", err);
  }
}

/**
 * OpenAIAdapter — chat completions with an agentic tool loop.
 * Persists per-channel conversation history to ~/.foreman/openai-histories.json.
 */
export class OpenAIAdapter implements AgentAdapter {
  private histories = loadHistoriesFromDisk();

  private getClient(): OpenAI {
    const config = readConfig();
    const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key not configured. Add `openaiApiKey` to ~/.foreman/config.json");
    return new OpenAI({ apiKey });
  }

  async start(options: AgentOptions & { cwd: string; name: string }): Promise<QueryResult> {
    this.histories.set(options.channelId, []);
    saveHistoriesToDisk(this.histories);
    return this.chat(options);
  }

  async resume(options: AgentOptions & { sessionId: string; cwd: string; name: string }): Promise<QueryResult> {
    return this.chat(options);
  }

  abort(channelId: string): void {
    const state = getState(channelId);
    if (state.abortController) {
      state.abortController.abort();
    }
  }

  private async chat(options: AgentOptions & { cwd: string; name: string }): Promise<QueryResult> {
    const { channelId, prompt, systemPrompt, onMessage, onProgress, onApprovalNeeded, abortController, cwd, app } = options;

    setRunning(channelId, true);
    if (abortController) setAbortController(channelId, abortController);

    try {
      const client = this.getClient();
      const state = getState(channelId);
      const model = (state.model && !state.model.startsWith("claude-")) ? state.model : "o4-mini";

      if (!this.histories.has(channelId)) {
        this.histories.set(channelId, []);
      }
      const history = this.histories.get(channelId)!;
      history.push({ role: "user", content: prompt });

      let finalText = "";
      let turns = 0;

      // Agentic loop: run → tool calls → run → ... → final response
      while (true) {
        if (abortController?.signal.aborted) break;
        turns++;

        const response = await client.chat.completions.create({
          model,
          messages: [{ role: "system", content: systemPrompt }, ...history],
          tools: TOOLS,
          tool_choice: "auto",
        });

        const message = response.choices[0].message;
        history.push(message);

        // No tool calls — we have the final answer
        if (!message.tool_calls?.length) {
          finalText = message.content || "";
          break;
        }

        // Execute each tool call and feed results back
        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== "function") continue;
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

          let result: string;
          if (APPROVAL_REQUIRED.has(toolName) && !getState(channelId).autoApprove) {
            const approval = await onApprovalNeeded(toolName, toolArgs);
            if (!approval.approved) {
              result = "User denied this action.";
            } else {
              result = await executeTool(toolName, toolArgs, cwd, channelId, app);
            }
          } else {
            if (onProgress) onProgress(toolName, toolArgs);
            result = await executeTool(toolName, toolArgs, cwd, channelId, app);
          }

          history.push({ role: "tool", tool_call_id: toolCall.id, content: result });
        }
      }

      saveHistoriesToDisk(this.histories);

      if (onMessage && finalText) {
        onMessage({ type: "text", text: finalText });
      }

      return { result: finalText, sessionId: channelId, cost: 0, turns, tokensIn: 0, tokensOut: 0 };
    } finally {
      setRunning(channelId, false);
      setAbortController(channelId, null);
    }
  }
}
