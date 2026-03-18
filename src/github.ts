import { execSync } from "child_process";

function gh(args: string, cwd?: string): string {
  try {
    return execSync(`gh ${args}`, {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    }).trim();
  } catch (err: any) {
    throw new Error(err.stderr || err.message || "gh command failed");
  }
}

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  author: string;
  branch: string;
  url: string;
  body: string;
}

export interface Issue {
  number: number;
  title: string;
  state: string;
  author: string;
  url: string;
  body: string;
  labels: string[];
}

/** Create a pull request */
export function createPR(opts: {
  title: string;
  body: string;
  base?: string;
  draft?: boolean;
}, cwd: string): { number: number; url: string } {
  const args = [
    `pr create`,
    `--title "${opts.title.replace(/"/g, '\\"')}"`,
    `--body "${opts.body.replace(/"/g, '\\"')}"`,
  ];
  if (opts.base) args.push(`--base "${opts.base}"`);
  if (opts.draft) args.push("--draft");

  const output = gh(args.join(" "), cwd);
  // gh pr create outputs the PR URL
  const url = output.trim().split("\n").pop() || output;
  const numMatch = url.match(/\/pull\/(\d+)/);
  return {
    number: numMatch ? parseInt(numMatch[1]) : 0,
    url,
  };
}

/** Read a pull request */
export function readPR(prNumber: number | string, cwd: string): PullRequest {
  const json = gh(`pr view ${prNumber} --json number,title,state,author,headRefName,url,body`, cwd);
  const pr = JSON.parse(json);
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    author: pr.author?.login || "unknown",
    branch: pr.headRefName,
    url: pr.url,
    body: pr.body || "",
  };
}

/** Read PR comments */
export function readPRComments(prNumber: number | string, cwd: string): string {
  const json = gh(`pr view ${prNumber} --json comments`, cwd);
  const data = JSON.parse(json);
  const comments = data.comments || [];
  if (comments.length === 0) return "No comments.";
  return comments.map((c: any) =>
    `**${c.author?.login || "unknown"}** (${c.createdAt}):\n${c.body}`
  ).join("\n\n---\n\n");
}

/** Read an issue */
export function readIssue(issueNumber: number | string, cwd: string): Issue {
  const json = gh(`issue view ${issueNumber} --json number,title,state,author,url,body,labels`, cwd);
  const issue = JSON.parse(json);
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.author?.login || "unknown",
    url: issue.url,
    body: issue.body || "",
    labels: (issue.labels || []).map((l: any) => l.name),
  };
}

/** Search issues and PRs */
export function searchGitHub(query: string, cwd: string): string {
  return gh(`search issues "${query.replace(/"/g, '\\"')}" --json number,title,state,repository,url --limit 10`, cwd);
}

/** List open PRs */
export function listPRs(cwd: string, state = "open"): PullRequest[] {
  const json = gh(`pr list --state ${state} --json number,title,state,author,headRefName,url,body --limit 20`, cwd);
  const prs = JSON.parse(json);
  return prs.map((pr: any) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    author: pr.author?.login || "unknown",
    branch: pr.headRefName,
    url: pr.url,
    body: pr.body || "",
  }));
}
