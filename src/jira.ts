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

/** Get editable fields for a Jira issue with their allowed values */
export async function getJiraIssueEditMeta(issueKey: string): Promise<Record<string, { fieldId: string; required: boolean; allowedValues: Array<{ id?: string; name: string }> }>> {
  const result = await jiraFetch(`/rest/api/3/issue/${issueKey}/editmeta`);
  const out: Record<string, { fieldId: string; required: boolean; allowedValues: Array<{ id?: string; name: string }> }> = {};
  for (const [fieldId, meta] of Object.entries<any>(result.fields || {})) {
    out[meta.name || fieldId] = {
      fieldId,
      required: meta.required || false,
      allowedValues: (meta.allowedValues || []).map((v: any) => ({
        id: v.id ? String(v.id) : undefined,
        name: v.name || v.value || String(v),
      })),
    };
  }
  return out;
}

/** Set a custom field on a Jira issue by field name (looks up fieldId from editmeta) */
export async function setJiraField(issueKey: string, fieldName: string, value: any): Promise<void> {
  const meta = await getJiraIssueEditMeta(issueKey);
  const field = Object.entries(meta).find(([name]) => name.toLowerCase() === fieldName.toLowerCase());
  if (!field) {
    const available = Object.keys(meta).join(", ");
    throw new Error(`Field "${fieldName}" not found. Available: ${available}`);
  }
  const [, { fieldId, allowedValues }] = field;
  let fieldValue = value;
  if (allowedValues.length > 0) {
    const match = allowedValues.find(v => v.name.toLowerCase() === String(value).toLowerCase());
    if (!match) throw new Error(`Invalid value "${value}" for field "${fieldName}". Allowed: ${allowedValues.map(v => v.name).join(", ")}`);
    // Use id if available, otherwise name
    fieldValue = match.id ? { id: match.id } : { name: match.name };
  }
  await jiraFetch(`/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields: { [fieldId]: fieldValue } }),
  });
}

/** Get available transitions for a Jira issue, with allowed field values for each */
export async function getJiraTransitions(issueKey: string): Promise<Array<{
  id: string;
  name: string;
  fields: Record<string, { required: boolean; allowedValues: string[] }>;
}>> {
  const result = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions?expand=transitions.fields`);
  return (result.transitions || []).map((t: any) => {
    const fields: Record<string, { required: boolean; allowedValues: string[] }> = {};
    for (const [key, meta] of Object.entries<any>(t.fields || {})) {
      fields[meta.name || key] = {
        required: meta.required || false,
        allowedValues: (meta.allowedValues || []).map((v: any) => v.name || v.value || String(v)),
      };
    }
    return { id: t.id, name: t.to?.name || t.name, fields };
  });
}

/** Transition a Jira issue to a new status */
export async function transitionJiraIssue(issueKey: string, statusName: string): Promise<void> {
  const result = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`);
  const transitions: Array<{ id: string; name: string }> = result.transitions || [];
  const match = transitions.find(t => t.name.toLowerCase() === statusName.toLowerCase());
  if (!match) {
    const available = transitions.map(t => t.name).join(", ");
    throw new Error(`No transition found for "${statusName}". Available: ${available}`);
  }
  await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: match.id } }),
  });
}

/** Assign a Jira issue to the current user, or a specific accountId */
export async function assignJiraIssue(issueKey: string, accountId?: string): Promise<void> {
  const id = accountId || await getMyAccountId();
  await jiraFetch(`/rest/api/3/issue/${issueKey}/assignee`, {
    method: "PUT",
    body: JSON.stringify({ accountId: id }),
  });
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
