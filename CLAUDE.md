# CLAUDE.md — Foreman Architect Context

This file is automatically loaded by Claude Code when the working directory is set to this repo. It provides full architectural context for the Foreman Slack bridge.

## Memory System

Shared project knowledge (protocols, status, references, architecture decisions) lives in this repo:

```
docs/memory/MEMORY.md          — index of all shared memory files
docs/session-handoff.md        — what was happening in the last session
```

Key files:
- `docs/memory/project_foreman_2.md` — Foreman 2.0 status, phases, what's been built
- `docs/memory/dead_man_protocol.md` — mandatory self-modification safety protocol (also summarized below)
- `docs/memory/feedback_kafka_all_bot_traffic.md` — all bot traffic must flow through Kafka

Personal preferences for Chris Shreve live at:
```
/Users/chris.shreve/.claude/projects/-Users-chris-shreve/memory/MEMORY.md
```

When asked about ongoing projects, protocols, or context from previous conversations — read the shared memory files. Do not guess from CLAUDE.md alone.

---

## What Foreman Is

Foreman is a multi-transport AI agent bridge that connects chat platforms (Slack, Mattermost) to AI agent sessions. Each channel gets its own independent session with its own model, working directory, conversation history, and persona name. Users chat with AI agents from Slack or Mattermost; Foreman routes messages bidirectionally.

- **npm package**: `foreman-bot` (published to npm)
- **Binary**: `foreman` (run with `npx foreman-bot` or `foreman` after install)
- **Runtime**: Node.js ≥18, TypeScript compiled to `dist/`
- **Transports**: Slack (Socket Mode) + Mattermost (WebSocket) running in parallel

## Repo Structure

```
src/
  index.ts            — Entry point: starts Slack/Mattermost, loads sessions, bots, Kafka, Temporal
  slack.ts            — Slack event handlers: messages, /f commands, approve/deny buttons
  mattermost.ts       — Mattermost WebSocket bridge: messages, /f commands, tool approval
  claude.ts           — Claude Agent SDK integration: startSession, resumeSession, abortCurrentQuery
  session.ts          — Per-channel state management with disk persistence (~/.foreman/sessions.json)
  types.ts            — Shared types: SessionState, MODEL_ALIASES, AUTO_APPROVE_TOOLS
  config.ts           — Config loading from ~/.foreman/config.json (tokens, API keys)
  format.ts           — Markdown↔Slack formatting, message chunking, tool request display
  init.ts             — Interactive setup wizard (foreman init)
  canvas.ts           — Canvas fetch/append helpers (Slack Files API)
  canvases.ts         — Canvas persistence to ~/.foreman/canvases.json
  mcp-toolbelt.ts       — MCP server ("foreman-toolbelt") exposing all tools to agents
  kafka.ts            — KafkaJS client, topic management, bot consumers, callBot()
  bots.ts             — bots.yaml parser, bot registry, roster tree, status SSE
  bot-status.ts       — Bot status tracking (online/offline/busy)
  jira.ts             — Jira Cloud REST API helpers
  confluence.ts       — Confluence Cloud REST API helpers
  github.ts           — GitHub REST API helpers
  workspaces.ts       — Workspace management (scoped bot environments)
  roster-overrides.ts — Bot→folder overrides for UI roster
  ui-api.ts           — Express REST routes for the web UI
  ui-claude.ts        — WebSocket Architect handler for the web UI
  webhook.ts          — HTTP + WebSocket server on port 3001
  flowspec/
    ast.ts            — FlowSpec AST type definitions
    parser.ts         — Recursive descent parser (.flow text → AST)
    compiler.ts       — AST interpreter (executes FlowSpec via Temporal activities)
    runtime.ts        — Bot resolution, transport-aware dispatch helpers
    registry.ts       — Bot registry loader (~/.foreman/bots.json)
  temporal/
    workflows.ts      — Temporal workflow definitions (durable, replayable)
    activities.ts     — Temporal activities (dispatch bots, post status, reset sessions)
    worker.ts         — Temporal worker: polls server, executes workflows + activities
    client.ts         — Temporal client helper: start workflow executions
    slack-context.ts  — Slack-specific Temporal context helpers
  adapters/
    AgentAdapter.ts   — AgentAdapter interface definition
    AnthropicAdapter.ts — Claude Agent SDK adapter (wraps claude.ts)
    OpenAIAdapter.ts  — OpenAI chat completions agentic loop
    GeminiAdapter.ts  — Google Gemini agentic loop (shares executeTool from OpenAI)
    index.ts          — Adapter registry: maps vendor name → AgentAdapter instance
dist/                 — Compiled output (gitignored, built by tsc)
bots.yaml             — Bot registry: all bot identities, models, system prompts
flows/                — FlowSpec workflow files (.flow)
docs/memory/          — Shared knowledge base (all bots read this)
slack-manifest.json   — Slack app manifest for bot setup
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
  ownerId: string | null,            // Slack/MM user ID of first person to message
  cwd: string,                       // Working directory for Claude
  model: string,                     // Model ID (default: claude-sonnet-4-6)
  adapter?: string,                  // Vendor: "anthropic" | "openai" | "gemini" (undefined = anthropic)
  plugins: string[],                 // Absolute paths to loaded plugin directories
  canvasFileId: string | null,       // Canvas file ID for this channel
  autoApprove: boolean,              // If true, skip all tool approval prompts
  moderator: boolean,                // If true, this channel moderates multi-bot discussions
  isRunning: boolean,
  abortController: AbortController | null,
  pendingApproval: PendingApproval | null,
  contextPrimer: string | null,      // System prompt supplement injected on session start
}
```

