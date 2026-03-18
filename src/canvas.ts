import type { App } from "@slack/bolt";

export interface CanvasImage {
  url: string;
  data: string;       // base64
  mimeType: string;
}

const SUPPORTED_IMAGE_MIMES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
]);

/**
 * Extract image file IDs and URLs from canvas markdown and download them.
 * Canvas images appear in various formats:
 *   - Slack file IDs: F0ALC0S12DC (11-char uppercase alphanumeric starting with F)
 *   - Markdown images: ![alt](https://files.slack.com/...)
 *   - Slack file URLs: https://files.slack.com/files-pri/T.../filename.png
 */
async function downloadCanvasImages(markdown: string, token: string, app: App): Promise<CanvasImage[]> {
  const images: CanvasImage[] = [];
  const seen = new Set<string>();

  // Extract Slack file IDs (F followed by 10+ uppercase alphanumeric chars)
  const fileIdPattern = /\b(F[A-Z0-9]{10,})\b/g;
  let match;
  while ((match = fileIdPattern.exec(markdown)) !== null) {
    const fid = match[1];
    if (seen.has(fid)) continue;
    seen.add(fid);
    try {
      const fileRes = await app.client.files.info({ file: fid });
      const fileData = (fileRes as any).file;
      if (!fileData || !SUPPORTED_IMAGE_MIMES.has(fileData.mimetype)) continue;
      const dlUrl = fileData.url_private_download || fileData.url_private;
      if (!dlUrl) continue;
      const res = await fetch(dlUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      images.push({
        url: dlUrl,
        data: buffer.toString("base64"),
        mimeType: fileData.mimetype,
      });
    } catch { /* skip failed downloads */ }
  }

  // Also try markdown-style image URLs (direct Slack CDN links)
  const urlPattern = /!\[[^\]]*\]\((https:\/\/files\.slack\.com\/[^)]+)\)/g;
  while ((match = urlPattern.exec(markdown)) !== null) {
    const url = match[1];
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") || "image/png";
      if (!SUPPORTED_IMAGE_MIMES.has(contentType.split(";")[0].trim())) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      images.push({
        url,
        data: buffer.toString("base64"),
        mimeType: contentType.split(";")[0].trim(),
      });
    } catch { /* skip failed downloads */ }
  }

  return images;
}

/**
 * Fetch the canvas file ID and raw markdown content for a channel.
 */
export async function fetchChannelCanvas(
  app: App,
  channel: string
): Promise<{ fileId: string; content: string; images: CanvasImage[] } | null> {
  const infoRes = await app.client.conversations.info({ channel });
  const channelData = infoRes.channel as any;
  const tabs: any[] = channelData?.properties?.tabs || [];
  const canvasTab = tabs.find((t: any) => t.type === "canvas");
  let fileId: string | undefined =
    canvasTab?.data?.file_id ||
    channelData?.properties?.meeting_notes?.file_id;

  if (!fileId) {
    const listRes = await (app.client.files as any).list({ channel, types: "spaces" });
    fileId = listRes?.files?.[0]?.id;
  }
  if (!fileId) return null;

  const fileRes = await app.client.files.info({ file: fileId });
  const downloadUrl: string | undefined =
    (fileRes as any).file?.url_private_download ||
    (fileRes as any).file?.url_private;
  if (!downloadUrl) return null;

  const dlRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN || ""}` },
  });
  if (!dlRes.ok) throw new Error(`Canvas download failed: HTTP ${dlRes.status}`);
  const content = await dlRes.text();
  const images = await downloadCanvasImages(content, process.env.SLACK_BOT_TOKEN || "", app);
  return { fileId, content, images };
}

/** Regex to extract bot name from a provenance-tagged heading: *[bot-name] Heading Text* */
const PROVENANCE_PATTERN = /\*\[([^\]]+)\]\s+/;

/** Format a heading with a provenance marker: ## *[bot-name] Heading Text* */
export function tagHeading(botName: string, heading: string): string {
  // Strip any existing markdown heading prefix (##) and provenance marker
  const cleanHeading = heading
    .replace(/^#{1,3}\s*/, "")
    .replace(/^\*\[[^\]]+\]\s*/, "")
    .replace(/\*$/, "")
    .trim();
  return `## *[${botName}] ${cleanHeading}*`;
}

