/**
 * mcp-atlassian.ts — foreman-atlassian toolbelt
 *
 * All Jira and Confluence tools. Requires jiraToken, jiraEmail, jiraHost,
 * confluenceToken in ~/.foreman/config.json.
 *
 * Kept separate from foreman-slack to avoid token burn for bots that don't
 * need project management tools (e.g. council bots, general-purpose chat bots).
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  createJiraIssue,
  readJiraIssue,
  updateJiraIssue,
  deleteJiraIssue,
  searchJiraIssues,
  addJiraComment,
  updateJiraComment,
  deleteJiraComment,
  transitionJiraIssue,
  assignJiraIssue,
  getJiraTransitions,
  getJiraIssueEditMeta,
  setJiraField,
  getJiraProjectKey,
  getJiraHost,
} from "./jira.js";
import {
  readConfluencePage,
  searchConfluencePages,
  createConfluencePage,
  updateConfluencePage,
} from "./confluence.js";

export function createAtlassianTools() {
  return [
    // ── Jira ──────────────────────────────────────────────────────────────────

    tool(
      "JiraCreateTicket",
      "Create a Jira ticket in the configured project. Use this when the user asks to create a Jira ticket, story, task, or bug. " +
      "You can generate the summary and description from canvas content, conversation context, or user instructions.",
      {
        summary: z.string().describe("The ticket title/summary"),
        description: z.string().describe("The ticket description in markdown format. Supports headings, bullet lists, and paragraphs."),
        issueType: z.string().optional().describe("Issue type: Task, Story, Bug, Epic. Defaults to Task."),
        labels: z.array(z.string()).optional().describe("Optional labels to apply"),
        priority: z.string().optional().describe("Priority: Highest, High, Medium, Low, Lowest"),
        project: z.string().optional().describe("Jira project key (e.g. TECHOPS, POW). Defaults to the configured project."),
      },
      async ({ summary, description, issueType, labels, priority, project }) => {
        try {
          const result = await createJiraIssue({ summary, description, issueType, labels, priority, projectKey: project });
          return { content: [{ type: "text" as const, text: `Created ${result.key}: ${result.url}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error creating Jira ticket: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraReadTicket",
      "Read the details of a specific Jira ticket by its key (e.g. POW-123). " +
      "Returns the summary, status, assignee, description, type, priority, labels, and comments.",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. POW-123)"),
      },
      async ({ issueKey }) => {
        try {
          const issue = await readJiraIssue(issueKey);
          const lines = [
            `**${issue.key}**: ${issue.summary}`,
            `**Type**: ${issue.issueType} | **Status**: ${issue.status} | **Priority**: ${issue.priority}`,
            issue.assignee ? `**Assignee**: ${issue.assignee}` : "**Assignee**: Unassigned",
            issue.labels.length > 0 ? `**Labels**: ${issue.labels.join(", ")}` : "",
            "",
            issue.description || "(no description)",
          ].filter(Boolean);
          if (issue.comments.length > 0) {
            lines.push("", "---", "**Comments:**");
            for (const c of issue.comments) {
              const date = new Date(c.created).toLocaleDateString();
              lines.push(`\n**${c.author}** (${date}) [id: ${c.id}]:\n${c.body}`);
            }
          }
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error reading Jira ticket: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraUpdateTicket",
      "Update an existing Jira ticket. Use this to change the summary, description, priority, or labels of a ticket. " +
      "Only the fields you provide will be updated — others remain unchanged.",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. POW-123)"),
        summary: z.string().optional().describe("New ticket title/summary"),
        description: z.string().optional().describe("New description in markdown format"),
        priority: z.string().optional().describe("New priority: Highest, High, Medium, Low, Lowest"),
        labels: z.array(z.string()).optional().describe("New labels (replaces existing labels)"),
      },
      async ({ issueKey, summary, description, priority, labels }) => {
        try {
          const result = await updateJiraIssue(issueKey, { summary, description, priority, labels });
          return { content: [{ type: "text" as const, text: `Updated ${result.key}: ${result.url}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error updating Jira ticket: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraDeleteTicket",
      "Permanently delete a Jira ticket. This action is IRREVERSIBLE — the ticket cannot be recovered. " +
      "Only use this when explicitly asked to delete a ticket, not to close or resolve it.",
      {
        issueKey: z.string().describe("The Jira issue key to delete (e.g. POW-123, TECHOPS-456)"),
      },
      async ({ issueKey }) => {
        try {
          await deleteJiraIssue(issueKey);
          return { content: [{ type: "text" as const, text: `Deleted ${issueKey}.` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error deleting Jira ticket: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraSearch",
      "Search Jira tickets using JQL (Jira Query Language). Use this to find tickets by status, assignee, sprint, labels, etc. " +
      `The configured project key is available for queries (e.g. 'project = ${(() => { try { return getJiraProjectKey(); } catch { return "PROJ"; } })()}').`,
      {
        jql: z.string().describe("JQL query string (e.g. 'project = POW AND status = \"In Progress\"')"),
        maxResults: z.number().optional().describe("Max results to return (default 10, max 50)"),
      },
      async ({ jql, maxResults }) => {
        try {
          const issues = await searchJiraIssues(jql, Math.min(maxResults || 10, 50));
          if (issues.length === 0) {
            return { content: [{ type: "text" as const, text: "No tickets found matching that query." }] };
          }
          const lines = issues.map(
            (i) => `**${i.key}** [${i.status}] ${i.summary} (${i.issueType}, ${i.priority}${i.assignee ? `, ${i.assignee}` : ""})`
          );
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error searching Jira: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraAddComment",
      "Add a comment to a Jira ticket.",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. POW-123)"),
        body: z.string().describe("Comment text in markdown format"),
      },
      async ({ issueKey, body }) => {
        try {
          const result = await addJiraComment(issueKey, body);
          const host = getJiraHost();
          return { content: [{ type: "text" as const, text: `Comment added to ${issueKey} (comment id: ${result.id})\n${host}/browse/${issueKey}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error adding comment: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraUpdateComment",
      "Update an existing comment on a Jira ticket. Requires the comment ID (visible when reading a ticket).",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. POW-123)"),
        commentId: z.string().describe("The comment ID to update"),
        body: z.string().describe("New comment text in markdown format"),
      },
      async ({ issueKey, commentId, body }) => {
        try {
          await updateJiraComment(issueKey, commentId, body);
          return { content: [{ type: "text" as const, text: `Comment ${commentId} updated on ${issueKey}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error updating comment: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraDeleteComment",
      "Delete a comment from a Jira ticket. Requires the comment ID (visible when reading a ticket).",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. POW-123)"),
        commentId: z.string().describe("The comment ID to delete"),
      },
      async ({ issueKey, commentId }) => {
        try {
          await deleteJiraComment(issueKey, commentId);
          return { content: [{ type: "text" as const, text: `Comment ${commentId} deleted from ${issueKey}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error deleting comment: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraTransitionTicket",
      "Move a Jira ticket to a new status (e.g. 'In Progress', 'Done', 'Backlog'). " +
      "If the exact status name is unknown, it will list available transitions.",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. TECHOPS-123)"),
        status: z.string().describe("Target status name (e.g. 'In Progress', 'Done', 'In Review')"),
      },
      async ({ issueKey, status }) => {
        try {
          await transitionJiraIssue(issueKey, status);
          return { content: [{ type: "text" as const, text: `${issueKey} moved to "${status}"` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error transitioning ticket: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraAssignTicket",
      "Assign a Jira ticket to the current user (default) or a specific account ID.",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. TECHOPS-123)"),
        accountId: z.string().optional().describe("Jira account ID to assign to. Omit to assign to yourself."),
      },
      async ({ issueKey, accountId }) => {
        try {
          await assignJiraIssue(issueKey, accountId);
          return { content: [{ type: "text" as const, text: `${issueKey} assigned${accountId ? ` to ${accountId}` : " to you"}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error assigning ticket: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraGetTransitions",
      "Get available status transitions for a Jira ticket, including required fields and their allowed values. " +
      "Use this before calling JiraTransitionTicket when you need to know valid status names or required fields.",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. TECHOPS-123)"),
      },
      async ({ issueKey }) => {
        try {
          const transitions = await getJiraTransitions(issueKey);
          const lines = transitions.map(t => {
            const fieldLines = Object.entries(t.fields).map(([name, meta]) => {
              const req = meta.required ? " (required)" : " (optional)";
              const vals = meta.allowedValues.length > 0 ? `: ${meta.allowedValues.join(", ")}` : "";
              return `    - ${name}${req}${vals}`;
            });
            return [`**${t.name}**`, ...fieldLines].join("\n");
          });
          return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error getting transitions: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraGetFieldOptions",
      "Get all editable fields for a Jira ticket with their allowed values. " +
      "Use this to find valid options for custom fields like Work Allocation, Work Type, or Story Points before setting them.",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. TECHOPS-123)"),
      },
      async ({ issueKey }) => {
        try {
          const fields = await getJiraIssueEditMeta(issueKey);
          const lines = Object.entries(fields)
            .filter(([, meta]) => meta.allowedValues.length > 0 || meta.required)
            .map(([name, meta]) => {
              const req = meta.required ? " *(required)*" : "";
              const vals = meta.allowedValues.length > 0 ? `\n  Options: ${meta.allowedValues.map(v => v.name).join(", ")}` : "";
              return `**${name}**${req} \`${meta.fieldId}\`${vals}`;
            });
          return { content: [{ type: "text" as const, text: lines.join("\n\n") || "No constrained fields found." }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error getting field options: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "JiraSetField",
      "Set a field on a Jira ticket by field name. Use JiraGetFieldOptions first to see valid field names and allowed values. " +
      "For Story Points pass a number as a string. For select fields (Work Allocation, Work Type) pass the option name exactly.",
      {
        issueKey: z.string().describe("The Jira issue key (e.g. TECHOPS-123)"),
        fieldName: z.string().describe("Field name exactly as returned by JiraGetFieldOptions (e.g. 'Story Points', 'Work Type')"),
        value: z.string().describe("Value to set. For select fields use the option name; for number fields use the number as a string."),
      },
      async ({ issueKey, fieldName, value }) => {
        try {
          const numVal = Number(value);
          await setJiraField(issueKey, fieldName, isNaN(numVal) ? value : numVal);
          return { content: [{ type: "text" as const, text: `Set "${fieldName}" to "${value}" on ${issueKey}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error setting field: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),

    // ── Confluence ────────────────────────────────────────────────────────────

    tool(
      "ConfluenceReadPage",
      "Read a Confluence page by its page ID. Returns the title, body content, and URL. " +
      "Use this when the user asks to read or reference a Confluence page.",
      {
        pageId: z.string().describe("The Confluence page ID (numeric string)"),
      },
      async ({ pageId }) => {
        try {
          const page = await readConfluencePage(pageId);
          const lines = [
            `**${page.title}**`,
            `Status: ${page.status} | Version: ${page.version}`,
            `URL: ${page.url}`,
            "",
            page.body || "(empty page)",
          ];
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error reading Confluence page: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "ConfluenceSearch",
      "Search Confluence pages using CQL (Confluence Query Language). " +
      "Examples: 'title = \"My Page\"', 'text ~ \"acceptance criteria\"', 'space = POW AND type = page'.",
      {
        cql: z.string().describe("CQL query string (e.g. 'title ~ \"design doc\"')"),
        maxResults: z.number().optional().describe("Max results to return (default 10)"),
      },
      async ({ cql, maxResults }) => {
        try {
          const pages = await searchConfluencePages(cql, Math.min(maxResults || 10, 25));
          if (pages.length === 0) {
            return { content: [{ type: "text" as const, text: "No pages found matching that query." }] };
          }
          const lines = pages.map(
            (p) => `**${p.title}** (ID: ${p.id}) — ${p.url}\n${p.body ? p.body.substring(0, 150) + "..." : "(no excerpt)"}`
          );
          return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error searching Confluence: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "ConfluenceCreatePage",
      "Create a new Confluence page. Requires a space ID and title. " +
      "Use ConfluenceSearch to find the space ID if needed (search for an existing page in the space).",
      {
        title: z.string().describe("The page title"),
        body: z.string().describe("The page body in markdown format"),
        spaceId: z.string().describe("The Confluence space ID (numeric string)"),
        parentId: z.string().optional().describe("Optional parent page ID to nest under"),
      },
      async ({ title, body, spaceId, parentId }) => {
        try {
          const result = await createConfluencePage({ title, body, spaceId, parentId });
          return { content: [{ type: "text" as const, text: `Created page: ${result.url}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error creating Confluence page: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
    tool(
      "ConfluenceUpdatePage",
      "Update an existing Confluence page. Only the fields you provide will be changed. " +
      "Automatically increments the version number.",
      {
        pageId: z.string().describe("The Confluence page ID (numeric string)"),
        title: z.string().optional().describe("New page title"),
        body: z.string().optional().describe("New page body in markdown format"),
      },
      async ({ pageId, title, body }) => {
        try {
          const result = await updateConfluencePage(pageId, { title, body });
          return { content: [{ type: "text" as const, text: `Updated page: ${result.url} (version ${result.previousVersion} → ${result.version})\nDEBUG: ${result.debug}` }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error updating Confluence page: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
  ];
}
