import { readConfig } from "./config.js";

interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

function getJiraConfig(): JiraConfig {
  const config = readConfig();
  if (!config.jiraHost || !config.jiraEmail || !config.jiraApiToken || !config.jiraProjectKey) {
    throw new Error(
      "Jira not configured. Add jiraHost, jiraEmail, jiraApiToken, and jiraProjectKey to ~/.foreman/config.json"
    );
  }
  return {
    host: config.jiraHost.replace(/\/$/, ""),
    email: config.jiraEmail,
    apiToken: config.jiraApiToken,
    projectKey: config.jiraProjectKey,
  };
}

function authHeader(config: JiraConfig): string {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
}

async function jiraFetch(path: string, options: RequestInit = {}): Promise<any> {
  const config = getJiraConfig();
  const url = `${config.host}${path}`;
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
    throw new Error(`Jira API ${res.status}: ${body}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Convert plain text to Atlassian Document Format (ADF) */
function textToAdf(text: string): any {
  const paragraphs = text.split("\n\n").filter(Boolean);
  return {
    version: 1,
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p.replace(/\n/g, " ") }],
    })),
  };
}

/** Convert markdown-ish text to ADF with basic heading/list support */
function markdownToAdf(markdown: string): any {
  const lines = markdown.split("\n");
  const content: any[] = [];
  let currentList: any[] | null = null;

  for (const line of lines) {
    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      if (currentList) {
        content.push({ type: "bulletList", content: currentList });
        currentList = null;
      }
      const level = headingMatch[1].length;
      content.push({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: headingMatch[2] }],
      });
      continue;
    }

    // Bullet list items
    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      if (!currentList) currentList = [];
      currentList.push({
        type: "listItem",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: bulletMatch[1] }],
        }],
      });
      continue;
    }

    // Empty line — flush list
    if (line.trim() === "") {
      if (currentList) {
        content.push({ type: "bulletList", content: currentList });
        currentList = null;
      }
      continue;
    }

    // Regular paragraph
    if (currentList) {
      content.push({ type: "bulletList", content: currentList });
      currentList = null;
    }
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    });
  }

  // Flush remaining list
  if (currentList) {
    content.push({ type: "bulletList", content: currentList });
  }

  return { version: 1, type: "doc", content: content.length > 0 ? content : [{ type: "paragraph", content: [{ type: "text", text: " " }] }] };
}

export interface JiraComment {
  id: string;
  author: string;
  body: string;
  created: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  description: string;
  issueType: string;
  priority: string;
  labels: string[];
  comments: JiraComment[];
}

/** Create a Jira issue */
export async function createJiraIssue(opts: {
  summary: string;
  description: string;
  issueType?: string;
  labels?: string[];
  priority?: string;
}): Promise<{ key: string; url: string }> {
  const config = getJiraConfig();
  const fields: any = {
    project: { key: config.projectKey },
    issuetype: { name: opts.issueType || "Task" },
    summary: opts.summary,
    description: markdownToAdf(opts.description),
  };
  if (opts.labels?.length) fields.labels = opts.labels;
  if (opts.priority) fields.priority = { name: opts.priority };

  const result = await jiraFetch("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  return {
    key: result.key,
    url: `${config.host}/browse/${result.key}`,
  };
}

/** Update a Jira issue */
export async function updateJiraIssue(issueKey: string, opts: {
  summary?: string;
  description?: string;
  priority?: string;
  labels?: string[];
}): Promise<{ key: string; url: string }> {
  const config = getJiraConfig();
  const fields: any = {};
  if (opts.summary) fields.summary = opts.summary;
  if (opts.description) fields.description = markdownToAdf(opts.description);
  if (opts.priority) fields.priority = { name: opts.priority };
  if (opts.labels) fields.labels = opts.labels;

  await jiraFetch(`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });

  return {
    key: issueKey,
    url: `${config.host}/browse/${issueKey}`,
  };
}

/** Extract text from an inline ADF node (text, mention, emoji, hardBreak, etc.) */
function adfInlineToText(node: any): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "mention") {
    const name = node.attrs?.text || node.attrs?.id || "unknown";
    return name.startsWith("@") ? name : `@${name}`;
  }
  if (node.type === "emoji") return node.attrs?.shortName || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "inlineCard") return node.attrs?.url || "";
  return "";
}

