# OpenAI Adapter Tool Support

## What & Why

The OpenAI adapter currently does raw chat completions only — no file access, no shell commands, no MCP tools. This means switching to an OpenAI model (e.g. `o3`, `codex-mini-latest`) gives you a chatbot, not a coding agent.

The goal is to bring the OpenAI adapter up to parity with the Anthropic adapter so that powerful OpenAI coding models can actually read files, edit code, run builds, and use Foreman's toolbelt — all from Slack, with the same approval flow users already know.

## Approach

OpenAI has a native [function calling / tool use API](https://platform.openai.com/docs/guides/function-calling). We define tools in OpenAI's schema format, pass them with each request, and implement an **agentic loop**: run the model → if it calls a tool, execute it → feed the result back → repeat until the model returns a final text response.

The two categories of tools to add:

1. **File system tools** — these are built into the Claude Agent SDK for Anthropic, but we have to implement them ourselves for OpenAI: read, write, edit, bash, glob, grep.
2. **Foreman toolbelt tools** — Jira, Confluence, GitHub, Canvas, etc. These already exist as in-process functions; we just need to expose them in OpenAI's tool schema format and wire up the calls.

The approval system (Slack buttons for destructive tools) should work the same way — pause the loop, send buttons, resume when the user taps.

---

## Task List

### Phase 1 — File System Tools
- [x] Define `ReadFile` tool (path → contents)
- [x] Define `WriteFile` tool (path + contents → write to disk) ✓ tested
- [x] Define `EditFile` tool (path + old_string + new_string → find & replace) ✓ tested
- [x] Define `RunBash` tool (command + cwd → stdout/stderr) ✓ tested
- [x] Define `ListFiles` tool (glob pattern → matching paths)
- [x] Define `SearchFiles` tool (regex + path → matching lines)

### Phase 2 — Agentic Loop
- [x] Replace single-shot `client.chat.completions.create` with a loop
- [x] Parse tool call responses from OpenAI
- [x] Route tool calls to the correct handler function
- [x] Feed tool results back as `tool` role messages
- [x] Terminate loop on `stop_reason: stop` (final text response)

### Phase 3 — Approval System
- [x] Auto-approve read-only tools (`ReadFile`, `ListFiles`, `SearchFiles`)
- [x] Require approval for mutating tools (`WriteFile`, `EditFile`, `RunBash`)
- [x] Wire up `onApprovalNeeded` callback (same Slack buttons as Anthropic adapter)
- [x] Post progress messages for auto-approved tool calls

### Phase 4 — Foreman Toolbelt
- [x] Step 1: Pass `app` (Slack Bolt instance) into OpenAIAdapter via AgentOptions
- [x] Step 2: Jira tools (JiraCreateTicket, JiraReadTicket, JiraUpdateTicket, JiraSearch, JiraAddComment, JiraUpdateComment, JiraDeleteComment)
- [x] Step 3: Confluence tools (ConfluenceReadPage, ConfluenceSearch, ConfluenceCreatePage, ConfluenceUpdatePage)
- [x] Step 4: GitHub tools (GitHubCreatePR, GitHubReadPR, GitHubReadIssue, GitHubSearch, GitHubListPRs)
- [x] Step 5: Utility tools (TriggerBitrise, LaunchApp)
- [x] Step 6: Canvas tools (CanvasRead, CanvasCreate, CanvasUpdate, CanvasDelete, CanvasReadById, CanvasUpdateById, CanvasDeleteById)
- [x] Step 7: PostMessage + DiagramCreate

### Phase 5 — Polish
- [x] Persist conversation history to disk (currently lost on restart)
- [x] Update ARCHITECTURE.md to reflect new OpenAI adapter capabilities
- [ ] Test with `o3` and `codex-mini-latest`
