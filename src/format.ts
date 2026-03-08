const MAX_CHUNK_SIZE = 3900;

/**
 * Convert GitHub-flavored markdown to Slack mrkdwn format.
 */
export function markdownToSlack(text: string): string {
  let result = text;

  // Headers: ### Title → *Title*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Bold: **text** → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Italic: _text_ stays _text_ (same in Slack)
  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, "~$1~");

  // Inline code: `code` stays `code` (same in Slack)

  // Fenced code blocks: ```lang\n...\n``` → ```\n...\n```
  result = result.replace(/```\w*\n/g, "```\n");

  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Unordered lists: - item or * item → • item
  result = result.replace(/^[\s]*[-*]\s+/gm, "• ");

  return result;
}

/**
 * Chunk a message into pieces that fit within Slack's message size limit,
 * respecting code block boundaries.
 */
export function chunkMessage(text: string): string[] {
  if (text.length <= MAX_CHUNK_SIZE) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }

    let splitAt = MAX_CHUNK_SIZE;

    // Check if we're inside a code block at the split point
    const beforeSplit = remaining.slice(0, splitAt);
    const codeBlockCount = (beforeSplit.match(/```/g) || []).length;
    const insideCodeBlock = codeBlockCount % 2 !== 0;

    if (insideCodeBlock) {
      // Find the last ``` before the split point to close cleanly
      const lastCodeBlockStart = beforeSplit.lastIndexOf("```");
      if (lastCodeBlockStart > 0) {
        splitAt = lastCodeBlockStart;
      }
    } else {
      // Try to split at a newline
      const lastNewline = remaining.lastIndexOf("\n", splitAt);
      if (lastNewline > splitAt * 0.5) {
        splitAt = lastNewline + 1;
      }
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

/**
 * Format a tool approval request for display in Slack.
 */
export function formatToolRequest(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "Bash":
      return `\`${input.command}\`${input.description ? `\n${input.description}` : ""}`;
    case "Write":
      return `\`${input.file_path}\` (${typeof input.content === "string" ? input.content.length : 0} chars)`;
    case "Edit":
      return `\`${input.file_path}\``;
    default:
      return `\`\`\`${JSON.stringify(input, null, 2).slice(0, 500)}\`\`\``;
  }
}
