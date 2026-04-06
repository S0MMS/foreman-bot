# Foreman 2.0 — Implementation Plan

> **Goal:** Add Kafka/Redpanda as the bot communication layer and a local web UI on top. Slack continues to work exactly as today. No breaking changes.

---

## Phase 1 — Foundation: bots.yaml + Redpanda

**What:** Define bot identities explicitly. Stand up Redpanda locally. Auto-create Kafka topics from bot config.

**Tasks:**
- [x] Define `bots.yaml` schema — see below
- [x] Write `src/bots.ts` — YAML parser, bot registry, type definitions
- [x] Add Redpanda to `docker-compose.yml`
- [x] On Foreman startup: read `bots.yaml`, auto-create `{name}.inbox` / `{name}.outbox` topic pairs in Redpanda

**Done when:** `docker compose up` starts Redpanda, Foreman reads `bots.yaml` and topics appear in Redpanda Console at `localhost:8080`.

**STATUS: COMPLETE ✅** — Docker Desktop installed, Redpanda running, all bot topics visible in Console at `localhost:8080`.

### bots.yaml Schema

Bot types and required fields:

| type | Required fields | Description |
|---|---|---|
| `sdk` | `provider`, `model` | Local Anthropic/OpenAI/Gemini SDK call — today's behavior |
| `webhook` | `url` | HTTP POST to any endpoint — escape hatch for LangChain, Lambda, etc. |
| `agentcore` | `agent_id`, `alias_id` | AWS Bedrock AgentCore — reserved, not yet implemented |
| `human` | `slack_user`, `timeout_seconds` | Routes to a Slack DM, waits for human reply |
| `mock` | `response` | Returns a canned response — for testing workflows |

All bots require `type` and `system_prompt`.

Env vars in any string field are resolved automatically: `${MY_TOKEN}` → `process.env.MY_TOKEN`.

Key exported functions from `src/bots.ts`:
- `getBotRegistry()` — singleton Map of all bots
- `getBot(name)` — get one bot by name, throws if missing
- `getAllBots()` — all bots as array
- `getBotsByType(type)` — filter by type
- `getAllTopics()` — all inbox + outbox topic names (for Redpanda auto-create)

---

## Phase 2 — Bot Runner: Kafka as Transport

**What:** Foreman listens to each bot's inbox topic, processes messages through the right SDK adapter, and produces responses to the outbox topic.

**Tasks:**
- [x] `dispatchToBotInbox(botInboxName, prompt)` added to `activities.ts` — Kafka-native dispatch, does NOT touch Slack transport
- [x] Kafka consumer loop in Foreman — one consumer per bot in `bots.yaml`
- [x] Each consumer: reads from `{name}.inbox` → calls correct SDK adapter → produces to `{name}.outbox`
- [x] Per-bot mutex → Kafka consumer group semantics

**Key design decision:** `dispatchToBot()` is **unchanged**. A new parallel function `dispatchToBotInbox(botInboxName, prompt)` handles Kafka dispatch explicitly. Callers opt in — no regression risk.

- `dispatchToBot(channelId, prompt)` — direct SDK call, Slack transport, today's behavior
- `dispatchToBotInbox("betty.inbox", prompt)` — produces to Kafka inbox, awaits `correlationId` on outbox

**STATUS: COMPLETE ✅** — `startBotConsumers()` running. One KafkaJS consumer per bot. Snappy compression supported via `kafkajs-snappy`. Foreman healthy as of 2026-04-03.

---

## Phase 3 — foreman ui: Local Web App

**What:** A chat-style web UI that lets developers talk to bots and run FlowSpec workflows — no Slack required.

**Tech stack:** Vite + React + TypeScript + Tailwind + shadcn/ui
**Aesthetic:** Neo-brutalist (thick borders, monospace font, high contrast, no rounded corners)
**Key constraint:** All UI code written by a Foreman bot. No hand-written HTML ever.

**Tasks:**
- `foreman ui` CLI command — spins up Express server + Vite dev build, opens browser
- WebSocket bridge: tails Kafka topics → streams to browser in real time
- Left nav: bot list (from `bots.yaml`) with status indicators (🟢🟡🔴)
- Left nav: workflow list (auto-scanned from `flows/` directory)
- Conversation view: unified timeline of `{name}.inbox` + `{name}.outbox` messages
- Send box: produces directly to `{name}.inbox`
- Workflow launcher: click a `.flow` file → prompt for inputs → trigger Temporal workflow
- Tool approval: pending approvals show as yellow badge on bot in left nav, click to approve/deny

**Done when:** A developer with no Slack app can `npm install -g foreman-bot`, run `docker compose up`, run `foreman ui`, and have a full working bot environment in the browser.

---