/** Tag all headings in a markdown block with the bot's provenance marker */
export function tagMarkdown(botName: string, markdown: string): string {
  return markdown.replace(/^(#{1,3})\s+(.+)$/gm, (_match, _hashes, text) => {
    // Don't double-tag if already tagged
    if (text.startsWith("*[")) return _match;
    return tagHeading(botName, text);
  });
}

/** Extract the bot name from a provenance-tagged heading, or null if untagged */
export function getOwner(heading: string): string | null {
  const match = heading.match(PROVENANCE_PATTERN);
  return match ? match[1] : null;
}

/**
 * Look up section IDs by text content. Returns matching section IDs.
 */
async function lookupSections(app: App, fileId: string, containsText: string): Promise<string[]> {
  const ids: string[] = [];
  for (const sectionType of ["h1", "h2", "h3"] as const) {
    try {
      const lookupRes = await app.client.canvases.sections.lookup({
        canvas_id: fileId,
        criteria: { section_types: [sectionType], contains_text: containsText },
      });
      const sections = (lookupRes as any).sections || [];
      for (const s of sections) {
        if (s.id && !ids.includes(s.id)) ids.push(s.id);
      }
    } catch (err: any) {
      console.warn(`[canvas] Lookup ${sectionType} "${containsText}" failed:`, err?.data?.error || err?.message || err);
    }
  }
  return ids;
}

/**
 * Look up ALL heading section IDs in a canvas.
 */
async function lookupAllSections(app: App, fileId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const sectionType of ["h1", "h2", "h3"] as const) {
    try {
      const lookupRes = await app.client.canvases.sections.lookup({
        canvas_id: fileId,
        criteria: { section_types: [sectionType] },
      });
      const sections = (lookupRes as any).sections || [];
      console.log(`[canvas] Lookup ${sectionType}: found ${sections.length} sections`);
      for (const s of sections) {
        if (s.id && !ids.includes(s.id)) ids.push(s.id);
      }
    } catch (err: any) {
      console.warn(`[canvas] Lookup ${sectionType} failed:`, err?.data?.error || err?.message || err);
    }
  }
  return ids;
}

/**
 * CanvasCreate: Append new content to the end of the canvas.
 * Automatically tags all headings with the bot's provenance marker.
 */
export async function appendCanvasContent(app: App, fileId: string, markdown: string, botName: string): Promise<void> {
  const tagged = tagMarkdown(botName, markdown);
  await (app.client.canvases as any).edit({
    canvas_id: fileId,
    changes: [{ operation: "insert_at_end", document_content: { type: "markdown", markdown: tagged } }],
  });
  console.log(`[canvas] Appended new content tagged as [${botName}]`);
}

/**
 * CanvasUpdate: Find a section by its heading text and replace it with new content.
 * Automatically tags headings with the bot's provenance marker.
 */