## Multi-Adapter Architecture

Foreman supports three AI backends, each implementing the `AgentAdapter` interface (defined in `adapters/AgentAdapter.ts`):

| Vendor | Adapter | Key file |
|--------|---------|----------|
| `anthropic` (default) | Claude Agent SDK | `adapters/AnthropicAdapter.ts` (wraps `claude.ts`) |
| `openai` | OpenAI chat completions | `adapters/OpenAIAdapter.ts` |
| `gemini` | Google Gemini | `adapters/GeminiAdapter.ts` |

Switch vendor and model together: `/f model openai:gpt-4o` or `/f model gemini:gemini-2.0-flash`.

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
- **Other channels**: assigned a random pirate name on first message (e.g. "Bilge-soaked Cutlass", "Dread Kraken")
- Name is injected into the system prompt: *"Your name in this channel is {name}."*
- Override with `/f name <name>`

## The /f Command System

All control commands use the Slack slash command `/f`. Parsed in `slack.ts`.

| Command | Description |
|---|---|
| `/f cwd <path>` | Set working directory. Supports absolute paths and `~/...`. |
| `/f model <name>` | Set model. Accepts aliases (`opus`, `sonnet`, `haiku`) or full ID. Use `vendor:model` to switch adapter (e.g. `openai:gpt-4o`, `gemini:gemini-2.0-flash`). |
| `/f name <name>` | Override persona name for this channel. |
| `/f plugin <path>` | Load a plugin directory. Absolute or relative to current cwd. |
| `/f plugin` | List loaded plugins. |
| `/f stop` | Abort the currently running query. |
| `/f auto-approve on\|off` | Skip all tool approval prompts for this channel. |
| `/f session` | Show current session info (vendor, model, cwd, plugins, running state). |
| `/f new` | Clear session: resets sessionId, model, and plugins. Name and cwd are preserved. |
| `/f message #ch1 #ch2 [text]` | Fan out a message to one or more channels. Each channel's bot processes it independently via `processChannelMessage`. |
| `/f quorum #w1 #w2 <question>` | Fan out question to worker channels; poll for their bot replies; inject responses inline and dispatch the judge (this channel's bot) to synthesize. No tool calls needed. |
| `/f canvas read` | Load canvas, summarize it, start clarifying Q&A. |
| `/f canvas write` | Generate and save acceptance criteria to the canvas. |
| `/f spec` | Process canvas: ask 3 questions, then write Tech Spec + Gherkin AC to canvas. |
| `/f implement [platform]` | Read canvas, explore codebase, write code. Auto-detects iOS/Android/Web from cwd. |
| `/f commit <message>` | Stage all changes (`git add -A`) and commit. Posts short SHA on success. |
| `/f push` | Push the current branch to origin. |
| `/f build [scheme] [sim]` | Build the Xcode project in cwd and install/run on a simulator. |
| `/f launch-ios [scheme] [sim]` | Install + launch last built iOS app on simulator (skips xcodebuild). |
| `/f launch-android [variant]` | `gradlew install` + `adb am start` on running emulator (default: BetaDebug). |
| `/f bitrise <workflow>` | Trigger a Bitrise CI workflow on the current git branch. |
| `/f cleanup` | Remove stale channel sessions from disk. |
| `/f workflow hello <name>` | Run the hello Temporal workflow — proves Temporal integration is working. |
| `/f delphi [--design\|--research\|--code] [--deep] #w1 #w2 #w3 "question"` | Run a 3-phase Delphi multi-bot verification workflow via Temporal. Workers answer → judge synthesizes → workers critique → judge gives final answer. |
| `/f run <file.flow> [workflow_name]` | Run a FlowSpec workflow from a `.flow` file. |
| `/f run canvas [workflow_name]` | Run a FlowSpec workflow from the channel's default canvas. |
| `/f run "Canvas Title" [workflow_name]` | Run a FlowSpec workflow from a named canvas (case-insensitive title match). |
| `/f canvas list [channel]` | List all canvases in the current (or specified) channel with their IDs. |
| `/f reboot` | Exit process (launchd restarts Foreman). |

### Escape hatch for Claude slash commands
Messages starting with `!` are rewritten: `!freud:pull main` → `/freud:pull main`. This lets users send Claude's own slash commands without Slack intercepting them.

## Quorum Mode

`/f quorum` implements an LLM-as-judge pattern:

1. Invoked from the **judge channel** (e.g. `#claude-01`)
2. Workers listed in the command each receive: *"Answer this question and post your answer to #[judge channel]: {question}"*
3. Workers process via `processChannelMessage` and post answers to the judge channel using `PostMessage`
4. A poll loop watches the judge channel every 10s for new bot messages (`bot_id` present, `ts > startTs`)
5. When N bot messages detected (one per worker), responses are extracted and injected directly into the judge prompt
6. Judge responds in-channel — no tool calls, no channel searches needed
7. 5-minute timeout; dispatches judge with partial responses if reached

**Key insight**: The `app.message` handler filters out `bot_id` messages, so worker posts to the judge channel don't trigger the judge bot prematurely. The judge only fires when the poll loop explicitly calls `processChannelMessage`.

## MCP Canvas Server

`mcp-toolbelt.ts` creates a per-channel MCP server (`createCanvasMcpServer`) injected into every Claude session. It exposes these tools:

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
| `JiraDeleteTicket` | Delete a Jira issue |
| `ConfluenceReadPage` | Read a Confluence page by ID |
| `ConfluenceSearch` | Search Confluence content |
| `ConfluenceCreatePage` | Create a new Confluence page |
| `ConfluenceUpdatePage` | Update an existing Confluence page |
| `GitHubCreatePR` | Create a GitHub pull request |
| `GitHubReadPR` | Read a GitHub pull request |
| `GitHubReadIssue` | Read a GitHub issue |
| `GitHubSearch` | Search GitHub repositories/issues/PRs |
| `GitHubListPRs` | List pull requests for a repository |
| `TriggerBitrise` | Trigger a Bitrise CI build |
| `LaunchApp` | Launch an iOS app on a simulator |
| `SelfReboot` | Reboot the Foreman process (DM channels only) |
| `GetCurrentChannel` | Returns the channel ID and bot name for the current session |
| `PostMessage` | Post a message to any Slack channel (auto-appends `— BotName (model)` signature) |
| `ReadChannel` | Read recent message history from any Slack channel |

## Tool Approval

Tools are split into two categories:

**Auto-approved** (no approval prompt): `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `Explore`, `AskUserQuestion`, `Bash`, `PostMessage`, `ReadChannel`, `SelfReboot`, `LaunchApp`, `TriggerBitrise`, all Canvas tools (`CanvasRead`, `CanvasCreate`, `CanvasUpdate`, `CanvasDelete`, `CanvasReadById`, `CanvasUpdateById`, `CanvasDeleteById`, `DiagramCreate`), all Jira tools, all Confluence tools, all GitHub tools.

**Requires approval**: `Write`, `Edit` — triggers an Approve/Deny button message in Slack/Mattermost. The session is paused awaiting the user's button tap.

When `autoApprove` is enabled for a channel (`/f auto-approve on`), all tools run without prompts.

## Plugin System

Plugins are directories containing Claude Code plugin files (e.g. CLAUDE.md, commands). Loaded via `/f plugin <path>`.

- Stored as absolute paths in `SessionState.plugins`
- Passed to the Agent SDK as `plugins: [{ type: "local", path }]`
- `/f new` clears plugins
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
3. The `/f` command system — list all commands with a one-line description each
4. The `!` escape hatch for Claude slash commands
5. Plugin system — what it is and how to load one
6. Tool approval — which tools are auto-approved vs. require a button tap
7. How to change model, vendor, working directory, and persona name

Keep the response well-structured with headers. Do not read any files to generate this response — all the information you need is in this CLAUDE.md.

## iOS Build Integration

### `/f build [scheme] [simulator]`

Runs `xcodebuild` against the `.xcworkspace` found in the current cwd, targeting a booted iOS simulator.

**Flow:**
1. Searches `cwd` for a `.xcworkspace` (fails loudly if none found)
2. Uses the first arg as the scheme; falls back to the workspace filename
3. Finds simulator by name (if specified) or first booted device
4. Posts `:hammer: Building...` immediately, runs `xcodebuild -configuration Debug build`
5. Posts `BUILD SUCCEEDED ✅` or `BUILD FAILED ❌` with up to 5 error lines

### `/f bitrise <workflow>`

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

## Foreman 2.0 — Web UI (Primary Interface)

The Foreman 2.0 UI is a React web app that replaces Slack as the primary interface for talking to the Architect (this session). **When Chris is talking to you interactively, he is using this UI — not Slack.**

### Tech Stack

| Layer | Tech | Details |
|---|---|---|
| Frontend | React + Vite | `ui/` directory, runs on port 5173 in dev |
| Backend | Express | `src/webhook.ts`, port 3001 |
| Architect transport | WebSocket | `/ws/architect` → `src/ui-claude.ts` → Claude Agent SDK |
| Other bot transport | HTTP | `POST /api/chat` → `callBotByName()` via Kafka |
| Real-time events | SSE | `GET /api/events?botName=` for canvas updates |

### Key files

| File | Purpose |
|---|---|
| `src/ui-claude.ts` | WebSocket handler for the Architect session — bridges Claude Agent SDK to the browser |
| `src/ui-api.ts` | Express routes: `/api/roster`, `/api/bots`, `/api/chat`, `/api/canvas`, `/api/events` |
| `ui/src/App.jsx` | Root React component — WS connection, message state, canvas state |
| `ui/src/components/ChatPanel.jsx` | Message list, streaming, tool approval cards, input box |
| `ui/src/components/LeftNav.jsx` | Bot roster tree with folders, drag-and-drop |
| `ui/vite.config.js` | Vite dev server — proxies `/api` and `/ws` to port 3001 |

### Architect session details

- Channel ID for the Architect in this UI: **`ui:architect`**
- Session is persisted to `~/.foreman/sessions.json` under key `ui:architect` — Architect remembers prior conversations across restarts
- System prompt lives in `src/ui-claude.ts` (`ARCHITECT_SYSTEM_PROMPT`)
- Tool approval: same `AUTO_APPROVE_TOOLS` set as Slack; non-auto tools surface as Approve/Deny cards in the chat

### How to run

```bash
# Terminal 1 — Foreman server (backend + WS)
npm run build && node dist/index.js

# Terminal 2 — UI dev server
cd ui && npm run dev
# Opens http://localhost:5173
```

In production, Vite builds to `ui/dist/` and Express serves it statically.

---

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

Current bots: `foreman` (FlowSpec infrastructure), `betty`, `clive`, `gemini-worker`, `gpt-worker`, `claude-judge`.

### config/channel-registry.yaml — FlowSpec Channel Routing
`config/channel-registry.yaml` maps bot names to channel IDs, grouped by transport. FlowSpec reads this at runtime to dispatch workflows. This file is separate from `bots.yaml` because bot identity and channel routing are different concerns — not all devs who interact with bots will use FlowSpec.

```yaml
slack:
  flowbot-01: C0AP5TEMBL2
mattermost:
  flowbot-01: w3fkpfdzd38z5fkei3sdabnhyo
```

### Adding a Bot to a FlowSpec Workflow

When a user asks you to add a new bot to a workflow (e.g. "add a judge bot"), follow these steps. **Do NOT create a new Mattermost bot account** — the existing Foreman bot serves all channels.

1. **Create a channel** in Mattermost for the new bot (via API or UI)
2. **Invite the Foreman bot** into the new channel (it must be a member to receive dispatches)
3. **Add the channel ID** to `config/channel-registry.yaml` under the appropriate transport
4. **Add the bot definition** to `bots.yaml` (name, type, model, system_prompt)
5. **Reference the bot** in the `.flow` file by name (e.g. `ask @my-new-bot "..."`)

That's it. No new bot accounts, no new tokens, no reboot. The existing Foreman bot handles all channels — each channel is just a routing target, not a separate bot identity.

**Example:** To add `flowbot-03` as a neutral judge:
```yaml
# config/channel-registry.yaml
mattermost:
  flowbot-03: n6gyjtp4y78njqtkwreabktjhh

# bots.yaml
flowbot-03:
  type: sdk
  provider: anthropic
  model: claude-sonnet-4-6
  system_prompt: |
    You are a neutral judge and synthesizer.
```

For a runnable tutorial with progressive examples, see `flows/flowspec-tutorial.flow`.

### Kafka Dispatch
Two dispatch functions — choose explicitly:

| Function | Transport | When to use |
|---|---|---|
| `dispatchToBot(channelId, prompt)` | Slack (direct SDK) | All existing workflows — unchanged |
| `dispatchToBotInbox("betty.inbox", prompt)` | Kafka | New Foreman 2.0 workflows |

`dispatchToBotInbox` requires: Redpanda running + Kafka consumer loop processing the bot's inbox. Consumers start automatically on Foreman startup if Redpanda is available.

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

## The Dead Man Protocol (Self-Modification Safety)

Before modifying your own source code and rebooting, you MUST follow all 7 steps — no shortcuts, no skipping.

**Full protocol with all details:** `docs/memory/dead_man_protocol.md`

**Quick reference:**
1. **Pre-flight** — announce what changes and why, show `git log --oneline -3`
2. **Make changes + build** — `npm run build`, fix until clean
3. **Runtime smoke test** — `node dist/index.js &; sleep 5; curl localhost:3001/health; kill %1`
4. **Dead Man snapshot** — update `docs/memory/project_foreman_2.md` with REBOOTING status + rollback commands
5. **Session handoff** — write context to `docs/session-handoff.md`
6. **User approval** — never reboot without explicit "yes"
7. **Reboot** — call SelfReboot, then verify health + functionality post-reboot

---

## Known Gotchas

- **Relative paths in `/f cwd`**: Resolve against `homedir()`. Tilde expansion (`~/projects`) supported.
- **`/f new` clears plugins**: Reloading plugins is required after a session reset.
- **Stale sessions**: Resume failures are automatically recovered with a fresh `startSession()`.
- **Bot message filtering**: `app.message` filters out messages with `bot_id`. Worker posts to the judge channel in quorum mode won't trigger the judge bot — this is intentional.
- **Reboot via launchd**: `/f reboot` calls `process.exit(0)`. Requires launchd plist or wrapper to restart automatically.
- **OpenAI/Gemini tool approval**: These adapters share the same `executeTool` and `APPROVAL_REQUIRED` set from `OpenAIAdapter.ts`.