## Phase 4 — UI Polish & Workspaces (not started)

### LeftNav Three-Section Model

The LeftNav will contain three distinct sections:

**Section 1 — Architect + Infrastructure**
- Foreman Architect (pinned at top, as today)
- Redpanda Console — clicking shows the console embedded in the right panel via iframe (no frame-blocking headers, confirmed working)
- Temporal Console — opens in new tab (sends `X-Frame-Options: SAMEORIGIN`, blocks iframe from different port). Future: proxy through Express to enable embedding.

**Section 2 — Bots**
- Flat list of available/unassigned bots (betty, clive, gpt-worker, etc.)
- Always visible — acts as the "talent pool"
- Bots can be dragged into workspaces (moves them out of this section)

**Section 3 — Workspaces**
- Task-oriented containers (like a Jira ticket or project folder)
- Each workspace has: assigned bots + shared canvases (files on disk)
- Create workspaces in the UI; drag bots in from Section 2
- Can also create new bots directly within a workspace

### Workspace Design

**Workspace = directory on disk.** Each workspace is a subdirectory (e.g. `workspaces/techops-2187/`) containing all artifacts:
```
workspaces/techops-2187/
  workspace.yaml        ← metadata: assigned bots, display name
  links.md              ← canvas: Important Links
  ideas.md              ← canvas: Ideas & Notes
  techops-2187.flow     ← canvas: FlowSpec Workflow
  architecture.mmd      ← canvas: Mermaid Diagram
```

**Directory naming: slugs** (same pattern as GitHub repos, npm packages, Docker, Kubernetes).
- User enters display name: "TECHOPS-2187: Burger View Feature"
- Slug generated once: `techops-2187-burger-view-feature` → becomes the directory name, never changes
- Display name stored in `workspace.yaml`, can be changed anytime
- Slugify rules: lowercase, alphanumeric + hyphens only, no spaces, no special characters
```js
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
```

**Workspace-scoped bots:** A workspace can define its own bots in `workspace.yaml` using the same schema as `bots.yaml`:
```yaml
name: "Pythia: Multi-Bot Verification"
bots:
  - name: pythia-worker-1
    type: sdk
    provider: anthropic
    model: claude-sonnet-4-6
    system_prompt: "You are a research analyst..."
  - name: pythia-judge
    type: sdk
    provider: anthropic
    model: claude-opus-4-6
    system_prompt: "You are a judge synthesizing..."
```
Two kinds of bots: **global** (`bots.yaml`, available everywhere) and **workspace** (`workspace.yaml`, scoped to that workspace). Workspace bots spin up on-demand when the workspace is opened, tear down when closed.

**Bot namespacing:** The workspace slug acts as a namespace to prevent collisions. Two workspaces can both define a bot named `worker-1` without conflict:
```
Workspace: pythia (slug)
  Bot: worker-1  → internally: pythia/worker-1
  Kafka topics:  pythia.worker-1.inbox, pythia.worker-1.outbox

Workspace: code-review (slug)
  Bot: worker-1  → internally: code-review/worker-1
  Kafka topics:  code-review.worker-1.inbox, code-review.worker-1.outbox
```
FlowSpec files within a workspace reference bots by short name (`worker-1`). Foreman resolves to the namespaced version (`pythia/worker-1`) based on the active workspace context. Same pattern used by Docker Compose (project prefix) and Kubernetes (namespaces).

**Key design decisions:**
- Canvases belong to the **workspace**, not to individual bots. All bots in the workspace share the same files.
- A bot assigned to a workspace gets its `cwd` set to the workspace directory.
- A bot can only be in **one workspace at a time** (keep it simple; revisit if needed).
- Dragging a bot back out of a workspace returns it to the unassigned pool.
- Tab bar shows files in the workspace directory as canvases.
- Backend: `GET /api/workspace/:name/files` does `fs.readdir()`, `GET /api/workspace/:name/files/:filename` does `fs.readFile()`.

**Canvas rendering (dead simple, complexity target: 2/5):**
| File type | Renderer |
|---|---|
| `.md` | `react-markdown` (1 npm install, 2 lines of code) |
| `.flow`, `.yaml`, `.txt` | Raw text in `<pre>` block |
| `.mmd` (Mermaid) | `mermaid` npm package → SVG (add later) |
| `.png`, `.jpg` | `<img>` tag pointing to backend file endpoint |

Rendering is a switch on file extension. No complex rendering engine.

### Parity with Claude Code Terminal

- Agent SDK sessions already load user MCPs via `settingSources: ['user', 'project']` — confirmed in `src/ui-claude.ts`
- [ ] `/compact` equivalent — no SDK support yet, investigate when needed
- Goal: new devs should feel "this is just Claude Code with a better UI", not "this is a different thing"

