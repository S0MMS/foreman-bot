# Foreman Architecture

## What is Foreman?

Foreman is a Slack bot that bridges Claude Code sessions into Slack channels. Each Slack channel gets its own independent AI session. Users send messages in Slack; Foreman routes them to the underlying AI, streams the response back, and handles tool approval via interactive Slack buttons.

It runs locally on your Mac as a Node.js process, uses Slack's Socket Mode (no public URL needed), and is published to npm as `foreman-bot`.

---

## High-Level Flow

```
User (Slack) → Bolt App (slack.ts) → claude.ts → Adapter → AI Provider
                                          ↓
                               MCP Server (mcp-canvas.ts)
                                          ↓
                            Canvas / Jira / Confluence / GitHub
```

1. User sends a message in a Slack channel
2. `slack.ts` receives the event via Bolt, looks up (or creates) the channel's session state
3. `claude.ts` calls `startSession()` or `resumeSession()` on the appropriate adapter
4. The adapter streams the response back; tool calls are either auto-approved or sent to Slack as approval buttons
5. Final text response is posted back to Slack

---

## Repo Structure

```
src/
  index.ts        — Entry point: starts Bolt, loads sessions, wires everything together
  slack.ts        — All Slack event handlers and /cc command parsing
  claude.ts       — Thin dispatch layer: startSession / resumeSession / abortCurrentQuery
  session.ts      — Per-channel state management + disk persistence
  types.ts        — Shared types: SessionState, MODEL_ALIASES, AUTO_APPROVE_TOOLS
  config.ts       — Loads ~/.foreman/config.json
  format.ts       — Markdown↔Slack formatting, message chunking, progress display
  init.ts         — Interactive setup wizard (foreman init)
  mcp-canvas.ts   — In-process MCP server exposing Foreman's own tools
  canvas.ts       — Slack canvas CRUD helpers
  jira.ts         — Jira REST API helpers
  confluence.ts   — Confluence REST API helpers
  github.ts       — GitHub REST API helpers
  webhook.ts      — Optional inbound webhook support
  adapters/
    AgentAdapter.ts     — Shared interface all adapters implement
    AnthropicAdapter.ts — Claude Agent SDK integration
    OpenAIAdapter.ts    — OpenAI chat completions (streaming, no tool support yet)
    index.ts            — Factory: getAdapter(name)
```

---

## Session & State Management

Each Slack channel has its own `SessionState`, keyed by channel ID (e.g. `C012ABC` or `D012ABC` for DMs).

### SessionState fields

| Field | Type | Description |
|---|---|---|
| `sessionId` | `string \| null` | Claude Code session UUID (used to resume) |
| `name` | `string \| null` | Persona name for this channel (e.g. "Foreman") |
| `ownerId` | `string \| null` | Slack user ID of session owner |
| `cwd` | `string` | Working directory passed to Claude |
| `model` | `string` | Model ID (default: `claude-sonnet-4-6`) |
| `adapter` | `string` | Which adapter to use: `"anthropic"` or `"openai"` |
| `plugins` | `string[]` | Absolute paths to loaded Claude Code plugin dirs |
| `canvasFileId` | `string \| null` | Cached canvas file ID for this channel |
| `autoApprove` | `boolean` | Skip all approval prompts when true |
| `isRunning` | `boolean` | Whether a query is in-flight |
| `abortController` | `AbortController \| null` | Used by `/cc stop` |
| `pendingApproval` | `PendingApproval \| null` | Awaiting a user's Approve/Deny button tap |

State is persisted to `~/.foreman/sessions.json` after every mutation. On startup, `loadSessions()` restores all channels from disk. A legacy single-session format (`session.json`) is migrated automatically on first run.

---

## Adapter Architecture

`claude.ts` is a thin dispatch layer. It calls `getAdapter(state.adapter)` and delegates to the appropriate implementation. All adapters implement the `AgentAdapter` interface:

```typescript
interface AgentAdapter {
  start(options: AgentOptions & { cwd: string; name: string }): Promise<QueryResult>;
  resume(options: AgentOptions & { sessionId: string; cwd: string; name: string }): Promise<QueryResult>;
  abort(channelId: string): void;
}
```

### AnthropicAdapter

Uses the `@anthropic-ai/claude-agent-sdk` `query()` function. Full Claude Code feature set: tools, plugins, MCP servers, session resumption, streaming, cost tracking.

Key behaviors:
- Builds `canUseTool` callback — auto-approves read-only tools, delegates others to `onApprovalNeeded` (Slack buttons)
- Attaches `PreToolUse` hooks for progress messages on auto-approved tools
- Passes the `foreman-toolbelt` MCP server + Slack MCP to every query
- Session ID is extracted from the `system/init` message and persisted

### OpenAIAdapter

Uses the `openai` npm package with an agentic tool loop. Maintains per-channel conversation history in memory (not persisted across restarts).

Supports `ReadFile`, `WriteFile`, and `EditFile`. `WriteFile` and `EditFile` require Slack button approval before executing. More file system tools coming in Phase 1.

Model selection: if `state.model` doesn't start with `"claude-"`, it's used as-is; otherwise defaults to `"o4-mini"`.

