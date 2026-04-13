/**
 * mcp-slack.ts — foreman-slack toolbelt
 *
 * Slack-platform-specific tools: Canvas CRUD, PostMessage, ReadChannel,
 * GetCurrentChannel, DiagramCreate.
 *
 * These tools depend on the Slack `app` client and are NOT available in
 * Mattermost-only sessions (DiagramCreate uses Slack file upload API;
 * Canvas is a Slack-native feature).
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { App } from "@slack/bolt";
import {
  fetchChannelCanvas,
  fetchCanvasByFileId,
  listChannelCanvases,
  createChannelCanvas,
  appendCanvasContent,
  deleteCanvas,
  readCanvasById,
  updateCanvasById,
  deleteCanvasById,
  getOwner,
  findCanvasSections,
} from "./canvas.js";
import { getState, setCanvasFileId } from "./session.js";

export interface SlackMcpContext {
  channelId: string;
  app: App;
  getBotName: () => string;
}

export function createSlackTools(ctx: SlackMcpContext) {
  const { channelId, app, getBotName } = ctx;

  return [
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
          if (!channel_id && !canvas_id) setCanvasFileId(channelId, canvas.fileId);

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
          const encoded = Buffer.from(mermaidSyntax).toString("base64url");
          const url = `https://mermaid.ink/img/${encoded}?type=png&bgColor=!white`;

          const res = await fetch(url);
          if (!res.ok) {
            return { content: [{ type: "text" as const, text: `Mermaid rendering failed: HTTP ${res.status}. Check your Mermaid syntax.` }] };
          }

          const imageBuffer = Buffer.from(await res.arrayBuffer());
          const fileName = `${(title || "diagram").replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;

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
      "PostMessage",
      "Post a message to any Slack channel. Use this to report back to a feature channel after completing work. " +
      "For example, after launching an app, post back to the channel that dispatched the task.",
      {
        channel: z.string().describe("The channel ID or name (e.g. 'C0ABC123' or 'burger-view-01') to post the message to"),
        text: z.string().describe("The message text to post"),
      },
      async ({ channel: targetChannel, text }) => {
        try {
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
          let channelTarget = targetChannel;
          if (!targetChannel.match(/^[A-Z0-9]{8,}$/)) {
            const name = targetChannel.replace(/^#/, "");
            const listRes = await app.client.conversations.list({ types: "public_channel,private_channel", limit: 1000 }).catch(() => ({ channels: [] }));
            const found = (listRes.channels || []).find((c: any) => c.name === name);
            if (found?.id) channelTarget = found.id;
          }

          const msgLimit = Math.min(limit ?? 20, 100);
          const res = await app.client.conversations.history({ channel: channelTarget, limit: msgLimit });
          const messages = (res.messages || []).reverse();

          if (messages.length === 0) {
            return { content: [{ type: "text" as const, text: `No messages found in channel ${targetChannel}.` }] };
          }

          const lines: string[] = [];
          for (const msg of messages) {
            const ts = new Date(parseFloat(msg.ts || "0") * 1000).toLocaleTimeString();
            const sender = msg.username || msg.user || (msg.bot_id ? "Bot" : "Unknown");
            lines.push(`[${ts}] ${sender}: ${msg.text || "(no text)"}`);
          }
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error reading channel: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    ),
  ];
}
