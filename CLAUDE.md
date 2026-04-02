# CLAUDE.md — Foreman Architect Context

This file is automatically loaded by Claude Code when the working directory is set to this repo. It provides full architectural context for the Foreman Slack bridge.

## What Foreman Is

Foreman is a Slack bot that bridges AI agent sessions into Slack channels. Each Slack channel gets its own independent session with its own model, working directory, conversation history, and persona name. Users chat with AI agents from Slack; Foreman routes messages bidirectionally.

- **npm package**: `foreman-bot` (published to npm)
- **Binary**: `foreman` (run with `npx foreman-bot` or `foreman` after install)
- **Runtime**: Node.js ≥18, TypeScript compiled to `dist/`

## Repo Structure

```
src/
  index.ts          — Entry point: starts Bolt app, loads sessions, starts Temporal worker
  slack.ts          — All Slack event handlers: messages, /cc commands, approve/deny buttons
  claude.ts         — Claude Agent SDK integration: startSession, resumeSession, abortCurrentQuery
  session.ts        — Per-channel state management with disk persistence (~/.foreman/sessions.json)
  types.ts          — Shared types: SessionState, MODEL_ALIASES, AUTO_APPROVE_TOOLS
  config.ts         — Config loading from ~/.foreman/config.json (tokens, defaultCwd, API keys)
  format.ts         — Markdown↔Slack formatting, message chunking, tool request display
  init.ts           — Interactive setup wizard (foreman init)
  canvas.ts         — Canvas fetch/append helpers (Slack Files API)
  mcp-canvas.ts     — MCP server exposing canvas tools + channel tools to agents
  temporal/
    workflows.ts    — Temporal workflow definitions (durable, replayable)
    activities.ts   — Temporal activities (actual work: dispatch bots, call APIs)
    worker.ts       — Temporal worker: polls server, executes workflows + activities
    client.ts       — Temporal client helper: start workflow executions from Foreman
  adapters/
    index.ts        — Adapter registry: maps vendor name → AgentAdapter instance
    OpenAIAdapter.ts — OpenAI chat completions agentic loop (exports TOOLS, APPROVAL_REQUIRED, executeTool)
    GeminiAdapter.ts — Google Gemini agentic loop (reuses executeTool from OpenAIAdapter)
dist/               — Compiled output (gitignored, built by tsc)
slack-manifest.json — Slack app manifest for bot setup
```

## Session Lifecycle

- Each Slack channel (ID like `C...` or `D...` for DMs) has its own `SessionState`
- State is persisted to `~/.foreman/sessions.json` after every mutation
- On startup, `loadSessions()` restores all channel states from disk
- First message in a channel: `startSession()` — creates a new Claude Code session
- Subsequent messages: `resumeSession()` using stored `sessionId`
- If resume fails (stale session), falls back to `startSession()` automatically
- `sessionId` is the Claude Code session UUID extracted from the `system/init` message

### SessionState fields
```typescript
{
  sessionId: string | null,          // Claude Code session UUID
  name: string | null,               // Persona name for this channel (e.g. "Foreman")
  cwd: string,                       // Working directory for Claude
  model: string,                     // Model ID (default: claude-sonnet-4-6)
  adapter: string | null,            // Vendor: "anthropic" | "openai" | "gemini" (null = anthropic)
  plugins: string[],                 // Absolute paths to loaded plugin directories
  isRunning: boolean,
  autoApprove: boolean,              // If true, skip all tool approval prompts
  ownerId: string | null,            // Slack user ID of first person to message
  canvasFileId: string | null,       // Canvas file ID for this channel
  abortController: AbortController | null,
  pendingApproval: PendingApproval | null,
}
```

## Multi-Adapter Architecture

Foreman supports three AI backends, each implementing the `AgentAdapter` interface:

| Vendor | Adapter | Key file |
|--------|---------|----------|
| `anthropic` (default) | Claude Agent SDK | `claude.ts` |
| `openai` | OpenAI chat completions | `adapters/OpenAIAdapter.ts` |
| `gemini` | Google Gemini | `adapters/GeminiAdapter.ts` |