### Switching Adapters

Use the vendor-prefixed model syntax:

```
/cc model openai:gpt-4o        → OpenAIAdapter, model gpt-4o
/cc model anthropic:claude-sonnet-4-6  → AnthropicAdapter, sonnet
/cc model sonnet               → AnthropicAdapter, alias for claude-sonnet-4-6
```

Requires `openaiApiKey` in `~/.foreman/config.json` for OpenAI.

---

## Internal MCP Server (foreman-toolbelt)

Foreman runs an **in-process MCP server** (`mcp-canvas.ts`) that exposes its own tools to Claude. This is created fresh per query via `createSdkMcpServer()` from the Claude Agent SDK and passed as `mcpServers["foreman-toolbelt"]`.

### Canvas Tools

| Tool | Description |
|---|---|
| `CanvasRead` | Read the current channel's Slack canvas as markdown |
| `CanvasCreate` | Create a new canvas in this channel |
| `CanvasUpdate` | Append or update a section in the canvas (bot-tagged headings) |
| `CanvasDelete` | Delete a bot-tagged section from the canvas |
| `CanvasReadById` | Read any canvas by file ID |
| `CanvasUpdateById` | Update any canvas by file ID |
| `CanvasDeleteById` | Delete any canvas by file ID |
| `DiagramCreate` | Create a Mermaid diagram and render it to the canvas |

Bot sections are tagged with `*[bot-name] Heading*` so multiple bots can coexist on the same canvas without overwriting each other.

### Jira Tools

`JiraCreateTicket`, `JiraReadTicket`, `JiraUpdateTicket`, `JiraSearch`, `JiraAddComment`, `JiraUpdateComment`, `JiraDeleteComment`

### Confluence Tools

`ConfluenceReadPage`, `ConfluenceSearch`, `ConfluenceCreatePage`, `ConfluenceUpdatePage`

### GitHub Tools

`GitHubCreatePR`, `GitHubReadPR`, `GitHubReadIssue`, `GitHubSearch`, `GitHubListPRs`

### Utility Tools

| Tool | Description |
|---|---|
| `LaunchApp` | Open a macOS app by name |
| `PostMessage` | Post a message to any Slack channel |
| `TriggerBitrise` | Trigger a Bitrise CI workflow |
| `SelfReboot` | Exit Foreman process (launchd restarts it) |

---

## Tool Approval

Tools are split into two tiers:

**Auto-approved** — Claude can call these without interrupting the user. Foreman posts a brief italic progress message instead (e.g. `_Reading path/to/file..._`).

Includes: `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `Explore`, `AskUserQuestion`, all canvas/Jira/Confluence/GitHub/utility tools, and `Bash`.

**Requires approval** — Everything else (primarily `Write`, `Edit`). Foreman pauses the session and posts an Approve/Deny button message in Slack. The promise resolves when the user taps a button.

MCP tool names are matched by stripping the `mcp__<server>__` prefix (e.g. `mcp__foreman-toolbelt__CanvasRead` → `CanvasRead`).

`/cc autoapprove` skips all approval prompts channel-wide.

---

## Persona / Naming

- **DM channels** (ID starts with `D`): always "Foreman"
- **Other channels**: derived from the Slack channel name (e.g. `#clive` → "Clive")
- Override with `/cc name <name>`
- Name is injected into the system prompt and stored in `SessionState.name`

---

## Configuration

Config file: `~/.foreman/config.json`

```json
{
  "slackBotToken": "xoxb-...",
  "slackAppToken": "xapp-...",
  "anthropicApiKey": "sk-ant-...",
  "openaiApiKey": "sk-...",
  "defaultCwd": "/Users/you/projects",
  "bitriseToken": "...",
  "bitriseAppSlug": "..."
}
```

Priority: `config.json` > `.env` > environment variables.

Run `foreman init` for the interactive setup wizard.

---

## /cc Command Reference

| Command | Description |
|---|---|
| `/cc cwd <path>` | Set working directory (tilde and relative paths supported) |
| `/cc model <name>` | Set model (`opus`, `sonnet`, `haiku`, or `vendor:model`) |
| `/cc name <name>` | Override persona name |
| `/cc plugin <path>` | Load a Claude Code plugin directory |
| `/cc plugin` | List loaded plugins |
| `/cc stop` | Abort in-flight query |
| `/cc session` | Show current session info |
| `/cc new` | Reset session (clears sessionId, model, plugins; keeps name + cwd) |
| `/cc canvas` | Send canvas contents to Claude as a prompt |
| `/cc spec` | Generate Tech Spec + Gherkin AC from canvas content |
| `/cc implement` | Implement a feature from canvas spec |
| `/cc commit <msg>` | `git add -A` + commit |
| `/cc push` | Push current branch to origin |
| `/cc build [scheme]` | xcodebuild + install on booted simulator |
| `/cc bitrise <workflow>` | Trigger Bitrise CI workflow |
| `/cc reboot` | Restart Foreman process |

Messages starting with `!` bypass Slack's slash command interception: `!freud:pull main` → `/freud:pull main`.