### `/f session` — Tool Visibility by Source

Tools should be grouped by source so devs can see exactly what's available and where it came from:
```
🔧 Session Tools

Claude Code Built-in (12)
  Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch...

Foreman Toolbelt (28)
  Canvas: Append, Create, Read, Delete, FindSection...
  Jira: CreateTicket, ReadTicket, Search, Transition...
  GitHub: CreatePR, ListPRs, ReadIssue, Search...
  Slack: PostMessage, ReadChannel
  System: SelfReboot, GetCurrentChannel, LaunchApp...

Atlassian Cloud MCP (28)
  Jira: createIssue, editIssue, getIssue, searchUsingJql...
  Confluence: createPage, getPage, updatePage, search...

Slack Cloud MCP (12)
  read_channel, send_message, search_channels...
```

Grouping is free — MCP tool names encode their source: `mcp__foreman-toolbelt__CanvasRead` → source: `foreman-toolbelt`. Parse the double-underscore prefix.

**Two implementation approaches:**

**Approach 1 — Static config inspection (simple, 2/5):**
Backend reads `~/.claude/mcp-needs-auth-cache.json` to list cloud MCPs that have been authed, plus lists MCPs it explicitly injects (foreman-toolbelt). Shows tools that *should* be active. Free, instant, no API cost.

**Approach 2 — Runtime introspection (thorough, 3/5):**
Add a `SessionInfo` tool to `foreman-toolbelt` that the Architect can call to list its own tools. When `/f session` is invoked, triggers a quick AI query to enumerate the full tool list. Costs one API call but gives the complete, accurate picture.

**Decision:** Start with Approach 1. Add Approach 2 later if devs need the full picture.

### Other Phase 4 Tasks

- [ ] Image attachment in chat — drag-and-drop or file picker to attach screenshots/images to messages. Architect can read images via the Agent SDK.
- [ ] Mobile-friendly layout — hide/collapse LeftNav sidebar on small screens, hamburger menu to reveal it
- [ ] Open source LLM support — Ollama adapter for running local models (Llama 3, Mistral, etc.) as bots in `bots.yaml`
- [ ] Dockerize Temporal — add Temporal to `docker-compose.yml` with a profile so `docker compose --profile full up` starts Redpanda + Temporal together
- [ ] Dockerize everything — single `docker compose up` for full Foreman stack (for distribution to other developers)

---

## What Is NOT in 2.0

- AgentCore integration — deferred
- Cloud/hosted deployment — local only
- `foreman ask` / `foreman watch` CLI commands — covered by UI + Redpanda Console
- Slack removal — Slack still fully works, just no longer required

---

## Dependency Order

```
bots.yaml schema
    ↓
Redpanda + docker-compose
    ↓
Bot runner (Kafka consumer loop)
    ↓
dispatchToBot() over Kafka
    ↓
foreman ui (React app)
```

---

## Architecture: How It All Fits Together

```
bots.yaml  ←  single source of truth for bot identity
    ↓
Foreman startup
    ├── creates Redpanda topics for each bot
    ├── starts Kafka consumer loop (one per bot)
    └── starts Slack bridge (unchanged)

Incoming message (Slack or Kafka)
    ↓
processChannelMessage() / Kafka consumer
    ↓
SessionState → SDK adapter (Anthropic / OpenAI / Gemini)
    ↓
Response → Slack or betty.outbox topic

Temporal workflow (FlowSpec)
    ↓
dispatchToBot("betty", prompt)
    ↓
produce → betty.inbox
    ↓
Foreman bot runner processes it
    ↓
consume ← betty.outbox (matched by correlationId)
    ↓
Temporal workflow resumes
```

---

## Infrastructure: Local Dev

| Service | URL | How to start |
|---|---|---|
| Redpanda broker | localhost:9092 | `docker compose up` |
| Redpanda Console | localhost:8080 | `docker compose up` |
| Temporal server | localhost:7233 | `temporal server start-dev` |
| Temporal UI | localhost:8233 | (included with above) |
| Foreman | — | `npm run dev` |
| Foreman UI | localhost:3000 | `foreman ui` |

---

## Key Files (Foreman codebase)

| File | What changes |
|---|---|
| `src/bots.ts` | New — bots.yaml parser, topic auto-creation, bot registry |
| `src/kafka.ts` | New — Kafka producer/consumer wrappers (KafkaJS) |
| `src/temporal/activities.ts` | Update `dispatchToBot()` to produce/consume Kafka |
| `src/index.ts` | Start Kafka consumer loop on boot |
| `docker-compose.yml` | Add Redpanda service |
| `bots.yaml` | New — bot registry config file |
| `ui/` | New — Vite + React + Tailwind app (`foreman ui`) |
