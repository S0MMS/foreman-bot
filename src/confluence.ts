import { readConfig } from "./config.js";

interface ConfluenceConfig {
  host: string;
  email: string;
  apiToken: string;
}

function getConfluenceConfig(): ConfluenceConfig {
  const config = readConfig();
  // Reuse Jira credentials — same Atlassian instance
  if (!config.jiraHost || !config.jiraEmail || !config.jiraApiToken) {
    throw new Error(
      "Confluence not configured. Uses the same jiraHost, jiraEmail, and jiraApiToken from ~/.foreman/config.json"
    );
  }
  return {
    host: config.jiraHost.replace(/\/$/, ""),
    email: config.jiraEmail,
    apiToken: config.jiraApiToken,
  };
}

function authHeader(config: ConfluenceConfig): string {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
}

async function confluenceFetch(path: string, options: RequestInit = {}): Promise<any> {
  const config = getConfluenceConfig();
  const url = `${config.host}/wiki${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: authHeader(config),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Confluence API ${res.status}: ${body}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export interface ConfluencePage {
  id: string;
  title: string;
  spaceId: string;
  status: string;
  url: string;
  body: string;
  version: number;
}

/** Read a Confluence page by ID */
export async function readConfluencePage(pageId: string): Promise<ConfluencePage> {
  const config = getConfluenceConfig();
  const result = await confluenceFetch(
    `/api/v2/pages/${pageId}?body-format=storage`
  );

  return {
    id: result.id,
    title: result.title,
    spaceId: result.spaceId,
    status: result.status,
    url: `${config.host}/wiki${result._links?.webui || `/pages/${result.id}`}`,
    body: stripHtml(result.body?.storage?.value || ""),
    version: result.version?.number || 1,
  };
}

/** Search Confluence pages using CQL */
export async function searchConfluencePages(cql: string, maxResults = 10): Promise<ConfluencePage[]> {
  const config = getConfluenceConfig();
  // Use v1 API for CQL search — v2 doesn't support it
  const result = await confluenceFetch(
    `/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${maxResults}`
  );

  return (result.results || [])
    .filter((r: any) => r.type === "page")
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      spaceId: r.space?.id || "",
      status: r.status || "current",
      url: `${config.host}/wiki${r._links?.webui || `/pages/${r.id}`}`,
      body: r.excerpt || "",
      version: r.version?.number || 1,
    }));
}

/** Create a Confluence page */
export async function createConfluencePage(opts: {
  title: string;
  body: string;
  spaceId: string;
  parentId?: string;
}): Promise<{ id: string; url: string }> {
  const config = getConfluenceConfig();

  const payload: any = {
    spaceId: opts.spaceId,
    status: "current",
    title: opts.title,
    body: {
      representation: "storage",
      value: markdownToConfluenceStorage(opts.body),
    },
  };
  if (opts.parentId) {
    payload.parentId = opts.parentId;
  }

  const result = await confluenceFetch("/api/v2/pages", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    id: result.id,
    url: `${config.host}/wiki${result._links?.webui || `/pages/${result.id}`}`,
  };
}

/** Update a Confluence page */
export async function updateConfluencePage(pageId: string, opts: {
  title?: string;
  body?: string;
}): Promise<{ id: string; url: string; version: number | string; previousVersion: number; debug: string }> {
  const config = getConfluenceConfig();

  // Fetch raw storage format for version number and body fallback (v2 read works fine)
  const current = await confluenceFetch(`/api/v2/pages/${pageId}?body-format=storage`);
  const currentVersion = current.version?.number || 1;

  // Use v1 API for the PUT — v2 silently rejects storage format updates
  const payload: any = {
    version: { number: currentVersion + 1 },
    title: opts.title || current.title,
    type: "page",
    body: {
      storage: {
        value: opts.body ? markdownToConfluenceStorage(opts.body) : (current.body?.storage?.value || ""),
        representation: "storage",
      },
    },
  };

  const result = await confluenceFetch(`/rest/api/content/${pageId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  const newVersion = result.version?.number ?? result.version ?? "unknown";
  const debug = JSON.stringify({
    status: result?.status,
    id: result?.id,
    version: result?.version,
    sentVersion: currentVersion + 1,
    keys: result ? Object.keys(result) : [],
  }).slice(0, 800);
  return {
    id: result.id,
    url: `${config.host}/wiki${result._links?.webui || `/pages/${result.id}`}`,
    version: newVersion,
    previousVersion: currentVersion,
    debug,
  };
}

/** Convert markdown to Confluence storage format (XHTML) */
function markdownToConfluenceStorage(markdown: string): string {
  const lines = markdown.split("\n");
  const parts: string[] = [];
  let inList = false;
  let inOrderedList = false;
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeLines: string[] = [];

  const processInline = (text: string): string => {
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return text;
  };

  for (const line of lines) {
    // Code block start
    const codeBlockStart = line.match(/^```(\w*)/);
    if (codeBlockStart && !inCodeBlock) {
      if (inList) { parts.push("</ul>"); inList = false; }
      if (inOrderedList) { parts.push("</ol>"); inOrderedList = false; }
      inCodeBlock = true;
      codeBlockLang = codeBlockStart[1] || "";
      codeLines = [];
      continue;
    }
    // Code block end
    if (line.match(/^```/) && inCodeBlock) {
      inCodeBlock = false;
      const code = codeLines.join("\n");
      const langAttr = codeBlockLang ? `<ac:parameter ac:name="language">${codeBlockLang}</ac:parameter>` : "";
      parts.push(`<ac:structured-macro ac:name="code">${langAttr}<ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`);
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (inList) { parts.push("</ul>"); inList = false; }
      if (inOrderedList) { parts.push("</ol>"); inOrderedList = false; }
      const level = headingMatch[1].length;
      parts.push(`<h${level}>${processInline(escapeHtml(headingMatch[2]))}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/) || line.match(/^\*\*\*+$/)) {
      if (inList) { parts.push("</ul>"); inList = false; }
      if (inOrderedList) { parts.push("</ol>"); inOrderedList = false; }
      parts.push("<hr/>");
      continue;
    }

    // Bullet list items
    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      if (inOrderedList) { parts.push("</ol>"); inOrderedList = false; }
      if (!inList) { parts.push("<ul>"); inList = true; }
      parts.push(`<li>${processInline(escapeHtml(bulletMatch[1]))}</li>`);
      continue;
    }

    // Numbered list items
    const numberedMatch = line.match(/^\d+\.\s+(.+)/);
    if (numberedMatch) {
      if (inList) { parts.push("</ul>"); inList = false; }
      if (!inOrderedList) { parts.push("<ol>"); inOrderedList = true; }
      parts.push(`<li>${processInline(escapeHtml(numberedMatch[1]))}</li>`);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      if (inList) { parts.push("</ul>"); inList = false; }
      if (inOrderedList) { parts.push("</ol>"); inOrderedList = false; }
      continue;
    }

    // Regular paragraph
    if (inList) { parts.push("</ul>"); inList = false; }
    if (inOrderedList) { parts.push("</ol>"); inOrderedList = false; }
    parts.push(`<p>${processInline(escapeHtml(line))}</p>`);
  }

  if (inList) parts.push("</ul>");
  if (inOrderedList) parts.push("</ol>");
  return parts.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(html: string): string {
  return html
    .replace(/<\/(h[1-6]|p|li|ul|ol|div)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