export async function updateCanvasSection(
  app: App,
  fileId: string,
  sectionHeading: string,
  markdown: string,
  botName: string
): Promise<{ found: boolean; reason?: string }> {
  const sectionIds = await lookupSections(app, fileId, sectionHeading);
  if (sectionIds.length === 0) {
    console.warn(`[canvas] No sections found matching "${sectionHeading}"`);
    return { found: false, reason: `No section found matching "${sectionHeading}".` };
  }

  const tagged = tagMarkdown(botName, markdown);

  // Replace the first matching section
  try {
    await (app.client.canvases as any).edit({
      canvas_id: fileId,
      changes: [{ operation: "replace", section_id: sectionIds[0], document_content: { type: "markdown", markdown: tagged } }],
    });
    console.log(`[canvas] Replaced section "${sectionHeading}" (${sectionIds[0]}) as [${botName}]`);
  } catch (err: any) {
    console.error(`[canvas] Replace failed, trying delete+insert:`, err?.data?.error || err?.message || err);
    await (app.client.canvases as any).edit({
      canvas_id: fileId,
      changes: [{ operation: "delete", section_id: sectionIds[0] }],
    });
    await (app.client.canvases as any).edit({
      canvas_id: fileId,
      changes: [{ operation: "insert_at_end", document_content: { type: "markdown", markdown: tagged } }],
    });
    console.log(`[canvas] Deleted and re-inserted section "${sectionHeading}" as [${botName}]`);
  }

  // Delete any remaining duplicates
  for (const id of sectionIds.slice(1)) {
    try {
      await (app.client.canvases as any).edit({
        canvas_id: fileId,
        changes: [{ operation: "delete", section_id: id }],
      });
      console.log(`[canvas] Deleted duplicate section ${id}`);
    } catch (err: any) {
      console.warn(`[canvas] Failed to delete duplicate ${id}:`, err?.data?.error || err?.message || err);
    }
  }

  return { found: true };
}

/**
 * CanvasDelete: Find a section by its heading text and delete it.
 */
export async function deleteCanvasSection(
  app: App,
  fileId: string,
  sectionHeading: string,
  _botName?: string
): Promise<number> {
  const sectionIds = await lookupSections(app, fileId, sectionHeading);
  if (sectionIds.length === 0) {
    console.warn(`[canvas] No sections found matching "${sectionHeading}"`);
    return 0;
  }

  let deleted = 0;
  for (const id of sectionIds) {
    try {
      await (app.client.canvases as any).edit({
        canvas_id: fileId,
        changes: [{ operation: "delete", section_id: id }],
      });
      console.log(`[canvas] Deleted section "${sectionHeading}" (${id})`);
      deleted++;
    } catch (err: any) {
      console.warn(`[canvas] Failed to delete section ${id}:`, err?.data?.error || err?.message || err);
    }
  }

  return deleted;
}

/**
 * CanvasReadById: Extract the content of a specific element by its raw ID.
 * Parses the full canvas HTML to find the element and returns its text content.
 */
export function readCanvasById(canvasContent: string, sectionId: string): string | null {
  // Match elements with the given ID — handles tags like <p>, <h1>, <h2>, <h3>, <pre>, etc.
  const escaped = sectionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<[^>]+id='${escaped}'[^>]*>([\\s\\S]*?)(?=<[^/])`, "i");
  const match = canvasContent.match(pattern);
  if (!match) return null;
  // Strip HTML tags from the content
  return match[1].replace(/<[^>]+>/g, "").trim();
}

/**
 * CanvasUpdateById: Replace a canvas element by its raw ID (temp:C:FOd...).
 * Works on any element — paragraphs, headings, code blocks, etc.
 */
export async function updateCanvasById(
  app: App,
  fileId: string,
  sectionId: string,
  markdown: string,
  botName: string
): Promise<void> {
  const tagged = tagMarkdown(botName, markdown);
  await (app.client.canvases as any).edit({
    canvas_id: fileId,
    changes: [{ operation: "replace", section_id: sectionId, document_content: { type: "markdown", markdown: tagged } }],
  });
  console.log(`[canvas] Updated element by ID: ${sectionId} as [${botName}]`);
}

/**
 * CanvasDeleteById: Delete a canvas element by its raw ID (temp:C:FOd...).
 * Works on any element — paragraphs, headings, code blocks, etc.
 */
export async function deleteCanvasById(
  app: App,
  fileId: string,
  sectionId: string
): Promise<void> {
  await (app.client.canvases as any).edit({
    canvas_id: fileId,
    changes: [{ operation: "delete", section_id: sectionId }],
  });
  console.log(`[canvas] Deleted element by ID: ${sectionId}`);
}