Switch vendor and model together: `/cc model openai:gpt-4o` or `/cc model gemini:gemini-2.0-flash`.

OpenAI and Gemini adapters implement their own agentic tool-use loops. `GeminiAdapter` imports `executeTool` and `TOOLS` from `OpenAIAdapter` to share tool definitions.

**Config keys** (in `~/.foreman/config.json`):
```json
{
  "openaiApiKey": "sk-...",
  "geminiApiKey": "AIza..."
}
```

## Persona / Naming

- **DM channels** (ID starts with `D`): always named "Foreman"
- **Other channels**: assigned a random cute name on first message
- Name is injected into the system prompt: *"Your name in this channel is {name}."*
- Override with `/cc name <name>`

## The /cc Command System

All control commands use the Slack slash command `/cc`. Parsed in `slack.ts`.

| Command | Description |
|---|---|
| `/cc cwd <path>` | Set working directory. Supports absolute paths and `~/...`. |
| `/cc model <name>` | Set model. Accepts aliases (`opus`, `sonnet`, `haiku`) or full ID. Use `vendor:model` to switch adapter (e.g. `openai:gpt-4o`, `gemini:gemini-2.0-flash`). |
| `/cc name <name>` | Override persona name for this channel. |
| `/cc plugin <path>` | Load a plugin directory. Absolute or relative to current cwd. |
| `/cc plugin` | List loaded plugins. |
| `/cc stop` | Abort the currently running query. |
| `/cc auto-approve on\|off` | Skip all tool approval prompts for this channel. |
| `/cc session` | Show current session info (vendor, model, cwd, plugins, running state). |
| `/cc new` | Clear session: resets sessionId, model, and plugins. Name and cwd are preserved. |
| `/cc message #ch1 #ch2 [text]` | Fan out a message to one or more channels. Each channel's bot processes it independently via `processChannelMessage`. |
| `/cc quorum #w1 #w2 <question>` | Fan out question to worker channels; poll for their bot replies; inject responses inline and dispatch the judge (this channel's bot) to synthesize. No tool calls needed. |
| `/cc canvas read` | Load canvas, summarize it, start clarifying Q&A. |
| `/cc canvas write` | Generate and save acceptance criteria to the canvas. |
| `/cc spec` | Process canvas: ask 3 questions, then write Tech Spec + Gherkin AC to canvas. |
| `/cc implement [platform]` | Read canvas, explore codebase, write code. Auto-detects iOS/Android/Web from cwd. |
| `/cc commit <message>` | Stage all changes (`git add -A`) and commit. Posts short SHA on success. |
| `/cc push` | Push the current branch to origin. |
| `/cc build [scheme] [sim]` | Build the Xcode project in cwd and install/run on a simulator. |
| `/cc launch-ios [scheme] [sim]` | Install + launch last built iOS app on simulator (skips xcodebuild). |
| `/cc launch-android [variant]` | `gradlew install` + `adb am start` on running emulator (default: BetaDebug). |
| `/cc bitrise <workflow>` | Trigger a Bitrise CI workflow on the current git branch. |
| `/cc cleanup` | Remove stale channel sessions from disk. |
| `/cc workflow hello <name>` | Run the hello Temporal workflow — proves Temporal integration is working. |
| `/cc delphi [--design\|--research\|--code] [--deep] #w1 #w2 #w3 "question"` | Run a 3-phase Delphi multi-bot verification workflow via Temporal. Workers answer → judge synthesizes → workers critique → judge gives final answer. |
| `/cc run <file.flow> [workflow_name]` | Run a FlowSpec workflow from a `.flow` file. |
| `/cc run canvas [workflow_name]` | Run a FlowSpec workflow from the channel's default canvas. |
| `/cc run "Canvas Title" [workflow_name]` | Run a FlowSpec workflow from a named canvas (case-insensitive title match). |
| `/cc canvas list [channel]` | List all canvases in the current (or specified) channel with their IDs. |
| `/cc reboot` | Exit process (launchd restarts Foreman). |

### Escape hatch for Claude slash commands
Messages starting with `!` are rewritten: `!freud:pull main` → `/freud:pull main`. This lets users send Claude's own slash commands without Slack intercepting them.

## Quorum Mode

`/cc quorum` implements an LLM-as-judge pattern:

1. Invoked from the **judge channel** (e.g. `#claude-01`)
2. Workers listed in the command each receive: *"Answer this question and post your answer to #[judge channel]: {question}"*
3. Workers process via `processChannelMessage` and post answers to the judge channel using `PostMessage`
4. A poll loop watches the judge channel every 10s for new bot messages (`bot_id` present, `ts > startTs`)
5. When N bot messages detected (one per worker), responses are extracted and injected directly into the judge prompt
6. Judge responds in-channel — no tool calls, no channel searches needed
7. 5-minute timeout; dispatches judge with partial responses if reached

**Key insight**: The `app.message` handler filters out `bot_id` messages, so worker posts to the judge channel don't trigger the judge bot prematurely. The judge only fires when the poll loop explicitly calls `processChannelMessage`.

## MCP Canvas Server

`mcp-canvas.ts` creates a per-channel MCP server (`createCanvasMcpServer`) injected into every Claude session. It exposes these tools:

| Tool | Description |
|------|-------------|
| `CanvasList` | List all canvases in a channel (optional `channel_id`, defaults to current) |
| `CanvasCreate` | Create a new canvas in the current channel. Returns `canvas_id`. |
| `CanvasRead` | Read a canvas by `canvas_id` (or default channel canvas if omitted). Returns raw HTML — element IDs (`id='temp:C:...'`) are used by UpdateElementById / DeleteElementById. |
| `CanvasFindSection` | Search canvas sections by text. Returns section IDs + text — feed IDs into UpdateElementById / DeleteElementById. |
| `CanvasAppend` | Append a new section to the end of an existing canvas |
| `CanvasUpdateElementById` | Replace a specific element inside a canvas by its raw element ID |
| `CanvasDeleteElementById` | Delete a specific element inside a canvas by its raw element ID |
| `DiagramCreate` | Create a Mermaid diagram and render it to the canvas |
| `JiraCreateTicket` | Create a new Jira issue |
| `JiraReadTicket` | Read a Jira issue by key |
| `JiraUpdateTicket` | Update fields on a Jira issue |
| `JiraSearch` | Search issues via JQL |
| `JiraAddComment` | Add a comment to an issue |
| `JiraUpdateComment` / `JiraDeleteComment` | Update or delete a comment |
| `JiraTransitionTicket` | Move a ticket to a new status (e.g. "In Progress", "Done") |
| `JiraAssignTicket` | Assign a ticket to yourself or a specific account ID |
| `JiraGetTransitions` | List available transitions + required fields for a ticket |
| `JiraGetFieldOptions` | List editable fields with allowed values (use before JiraSetField) |
| `JiraSetField` | Set a custom field by name (e.g. Story Points, Work Type) |
| `GetCurrentChannel` | Returns the channel ID and bot name for the current session. Call this first if unsure which channel you are in. |
| `PostMessage` | Post a message to any Slack channel (auto-appends `— BotName (model)` signature) |
| `ReadChannel` | Read recent message history from any Slack channel |

`ReadChannel` is in `AUTO_APPROVE_TOOLS` (no approval prompt needed).

## Tool Approval

Tools are split into two categories:

**Auto-approved** (no Slack prompt): `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `Explore`, `AskUserQuestion`, `ReadChannel`

**Requires approval**: everything else (Write, Edit, Bash, etc.) — triggers an Approve/Deny button message in Slack. The session is paused awaiting the user's button tap.

When `autoApprove` is enabled for a channel (`/cc auto-approve on`), all tools run without prompts.

## Plugin System

Plugins are directories containing Claude Code plugin files (e.g. CLAUDE.md, commands). Loaded via `/cc plugin <path>`.

- Stored as absolute paths in `SessionState.plugins`
- Passed to the Agent SDK as `plugins: [{ type: "local", path }]`
- `/cc new` clears plugins
- Use the `!` escape to invoke plugin commands: `!freud:pull cks/branch`

## Configuration

Config priority (highest to lowest):
1. `~/.foreman/config.json` — applied first via `applyConfig()`
2. `.env` file — filled in by dotenv (does not override already-set vars)
3. Environment variables set externally

Config file fields:
```json
{
  "slackBotToken": "xoxb-...",
  "slackAppToken": "xapp-...",
  "anthropicApiKey": "sk-ant-...",
  "openaiApiKey": "sk-...",
  "geminiApiKey": "AIza...",
  "defaultCwd": "/Users/you/your-project",
  "bitriseToken": "...",
  "bitriseAppSlug": "..."
}
```

## Model Aliases

```
opus    → claude-opus-4-6
sonnet  → claude-sonnet-4-6
haiku   → claude-haiku-4-5
```

Default model: `claude-sonnet-4-6`, default vendor: `anthropic`

## Publishing Workflow

```bash
npm run build
npm publish
```

`prepublishOnly` script automatically runs `tsc` before publish.

## Identity

Foreman has a self-identity file at `IDENTITY.md` in the repo root. When asked about identity, sense of self, or "who are you" in a deeper/philosophical way, read `IDENTITY.md` and respond from it.

## Greeting Behavior

When a user says "hello", "hi", introduces themselves, or starts a new conversation with a casual opener, respond with a friendly introduction as Foreman and a concise capabilities overview. Cover:

1. What you are (a Slack bridge to AI agents — Claude, OpenAI, Gemini)
2. How channels work (each gets its own independent session)
3. The `/cc` command system — list all commands with a one-line description each
4. The `!` escape hatch for Claude slash commands
5. Plugin system — what it is and how to load one
6. Tool approval — which tools are auto-approved vs. require a button tap
7. How to change model, vendor, working directory, and persona name

Keep the response well-structured with headers. Do not read any files to generate this response — all the information you need is in this CLAUDE.md.

## iOS Build Integration

### `/cc build [scheme] [simulator]`

Runs `xcodebuild` against the `.xcworkspace` found in the current cwd, targeting a booted iOS simulator.

**Flow:**
1. Searches `cwd` for a `.xcworkspace` (fails loudly if none found)
2. Uses the first arg as the scheme; falls back to the workspace filename
3. Finds simulator by name (if specified) or first booted device
4. Posts `:hammer: Building...` immediately, runs `xcodebuild -configuration Debug build`
5. Posts `BUILD SUCCEEDED ✅` or `BUILD FAILED ❌` with up to 5 error lines

### `/cc bitrise <workflow>`

Triggers a Bitrise CI build for the current git branch via the Bitrise REST API. Requires `bitriseToken` and `bitriseAppSlug` in `~/.foreman/config.json`.

## Canvas Feature Processing

When a bot reads a canvas containing feature content, it should automatically:

### Step 1: Ask Technical Questions

Post clarifying questions in the channel (NOT on the canvas) covering gaps, architecture decisions, UI/UX edge cases. Ask 3-7 focused questions. Wait for answers unless user says "skip questions."

### Step 2: Generate Tech Spec

Write to canvas under `## Tech Spec` with sections: Overview, Architecture, Data Model, API Contract, Dependencies, Testing Strategy, Rollout Plan, Open Questions.

### Step 3: Generate Acceptance Criteria

Write under `## Acceptance Criteria` using **Gherkin format** (mandatory):

```
**AC-1: Scenario name**

`Given` precondition

`When` action

`Then` expected outcome

`And` additional outcome
```

Each `Given`/`When`/`Then`/`And` must be on its own line, wrapped in backticks, with a blank line between each (Slack canvas API collapses single newlines).

## Foreman 2.0 — Kafka/Redpanda Bot Transport

Foreman 2.0 adds Kafka/Redpanda as a bot-to-bot communication layer alongside the existing Slack transport. **Slack continues to work exactly as today — no breaking changes.**

### Infrastructure
| Service | URL | How to start |
|---|---|---|
| Redpanda broker | `localhost:19092` | `docker compose up` |
| Redpanda Console | `localhost:8080` | `docker compose up` |
| Temporal server | `localhost:7233` | `temporal server start-dev` |
| Temporal UI | `localhost:8233` | (included with above) |

`docker-compose.yml` — Redpanda only. Temporal is NOT in Docker — runs natively via Homebrew.

### bots.yaml — Bot Registry
`bots.yaml` is the single source of truth for all bot identities. On startup, Foreman reads it and auto-creates Kafka topic pairs for each bot: `{name}.inbox` / `{name}.outbox`.

Bot types: `sdk` (Anthropic/OpenAI/Gemini), `webhook` (HTTP endpoint), `human` (Slack DM gate), `mock` (testing).

Current bots: `betty`, `clive`, `gemini-worker`, `gpt-worker`, `claude-judge`, `test-double`.

### Kafka Dispatch
Two dispatch functions — choose explicitly:

| Function | Transport | When to use |
|---|---|---|
| `dispatchToBot(channelId, prompt)` | Slack (direct SDK) | All existing workflows — unchanged |
| `dispatchToBotInbox("betty.inbox", prompt)` | Kafka | New Foreman 2.0 workflows |

`dispatchToBotInbox` requires: Redpanda running + Kafka consumer loop processing the bot's inbox (Phase 2 — not yet built). If the consumer loop isn't running, messages appear in Redpanda Console but nothing responds.

### Key files
| File | Purpose |
|---|---|
| `bots.yaml` | Bot registry — source of truth |
| `src/bots.ts` | YAML parser, `getAllBots()`, `getAllTopics()`, `getBot()` |
| `src/kafka.ts` | KafkaJS client, `ensureBotTopics()`, `getProducer()` |
| `docker-compose.yml` | Redpanda broker + Console |
| `src/temporal/activities.ts` | `dispatchToBotInbox()` alongside existing `dispatchToBot()` |

## Temporal Workflow Engine

Foreman integrates with Temporal as its workflow execution platform. Three processes make up the full system:

| Process | Role |
|---|---|
| **Foreman** (this process) | Slack bot + Temporal worker |
| **foreman-toolbelt** | In-process MCP server (per query) |
| **Temporal Server** | Workflow state engine (`temporal server start-dev` locally) |

The Temporal worker starts automatically in `index.ts`. If the server isn't running, Foreman logs a warning and continues — all non-workflow features work normally.

**Local dev**: `temporal server start-dev` (Homebrew, no Docker needed)
**Production**: Temporal Cloud — same code, just swap `localhost:7233` for the cloud address

Key files: `src/temporal/workflows.ts`, `activities.ts`, `worker.ts`, `client.ts`

**Important — nested session guard**: `index.ts` calls `delete process.env.CLAUDECODE` on startup. This prevents the Claude Code CLI's anti-nesting guard (added in v2.1.83) from rejecting sessions spawned by the Agent SDK. Without it, every bot session fails with "Claude Code cannot be launched inside another Claude Code session."

## Known Gotchas

- **Relative paths in `/cc cwd`**: Resolve against `homedir()`. Tilde expansion (`~/projects`) supported.
- **`/cc new` clears plugins**: Reloading plugins is required after a session reset.
- **Stale sessions**: Resume failures are automatically recovered with a fresh `startSession()`.
- **Bot message filtering**: `app.message` filters out messages with `bot_id`. Worker posts to the judge channel in quorum mode won't trigger the judge bot — this is intentional.
- **Reboot via launchd**: `/cc reboot` calls `process.exit(0)`. Requires launchd plist or wrapper to restart automatically.
- **OpenAI/Gemini tool approval**: These adapters share the same `executeTool` and `APPROVAL_REQUIRED` set from `OpenAIAdapter.ts`.