/** Extract plain text from ADF (Atlassian Document Format) */
function adfToText(doc: any): string {
  if (!doc?.content) return "";
  try {
    return doc.content
      .map((block: any) => {
        if (block.type === "paragraph" || block.type === "heading") {
          return (block.content || []).map(adfInlineToText).join("");
        }
        if (block.type === "bulletList") {
          return (block.content || [])
            .map((li: any) => "- " + (li.content?.[0]?.content || []).map(adfInlineToText).join(""))
            .join("\n");
        }
        if (block.type === "codeBlock") {
          return "```\n" + (block.content || []).map((n: any) => n.text || "").join("") + "\n```";
        }
        if (block.type === "orderedList") {
          return (block.content || [])
            .map((li: any, i: number) => `${i + 1}. ` + (li.content?.[0]?.content || []).map(adfInlineToText).join(""))
            .join("\n");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  } catch { return ""; }
}

/** Read a Jira issue */
export async function readJiraIssue(issueKey: string): Promise<JiraIssue> {
  const result = await jiraFetch(
    `/rest/api/3/issue/${issueKey}?fields=summary,status,assignee,description,issuetype,priority,labels,comment`
  );

  const fields = result.fields;

  const comments: JiraComment[] = (fields.comment?.comments || []).map((c: any) => ({
    id: c.id,
    author: c.author?.displayName || "Unknown",
    body: adfToText(c.body),
    created: c.created,
  }));

  return {
    key: result.key,
    summary: fields.summary,
    status: fields.status?.name || "Unknown",
    assignee: fields.assignee?.displayName || null,
    description: adfToText(fields.description),
    issueType: fields.issuetype?.name || "Unknown",
    priority: fields.priority?.name || "None",
    labels: fields.labels || [],
    comments,
  };
}

/** Add a comment to a Jira issue */
export async function addJiraComment(issueKey: string, body: string): Promise<{ id: string }> {
  const result = await jiraFetch(`/rest/api/3/issue/${issueKey}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: markdownToAdf(body) }),
  });
  return { id: result.id };
}

/** Update a comment on a Jira issue */
export async function updateJiraComment(issueKey: string, commentId: string, body: string): Promise<void> {
  await jiraFetch(`/rest/api/3/issue/${issueKey}/comment/${commentId}`, {
    method: "PUT",
    body: JSON.stringify({ body: markdownToAdf(body) }),
  });
}

/** Delete a comment from a Jira issue */
export async function deleteJiraComment(issueKey: string, commentId: string): Promise<void> {
  await jiraFetch(`/rest/api/3/issue/${issueKey}/comment/${commentId}`, {
    method: "DELETE",
  });
}

/** Search Jira issues with JQL */
export async function searchJiraIssues(jql: string, maxResults = 10): Promise<JiraIssue[]> {
  // Use the new /search/jql endpoint (old /search was removed)
  const result = await jiraFetch(
    `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,assignee,description,issuetype,priority,labels`
  );

  return (result.issues || []).map((issue: any) => {
    const fields = issue.fields;
    return {
      key: issue.key,
      summary: fields.summary,
      status: fields.status?.name || "Unknown",
      assignee: fields.assignee?.displayName || null,
      description: "",
      issueType: fields.issuetype?.name || "Unknown",
      priority: fields.priority?.name || "None",
      labels: fields.labels || [],
    };
  });
}

/** Get the Jira project key from config */
export function getJiraProjectKey(): string {
  return getJiraConfig().projectKey;
}

/** Get the Jira host URL from config */
export function getJiraHost(): string {
  return getJiraConfig().host;
}

/** Get the current user's Jira account ID */
let cachedAccountId: string | null = null;
export async function getMyAccountId(): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  const result = await jiraFetch("/rest/api/3/myself");
  cachedAccountId = result.accountId;
  return result.accountId;
}

/** Find mention nodes in raw ADF content matching an account ID */
function findMentionsInAdf(doc: any, accountId: string): boolean {
  if (!doc?.content) return false;
  for (const block of doc.content) {
    const inlines = block.content || [];
    for (const node of inlines) {
      if (node.type === "mention" && node.attrs?.id === accountId) return true;
    }
    // Check nested content (list items, etc.)
    if (block.type === "bulletList" || block.type === "orderedList") {
      for (const li of (block.content || [])) {
        for (const para of (li.content || [])) {
          for (const node of (para.content || [])) {
            if (node.type === "mention" && node.attrs?.id === accountId) return true;
          }
        }
      }
    }
  }
  return false;
}

export interface JiraMention {
  issueKey: string;
  summary: string;
  commentId: string;
  commentAuthor: string;
  commentBody: string;
  commentCreated: string;
  url: string;
}

/** Find recent comments that mention the current user */
export async function findMyMentions(sinceMinutes = 5, maxResults = 20): Promise<JiraMention[]> {
  const accountId = await getMyAccountId();
  const config = getJiraConfig();

  // Search for recently updated tickets with comments
  const result = await jiraFetch(
    `/rest/api/3/search/jql?jql=${encodeURIComponent(`updated >= -${sinceMinutes}m AND comment is not EMPTY ORDER BY updated DESC`)}&maxResults=${maxResults}&fields=summary,comment`
  );

  const mentions: JiraMention[] = [];

  for (const issue of (result.issues || [])) {
    const comments = issue.fields?.comment?.comments || [];
    for (const comment of comments) {
      // Skip comments authored by the current user
      if (comment.author?.accountId === accountId) continue;
      // Check if this comment mentions us in the raw ADF
      if (findMentionsInAdf(comment.body, accountId)) {
        mentions.push({
          issueKey: issue.key,
          summary: issue.fields.summary,
          commentId: comment.id,
          commentAuthor: comment.author?.displayName || "Unknown",
          commentBody: adfToText(comment.body),
          commentCreated: comment.created,
          url: `${config.host}/browse/${issue.key}`,
        });
      }
    }
  }

  return mentions;
}
