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
    body: result.body?.storage?.value || "",
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
}): Promise<{ id: string; url: string }> {
  const config = getConfluenceConfig();

  // Get current page to read version number and title
  const current = await readConfluencePage(pageId);

  const payload: any = {
    id: pageId,
    status: "current",
    title: opts.title || current.title,
    version: { number: current.version + 1 },
    body: {
      representation: "storage",
      value: opts.body ? markdownToConfluenceStorage(opts.body) : current.body,
    },
  };

  const result = await confluenceFetch(`/api/v2/pages/${pageId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  return {
    id: result.id,
    url: `${config.host}/wiki${result._links?.webui || `/pages/${result.id}`}`,
  };
}

/** Convert markdown to Confluence storage format (XHTML) */
function markdownToConfluenceStorage(markdown: string): string {
  const lines = markdown.split("\n");
  const parts: string[] = [];
  let inList = false;

  for (const line of lines) {
    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (inList) { parts.push("</ul>"); inList = false; }
      const level = headingMatch[1].length;
      parts.push(`<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Bullet list items
    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      if (!inList) { parts.push("<ul>"); inList = true; }
      parts.push(`<li>${escapeHtml(bulletMatch[1])}</li>`);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      if (inList) { parts.push("</ul>"); inList = false; }
      continue;
    }

    // Regular paragraph
    if (inList) { parts.push("</ul>"); inList = false; }
    parts.push(`<p>${escapeHtml(line)}</p>`);
  }

  if (inList) parts.push("</ul>");
  return parts.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
