import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import type { App } from "@slack/bolt";
import { fetchChannelCanvas, fetchCanvasByFileId, listChannelCanvases, createChannelCanvas, appendCanvasContent, replaceCanvasContent, updateCanvasSection, deleteCanvas, deleteCanvasSection, readCanvasById, updateCanvasById, deleteCanvasById, getOwner, findCanvasSections } from "./canvas.js";
import { getState, setCanvasFileId } from "./session.js";
import { createJiraIssue, readJiraIssue, updateJiraIssue, deleteJiraIssue, searchJiraIssues, addJiraComment, updateJiraComment, deleteJiraComment, transitionJiraIssue, assignJiraIssue, getJiraTransitions, getJiraIssueEditMeta, setJiraField, getJiraProjectKey, getJiraHost } from "./jira.js";
import { readConfluencePage, searchConfluencePages, createConfluencePage, updateConfluencePage } from "./confluence.js";
import { createPR, readPR, readPRComments, readIssue, searchGitHub, listPRs } from "./github.js";
import { readConfig } from "./config.js";

/**
 * Create an in-process MCP server that exposes CRUD canvas tools with provenance tracking.
 * Each bot tags its headings with *[bot-name] Heading* so multiple bots can coexist.
 */
export function createCanvasMcpServer(channelId: string, app: App, isDM = false, transport: "slack" | "mattermost" = "slack") {
  const getBotName = () => getState(channelId).name ?? "Foreman";

  return createSdkMcpServer({
    name: "foreman-toolbelt",
    tools: [
      tool(
        "CanvasList",
        "List all canvases in a Slack channel. Returns canvas titles and canvas_ids. " +
        "Use a canvas_id from this list with CanvasRead, CanvasAppend, CanvasUpdate, or CanvasDelete. " +
        "Pass channel_id to list canvases in a specific channel. Omit to use the current channel.",
        {
          channel_id: z.string().optional().describe("Optional channel ID (e.g. 'C0ABC123'). Omit to list canvases in the current channel."),
        },
        async ({ channel_id }) => {
          const targetChannel = channel_id || channelId;
          try {
            const canvases = await listChannelCanvases(app, targetChannel);
            if (canvases.length === 0) {
              return { content: [{ type: "text" as const, text: `No canvases found in channel ${targetChannel}.` }] };
            }
            const list = canvases.map((c, i) => `${i + 1}. ${c.title}\n   canvas_id: ${c.fileId}`).join("\n\n");
            return { content: [{ type: "text" as const, text: `Found ${canvases.length} canvas(es) in ${targetChannel}:\n\n${list}` }] };
          } catch (err) {
            return { content: [{ type: "text" as const, text: `Error listing canvases: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        }
      ),
      tool(
        "CanvasRead",
        "Read the full content of a canvas. Pass a canvas_id (from CanvasList) to read a specific canvas. " +
        "Optionally pass a channel_id to read the default canvas of a specific channel. " +
        "Returns the raw HTML of the canvas. Each element has an id='temp:C:...' attribute — use these IDs with CanvasUpdateElementById and CanvasDeleteElementById. " +
        "Sections tagged with *[bot-name]* show which bot created them.",
        {
          canvas_id: z.string().optional().describe("Canvas ID (from CanvasList) to read a specific canvas. Preferred — use this when you have the ID."),
          channel_id: z.string().optional().describe("Optional channel ID (e.g. 'C0ABC123'). Used to find the default canvas of a channel when no canvas_id is provided."),
        },
        async ({ channel_id, canvas_id }) => {
          const targetChannel = channel_id || channelId;
          try {
            const canvas = canvas_id
              ? await fetchCanvasByFileId(app, canvas_id)
              : await fetchChannelCanvas(app, targetChannel);
            if (!canvas) {
              return { content: [{ type: "text" as const, text: canvas_id ? `No canvas found with ID: ${canvas_id}` : `No canvas found in channel ${targetChannel}.` }] };
            }
            if (!channel_id && !canvas_id) setCanvasFileId(channelId, canvas.fileId); // only cache for current channel default

            // Annotate the content with ownership info
            const botName = getBotName();
            const lines = canvas.content.split("\n");
            const annotations: string[] = [];
            for (const line of lines) {
              const owner = getOwner(line);
              if (owner === botName) {
                annotations.push(`${line}  ← (yours)`);
              } else if (owner) {
                annotations.push(`${line}  ← (by ${owner})`);
              } else {
                annotations.push(line);
              }
            }
            const annotatedContent = annotations.join("\n");

            const content: any[] = [{ type: "text" as const, text: annotatedContent }];
            for (const img of canvas.images) {
              content.push({ type: "image" as const, data: img.data, mimeType: img.mimeType });
            }
            return { content };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error reading canvas: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
      tool(
        "CanvasFindSection",
        "Search for sections in a canvas that contain specific text. Returns section IDs and their text content. " +
        "Use this to find the ID of a section you want to update or delete — then pass that ID to CanvasUpdateElementById or CanvasDeleteElementById. " +
        "Searches headings (h1/h2/h3), paragraphs, code blocks, quotes, and lists.",
        {
          canvas_id: z.string().describe("The canvas ID (from CanvasList)."),
          text: z.string().describe("Text to search for within the canvas sections."),
        },
        async ({ canvas_id, text }) => {
          try {
            const results = await findCanvasSections(app, canvas_id, text);
            if (results.length === 0) {
              return { content: [{ type: "text" as const, text: `No sections found containing "${text}".` }] };
            }
            const list = results.map(r => `type: ${r.type}\nid: ${r.id}\ntext: ${r.text}`).join("\n\n");
            return { content: [{ type: "text" as const, text: `Found ${results.length} section(s):\n\n${list}` }] };
          } catch (err) {
            return { content: [{ type: "text" as const, text: `Error finding sections: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        }
      ),
      tool(
        "CanvasCreate",
        "Create a brand new canvas in the current Slack channel. Use this when you need a new canvas — not to add content to an existing one. " +
        "Returns the canvas_id of the newly created canvas. Save this ID and use it with CanvasAppend, CanvasUpdate, and CanvasRead to work with the canvas. " +
        "Call GetCurrentChannel first if you are unsure which channel you are in.",
        {
          title: z.string().describe("The title of the new canvas (e.g. 'FlowSpec Reference', 'Project Tracker')."),
          markdown: z.string().optional().describe("Optional initial markdown content for the canvas. If omitted, the canvas is created empty."),
        },
        async ({ title, markdown }) => {
          try {
            const canvasId = await createChannelCanvas(app, channelId, title, markdown, getBotName());
            setCanvasFileId(channelId, canvasId);
            return {
              content: [{
                type: "text" as const,
                text: `Canvas created successfully.\nTitle: ${title}\nCanvas ID: ${canvasId}\n\nUse this canvas_id with CanvasAppend, CanvasUpdate, and CanvasRead to work with this canvas.`,
              }],
            };
          } catch (err) {
            return {
              content: [{
                type: "text" as const,
                text: `Error creating canvas: ${err instanceof Error ? err.message : String(err)}`,
              }],
            };
          }
        }
      ),
      tool(
        "CanvasAppend",
        "Append new content to the end of an existing canvas. Use this to add new sections to a canvas that already exists. " +
        "Your headings will be automatically tagged with your bot name so they can be identified later. " +
        "Always start new sections with a heading (## Heading) so they can be updated or deleted later. " +
        "You must provide a canvas_id (from CanvasList) to target the correct canvas.",
        {
          markdown: z.string().describe("The markdown content to append. Should start with a heading (e.g. ## Section Title)."),
          canvas_id: z.string().optional().describe("Optional canvas file ID (from CanvasList) to target a specific canvas. Omit to use the default canvas."),
        },
        async ({ markdown, canvas_id }) => {
          try {
            const fileId = canvas_id || getState(channelId).canvasFileId;
            if (!fileId) {
              return { content: [{ type: "text" as const, text: "No canvas loaded yet. Call CanvasList or CanvasRead first." }] };
            }
            await appendCanvasContent(app, fileId, markdown, getBotName());
            return { content: [{ type: "text" as const, text: "Content appended to canvas successfully." }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error appending to canvas: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
      tool(
        "CanvasDelete",
        "Permanently delete an entire canvas. This is irreversible — the canvas and all its content will be gone. " +
        "Use CanvasList to get the canvas_id first. " +
        "To delete just a section within a canvas, use CanvasDeleteSection instead.",
        {
          canvas_id: z.string().describe("The canvas ID to delete (from CanvasList). This permanently deletes the entire canvas."),
        },
        async ({ canvas_id }) => {
          try {
            await deleteCanvas(app, canvas_id);
            return { content: [{ type: "text" as const, text: `Canvas ${canvas_id} permanently deleted.` }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error deleting canvas: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
      tool(
        "CanvasReadById",
        "Read the content of a specific element in the canvas by its raw ID. Use this to inspect a single element " +
        "without loading the full canvas. Call CanvasRead first to find the element IDs in the raw HTML.",
        {
          sectionId: z.string().describe("The raw element ID from the canvas HTML (e.g. 'temp:C:FOdc2dcdb8ec57146dd9cfcb84f3')."),
        },
        async ({ sectionId }) => {
          try {
            const canvas = await fetchChannelCanvas(app, channelId);
            if (!canvas) {
              return { content: [{ type: "text" as const, text: "No canvas found for this channel." }] };
            }
            setCanvasFileId(channelId, canvas.fileId);
            const text = readCanvasById(canvas.content, sectionId);
            if (text === null) {
              return { content: [{ type: "text" as const, text: `No element found with ID "${sectionId}".` }] };
            }
            return { content: [{ type: "text" as const, text }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error reading element: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
      tool(
        "CanvasUpdateElementById",
        "Replace a specific element inside a canvas using its raw element ID. " +
        "Call CanvasRead first — element IDs appear in the raw HTML as id='temp:C:FOd...' attributes. " +
        "Works on any element type: paragraphs, headings, code blocks, tables.",
        {
          canvas_id: z.string().describe("The canvas ID (from CanvasList)."),
          sectionId: z.string().describe("The raw element ID from the canvas HTML (e.g. 'temp:C:FOdc2dcdb8ec57146dd9cfcb84f3')."),
          markdown: z.string().describe("The new markdown content to replace the element with."),
        },
        async ({ canvas_id, sectionId, markdown }) => {
          try {
            const fileId = canvas_id || getState(channelId).canvasFileId;
            if (!fileId) {
              return { content: [{ type: "text" as const, text: "No canvas loaded. Call CanvasList first." }] };
            }
            await updateCanvasById(app, fileId, sectionId, markdown, getBotName());
            return { content: [{ type: "text" as const, text: `Updated element ${sectionId}.` }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error updating element: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
      tool(
        "CanvasDeleteElementById",
        "Delete a specific element inside a canvas using its raw element ID. " +
        "Call CanvasRead first — element IDs appear in the raw HTML as id='temp:C:FOd...' attributes. " +
        "Works on any element type: paragraphs, headings, code blocks, tables.",
        {
          canvas_id: z.string().describe("The canvas ID (from CanvasList)."),
          sectionId: z.string().describe("The raw element ID from the canvas HTML (e.g. 'temp:C:FOdc2dcdb8ec57146dd9cfcb84f3')."),
        },
        async ({ canvas_id, sectionId }) => {
          try {
            const fileId = canvas_id || getState(channelId).canvasFileId;
            if (!fileId) {
              return { content: [{ type: "text" as const, text: "No canvas loaded. Call CanvasList first." }] };
            }
            await deleteCanvasById(app, fileId, sectionId);
            return { content: [{ type: "text" as const, text: `Deleted element ${sectionId}.` }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error deleting element: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
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
            // Write a marker file so the process knows to post a confirmation after restart
            // Format: "transport:channelId" so index.ts can route to the right transport
            const markerPath = join(homedir(), ".foreman", "reboot-channel.txt");
            writeFileSync(markerPath, `${transport}:${channelId}`, "utf-8");

            // Schedule the exit to give time for the response to be sent
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
      tool(
        "DiagramCreate",
        "Generate a diagram from Mermaid syntax and post it as an image in the Slack channel. " +
        "Use this when the user asks for architecture diagrams, flowcharts, sequence diagrams, entity relationship diagrams, etc. " +
        "Write valid Mermaid syntax — it will be rendered to a PNG and uploaded to the channel.",
        {
          mermaid: z.string().describe("Valid Mermaid diagram syntax (e.g. 'graph TD\\nA-->B')"),
          title: z.string().optional().describe("Optional title for the diagram, used as the file name"),
        },
        async ({ mermaid: mermaidSyntax, title }) => {
          try {
            // Encode the Mermaid syntax for the mermaid.ink API
            const encoded = Buffer.from(mermaidSyntax).toString("base64url");
            const url = `https://mermaid.ink/img/${encoded}?type=png&bgColor=!white`;

            const res = await fetch(url);
            if (!res.ok) {
              return { content: [{ type: "text" as const, text: `Mermaid rendering failed: HTTP ${res.status}. Check your Mermaid syntax.` }] };
            }

            const imageBuffer = Buffer.from(await res.arrayBuffer());
            const fileName = `${(title || "diagram").replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;

            // Upload to Slack channel
            await app.client.filesUploadV2({
              channel_id: channelId,
              file: imageBuffer,
              filename: fileName,
              title: title || "Diagram",
            });

            return { content: [{ type: "text" as const, text: `Diagram "${title || "diagram"}" generated and posted to the channel.` }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error creating diagram: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
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
            // Story Points is a number field
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
      tool(
        "LaunchApp",
        "Launch the mobile app on the connected simulator or emulator. " +
        "Auto-detects the platform: if the cwd contains a .xcworkspace it runs the iOS launch flow; " +
        "if it contains a gradlew file it runs the Android launch flow. " +
        "Use this instead of Bash when asked to launch, run, or start the app.",
        {},
        async () => {
          const cwd = getState(channelId).cwd;

          // Detect platform
          const hasXcworkspace = (() => {
            try { return execSync("find . -maxdepth 1 -name '*.xcworkspace' | head -1", { cwd, encoding: "utf8" }).trim() !== ""; } catch { return false; }
          })();
          const hasGradlew = existsSync(join(cwd, "gradlew"));

          if (hasXcworkspace) {
            // iOS launch flow
            try {
              const workspace = execSync("find . -maxdepth 1 -name '*.xcworkspace' | head -1", { cwd, encoding: "utf8" }).trim().replace(/^\.\//, "");
              const scheme = workspace.replace(/\.xcworkspace$/, "");

              // Find booted simulator
              const simList = execSync("xcrun simctl list devices --json", { encoding: "utf8" });
              const json = JSON.parse(simList) as { devices: Record<string, { udid: string; name: string; state: string }[]> };
              const booted = Object.values(json.devices).flat().find(d => d.state === "Booted");
              if (!booted) return { content: [{ type: "text" as const, text: ":x: No booted simulator found. Boot one in Xcode first." }] };

              // Find last built .app in DerivedData
              const derivedDataRoot = join(homedir(), "Library/Developer/Xcode/DerivedData");
              const workspacePath = join(cwd, workspace);
              let appPath = "";
              const ddEntries = execSync(`ls "${derivedDataRoot}"`, { encoding: "utf8" }).trim().split("\n");
              for (const entry of ddEntries) {
                const infoPlist = join(derivedDataRoot, entry, "info.plist");
                if (!existsSync(infoPlist)) continue;
                try {
                  const wsPath = execSync(`plutil -extract WorkspacePath raw "${infoPlist}" 2>/dev/null`, { encoding: "utf8" }).trim();
                  if (wsPath === workspacePath) {
                    const productsDir = join(derivedDataRoot, entry, "Build/Products/Debug-iphonesimulator");
                    try {
                      const apps = execSync(`ls -d "${productsDir}"/*.app 2>/dev/null`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
                      if (apps.length > 0) { appPath = apps[0]; break; }
                    } catch { /* no .app */ }
                  }
                } catch { /* skip */ }
              }
              if (!appPath) return { content: [{ type: "text" as const, text: ":x: No built app found. Run `/cc build` first." }] };

              execSync(`xcrun simctl install "${booted.udid}" "${appPath}"`, { encoding: "utf8" });
              const bundleId = execSync(
                `plutil -extract CFBundleIdentifier raw "${appPath}/Info.plist" 2>/dev/null`,
                { encoding: "utf8" }
              ).trim();
              if (bundleId) {
                execSync(`xcrun simctl launch "${booted.udid}" "${bundleId}"`, { encoding: "utf8" });
                return { content: [{ type: "text" as const, text: `:white_check_mark: Launched \`${scheme}\` on \`${booted.name}\`` }] };
              }
              return { content: [{ type: "text" as const, text: `:white_check_mark: Installed on \`${booted.name}\` — launch manually (couldn't detect bundle ID).` }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `:x: iOS launch failed: ${err instanceof Error ? err.message : String(err)}` }] };
            }
          } else if (hasGradlew) {
            // Android launch flow
            try {
              const adbCandidates = [
                `${homedir()}/Library/Android/sdk/platform-tools/adb`,
                "adb", "/usr/local/bin/adb", "/opt/homebrew/bin/adb",
              ];
              let adbPath = "adb";
              for (const candidate of adbCandidates) {
                try { execSync(`test -x "${candidate}"`, { encoding: "utf8" }); adbPath = candidate; break; } catch { /* try next */ }
              }

              const devices = execSync(`"${adbPath}" devices`, { encoding: "utf8" });
              const emulatorLine = devices.split("\n").find(l => l.includes("emulator") && l.includes("device"));
              if (!emulatorLine) return { content: [{ type: "text" as const, text: ":x: No running Android emulator found." }] };
              const emulatorId = emulatorLine.split("\t")[0].trim();

              const javaHomeCandidates = [
                process.env.JAVA_HOME,
                "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
                "/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home",
                "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
                "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
                "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
              ].filter(Boolean) as string[];
              let javaHome = "";
              for (const candidate of javaHomeCandidates) {
                try { execSync(`test -d "${candidate}"`, { encoding: "utf8" }); javaHome = candidate; break; } catch { /* try next */ }
              }
              const gradleEnv = {
                ...process.env,
                PATH: `/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:${process.env.PATH || "/usr/bin:/bin"}`,
                ...(javaHome ? { JAVA_HOME: javaHome } : {}),
              };

              execSync(`./gradlew installBetaDebug`, { cwd, env: gradleEnv, encoding: "utf8", timeout: 5 * 60 * 1000 });

              // Auto-detect launch activity
              try {
                const pkg = execSync(`"${adbPath}" shell pm list packages | grep myfitnesspal | head -1 | sed 's/package://'`, { encoding: "utf8" }).trim();
                const act = execSync(`"${adbPath}" shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${pkg} 2>/dev/null | tail -1`, { encoding: "utf8" }).trim();
                if (act) {
                  execSync(`"${adbPath}" -s "${emulatorId}" shell am start -n "${act}"`, { encoding: "utf8" });
                  return { content: [{ type: "text" as const, text: `:white_check_mark: Launched \`${act}\` on \`${emulatorId}\`` }] };
                }
              } catch { /* couldn't detect activity */ }
              return { content: [{ type: "text" as const, text: `:white_check_mark: Installed on \`${emulatorId}\` — launch manually.` }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `:x: Android launch failed: ${err instanceof Error ? err.message : String(err)}` }] };
            }
          } else {
            return { content: [{ type: "text" as const, text: `:x: Could not detect platform in \`${cwd}\`. No \`.xcworkspace\` or \`gradlew\` found.` }] };
          }
        }
      ),
      tool(
        "PostMessage",
        "Post a message to any Slack channel. Use this to report back to a feature channel after completing work. " +
        "For example, after launching an app, post back to the channel that dispatched the task.",
        {
          channel: z.string().describe("The channel ID or name (e.g. 'C0ABC123' or 'burger-view-01') to post the message to"),
          text: z.string().describe("The message text to post"),
        },
        async ({ channel: targetChannel, text }) => {
          try {
            // Resolve channel name to ID if needed
            let channelTarget = targetChannel;
            if (!targetChannel.match(/^[A-Z0-9]{8,}$/)) {
              const name = targetChannel.replace(/^#/, "");
              const listRes = await app.client.conversations.list({ types: "public_channel,private_channel", limit: 1000 }).catch(() => ({ channels: [] }));
              const found = (listRes.channels || []).find((c: any) => c.name === name);
              if (found?.id) channelTarget = found.id;
            }
            const botName = getBotName();
            const model = getState(channelId).model;
            const signedText = `${text}\n\n_— ${botName} (${model})_`;
            await app.client.chat.postMessage({ channel: channelTarget, text: signedText });
            return { content: [{ type: "text" as const, text: `Message posted to ${targetChannel}.` }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error posting message: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
      tool(
        "GetCurrentChannel",
        "Returns the Slack channel ID this bot is currently operating in. " +
        "Use this before creating canvases, posting messages, or any action that targets the current channel. " +
        "Always call this first if you are unsure which channel you are in.",
        {},
        async () => {
          const name = getBotName();
          return {
            content: [{
              type: "text" as const,
              text: `Current channel ID: ${channelId}\nBot name: ${name}`,
            }],
          };
        }
      ),
      tool(
        "ReadChannel",
        "Read recent messages from a Slack channel. Returns the latest messages as plain text, including the sender and timestamp. " +
        "Use this to catch up on what was posted in a discussion channel before responding. " +
        "The bot must be a member of the channel to read it.",
        {
          channel: z.string().describe("The channel ID or name (e.g. 'C0ABC123' or 'discussion') to read from"),
          limit: z.number().optional().describe("Number of messages to fetch (default: 20, max: 100)"),
        },
        async ({ channel: targetChannel, limit }) => {
          try {
            // Resolve channel name to ID if needed
            let channelTarget = targetChannel;
            if (!targetChannel.match(/^[A-Z0-9]{8,}$/)) {
              const name = targetChannel.replace(/^#/, "");
              const listRes = await app.client.conversations.list({ types: "public_channel,private_channel", limit: 1000 }).catch(() => ({ channels: [] }));
              const found = (listRes.channels || []).find((c: any) => c.name === name);
              if (found?.id) channelTarget = found.id;
            }

            const msgLimit = Math.min(limit ?? 20, 100);
            const res = await app.client.conversations.history({ channel: channelTarget, limit: msgLimit });
            const messages = (res.messages || []).reverse(); // oldest first

            if (messages.length === 0) {
              return { content: [{ type: "text" as const, text: `No messages found in channel ${targetChannel}.` }] };
            }

            // Format messages: resolve user names where possible
            const lines: string[] = [];
            for (const msg of messages) {
              const ts = msg.ts ? new Date(Number(msg.ts) * 1000).toISOString() : "?";
              const sender = (msg as any).bot_id ? `[bot:${(msg as any).username || "unknown"}]` : `<@${(msg as any).user || "unknown"}>`;
              const text = (msg as any).text || "(no text)";
              lines.push(`[${ts}] ${sender}: ${text}`);
            }

            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error reading channel: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
      tool(
        "GitHubListPRs",
        "List pull requests for the current repository.",
        {
          state: z.string().optional().describe("PR state: open, closed, merged, all (default: open)"),
        },
        async ({ state }) => {
          try {
            const cwd = getState(channelId).cwd;
            const prs = listPRs(cwd, state || "open");
            if (prs.length === 0) {
              return { content: [{ type: "text" as const, text: `No ${state || "open"} PRs found.` }] };
            }
            const lines = prs.map(
              (pr) => `**#${pr.number}** [${pr.state}] ${pr.title} (${pr.author}, ${pr.branch})\n${pr.url}`
            );
            return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Error listing PRs: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        }
      ),
    ],
  });
}
