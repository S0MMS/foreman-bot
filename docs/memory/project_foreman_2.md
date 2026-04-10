---
name: Foreman 2.0 Status
description: Current state of Foreman 2.0 — Kafka/Redpanda bot transport layer + Foreman UI. Read this if Foreman is broken or you need to resume this work.
type: project
---

# Foreman 2.0 — Current Status

**Why:** Add Kafka/Redpanda as bot-to-bot communication layer and a local web UI. Slack bridge stays intact — zero breaking changes.

**How to apply:** Read this before touching any Foreman 2.0 code. If Foreman won't start, go straight to Emergency Recovery below.

---

## Current Health: ✅ STABLE — Kafka transport working (kafka-echo test bot confirmed)

**Last known good commit:** `8b9fb45`
**Rollback:** `git checkout 8b9fb45 -- src/bots.ts bots.yaml src/mattermost.ts && npm run build`

---

## Infrastructure State

- **Docker Desktop**: installed and running
- **Redpanda**: running via `docker compose up` in `/Users/chris.shreve/claude-slack-bridge`
  - Kafka broker: `localhost:19092`
  - Console UI: `http://localhost:8080`
- **Bot topics** auto-created on startup: `betty.inbox/outbox`, `clive.inbox/outbox`, `gemini-worker.inbox/outbox`, `gpt-worker.inbox/outbox`, `claude-judge.inbox/outbox`
- **Temporal**: runs natively via Homebrew (`temporal server start-dev`) — NOT in Docker

---

## What's Been Built

### Phase 1 ✅ — Foundation
| File | What it does |
|---|---|
| `bots.yaml` | Bot registry — single source of truth for all bot identities |
| `src/bots.ts` | YAML parser, `getAllBots()`, `getAllTopics()`, `getBot()` |
| `docker-compose.yml` | Redpanda broker + Console only |

### Phase 2 ✅ — Kafka Bot Runner
| File | What it does |
|---|---|
| `src/kafka.ts` | KafkaJS client, `ensureBotTopics()`, `getProducer()`, `startBotConsumers()`, `callBot()` |
| `src/temporal/activities.ts` | Added `dispatchToBotInbox(botInboxName, prompt)` — Kafka dispatch, `dispatchToBot()` untouched |
| `src/index.ts` | Wires `loadBotRegistry()`, `ensureBotTopics()`, `startBotConsumers()` on startup |

**Two dispatch functions — critical design decision:**
- `dispatchToBot(channelId, prompt)` — UNCHANGED. Direct SDK call, Slack transport.
- `dispatchToBotInbox("betty.inbox", prompt)` — NEW. Kafka transport. Awaits `correlationId` on outbox.

### Phase 3 ✅ — Foreman UI
| File | What it does |
|---|---|
| `src/canvases.ts` | Canvas persistence to `~/.foreman/canvases.json` |
| `src/ui-api.ts` | Express routes: `/api/bots`, `/api/chat`, `/api/events` (SSE), `/api/canvas/:botName` CRUD, `/api/roster`, `POST/DELETE /api/roster/folders/*folderPath`, `POST /api/command` |
| `src/ui-claude.ts` | WebSocket Architect handler — Claude Agent SDK → browser. PreToolUse hooks for tool progress. Stats footer (cost/turns/elapsed). cwd = repo root. sessionId persisted under `ui:architect`. |
| `src/webhook.ts` | HTTP + WebSocket server on port 3001 |
| `src/mcp-canvas.ts` | SelfReboot allowed from `ui:architect` channel |
| `src/roster-overrides.ts` | Persists bot→folder overrides to `~/.foreman/roster-overrides.json` |
| `src/bots.ts` | `RosterNode`, `getRosterTree()`, real-time bot status SSE stream |
| `ui/` | Vite + React + Tailwind frontend (plain JS) |

**UI features live:**
- Bot Roster — left nav with recursive folder tree, drag-and-drop, folder creation/deletion
- Bot status indicators — 🟢🟡🔴 via SSE stream
- Architect chat — WebSocket streaming, tool approval cards, session memory across refreshes
- Tool progress — italic `_Reading path..._` lines before each response (via PreToolUse hooks)
- Stats footer — `Done in N turns | $X.XXXX | Xs` after each response
- Message timestamps
- Auto-reconnect — exponential backoff (1s→2s→4s→8s→15s max) + "Reboot successful" message
- Bot chat — HTTP chat with any bot via Kafka
- Canvas tabs — per-bot canvas persistence
- `/f` commands — `/f session`, `/f model`, `/f name`, `/f auto-approve`, `/f new`, `/f stop`

**How to start:**
```bash
# Terminal 1 — Foreman backend (port 3001)
cd /Users/chris.shreve/claude-slack-bridge
npm run build && node dist/index.js

# Terminal 2 — Vite dev server (port 5173)
cd /Users/chris.shreve/claude-slack-bridge
npm run ui
```

---

## Known Gotchas

### ESM/CJS (incident 2026-04-03)
KafkaJS named imports crash at runtime in ESM. Always use default import + destructure:
```typescript
import kafkajs, { type Producer, type Admin } from 'kafkajs';
const { Kafka, logLevel, CompressionTypes, CompressionCodecs } = kafkajs;
```

### PreToolUse hooks vs canUseTool
`~/.claude/settings.local.json` pre-approves Bash/Read/Edit/Write/Glob/Grep etc. at the settings level. The SDK bypasses `canUseTool` for pre-approved tools. **Always use `PreToolUse` hooks for progress notifications**, not `canUseTool`. `canUseTool` is only for tools NOT in the settings allow list.

### Express 5 wildcards
Express 5 uses `path-to-regexp` v8 — bare `*` wildcards are invalid. Use named wildcards: `/*folderPath`.

### Socket Mode WebSocket instability
If Foreman stops responding to every other Slack message, check `~/.foreman/foreman.err.log` for `pong wasn't received` errors. This means the Socket Mode WS to Slack keeps dropping. Fix: `SelfReboot` (no code change needed, just a fresh connection).

---

## Emergency Recovery — If Foreman Won't Start

See [dead_man_protocol.md](dead_man_protocol.md) — Recovery Protocol section for full copy-paste-ready steps.

---

## Phase 4 ✅ — Workspaces

| Feature | Status |
|---|---|
| Backend foundation (`/api/workspaces`) | ✅ |
| LeftNav three-section model (System / Bots / Workspaces) | ✅ |
| Canvas from disk (workspace files as tabs) | ✅ |
| Workspace bots via Kafka (namespaced topics) | ✅ |
| Persistent outbox consumer (correlation ID routing) | ✅ |
| Stateful bot sessions (per-bot conversation history) | ✅ |
| Resizable LeftNav with drag handle | ✅ |
| Bot status dots for workspace bots | ✅ |
| LeftNav polish (System/Bots/Workspaces labels, console links) | ✅ |
| Instant scroll on bot switch | ✅ |

---

## Phase 5 ✅ — Mattermost Bridge (replaces custom React UI)

**Decision (2026-04-07):** Instead of building a custom conversation layer (Kafka log topics + pagination API), we adopted Mattermost — it provides channels, persistent history, pagination, search, threads, reactions, and a polished UI out of the box.

### What's live
| Component | Status |
|---|---|
| Mattermost + PostgreSQL in docker-compose | ✅ Running at `localhost:8065` |
| 6 bot accounts (architect, betty, clive, gemini-worker, gpt-worker, claude-judge) | ✅ Created with tokens |
| `src/mattermost.ts` — WebSocket bridge (1:1 port of slack.ts) | ✅ |
| Message handling (user → Claude → response) | ✅ |
| /cc commands (cwd, model, name, session, new, stop, auto-approve, plugin) | ✅ |
| Tool approval via interactive message buttons | ✅ |
| Wired into index.ts startup | ✅ |

### Architecture
- Mattermost Team Edition (MIT license, self-hosted, Docker)
- `platform: linux/amd64` in docker-compose for Apple Silicon (Rosetta emulation)
- Raw `fetch` + `ws` for API calls (no @mattermost/client SDK — CJS/browser issues)
- Admin token on WebSocket receives all events; bot-specific tokens post responses
- Slack bridge runs in parallel — both transports work simultaneously

### Still TODO
- [x] **Verify FlowSpec workflows still run** — confirmed end-to-end in Mattermost (hello-world.flow + peer-review.flow)
- [x] **Migrate memory files into Foreman** — done (2026-04-08), now in `docs/memory/`
- [ ] **Message chunking for Mattermost** — `postMessage()` must split messages that exceed Mattermost's max post size (16,383 chars). Pythia Phase 2 (synthesis) and the collator (detailed report) routinely exceed this. Temporal activity `dispatchToBot` fails with 400 `message_length` error.
- [ ] Port canvas commands to Mattermost
- [ ] Port quorum/delphi/dispatch commands
- [ ] MCP tools (PostMessage, ReadChannel) — add Mattermost variants
- [ ] Remove custom React UI once Mattermost is fully proven

### Completed ✅
- [x] Approve/Deny callback — `host.docker.internal` + `AllowedUntrustedInternalConnections` working; confirmed end-to-end with auto-approve off
- [x] `/f` slash command rename + auto-registration — commit `9444e66`
- [x] Wire direct bot routing (Betty, Clive, etc.) — own persona + token per channel
- [x] 🤔 reaction + typing indicator with bot tokens
- [x] Tool progress detail (Bash command, Edit/Write paths)
- [x] Remove ✅ reaction

### Conversation Layer Design (preserved for Kafka log topics)
The original design for persistent conversations via Kafka log topics is saved in [project_conversation_layer.md](project_conversation_layer.md). Now that Mattermost handles conversation storage, the `{bot}.log` topic concept may still be useful for cross-platform replay (e.g., replaying a Mattermost conversation in a different context).

---

## Phase 6 — Planned (future)

### `/f reload-bots` — Hot-Reload Bot Registry
Add a `/f reload-bots` command that re-reads `bots.yaml` and rebuilds the in-memory bot registry without restarting Foreman. Removes the need to reboot just to add/remove/modify a bot definition.

### MCP Toolbelt Decomposition
Break the monolithic `foreman-toolbelt` (38 tools in `mcp-canvas.ts`) into domain-specific MCP servers:
- **`foreman-canvas`** — CanvasList, CanvasRead, CanvasFindSection, CanvasCreate, CanvasAppend, CanvasDelete, CanvasReadById, CanvasUpdateElementById, CanvasDeleteElementById
- **`foreman-jira`** — JiraCreateTicket, JiraUpdateTicket, JiraDeleteTicket, JiraReadTicket, JiraSearch, JiraAddComment, JiraUpdateComment, JiraDeleteComment, JiraTransitionTicket, JiraAssignTicket, JiraGetTransitions, JiraGetFieldOptions, JiraSetField
- **`foreman-confluence`** — ConfluenceReadPage, ConfluenceSearch, ConfluenceCreatePage, ConfluenceUpdatePage
- **`foreman-github`** — GitHubCreatePR, GitHubReadPR, GitHubReadIssue, GitHubSearch, GitHubListPRs
- **`foreman-comms`** — PostMessage, GetCurrentChannel, ReadChannel
- **`foreman-infra`** — SelfReboot, TriggerBitrise, LaunchApp, DiagramCreate

**Why:** (1) Per-bot tool scoping — assign only relevant toolbelts to each bot via `bots.yaml`. (2) Avoid tool collision — when a repo's `.claude/settings.json` brings in the official Atlassian MCP, Foreman's Jira tools overlap with identical functionality. Domain separation lets you exclude `foreman-jira` for bots that already have the official MCP. (3) Reduce token noise — fewer tools in the system prompt means faster, cheaper, more focused responses.

**Approach:** Extract each domain from `mcp-canvas.ts` into its own file (`mcp-jira.ts`, `mcp-confluence.ts`, etc.), each exporting a `createXxxMcpServer()` function. Update `mcp-canvas.ts` to compose them. Wire per-bot toolbelt selection through `bots.yaml` config.

### ✅ Consolidate Bot Registry & Channel Routing (Done 2026-04-09)
Moved `~/.foreman/bots.json` → `config/channel-registry.yaml`. Updated `flowspec/registry.ts` to read from the new file. Transport-grouped YAML, visible, version-controlled. Old `~/.foreman/bots.json` still exists but is no longer read — safe to delete.

### ✅ FlowSpec Tutorial (Done 2026-04-09)
Created `flows/flowspec-tutorial.flow` — 7 progressive lessons (Hello World → Quality Loop). Added "Adding a Bot to a FlowSpec Workflow" 5-step guide to CLAUDE.md. All tutorials tested and passing.

### Dynamic Bot Resolution (No-Reboot Bot Management)
Currently `mattermost.ts` builds a static `botUserMap` at startup from Mattermost bot accounts + `mattermostBotTokens` in config. Adding a new bot requires creating a Mattermost bot account, adding its token to config, AND restarting Foreman.

**Goal:** Adding a new bot to a workflow should never require a Foreman reboot. Resolve bot config dynamically from `channel-registry.yaml` → `bots.yaml` instead of from the startup cache.

**Why this is hard today:** `identifyChannelBot()` matches channel members against `botUserMap` (keyed by Mattermost user ID). This means each bot identity needs its own Mattermost bot account. The Foreman bot can't serve as multiple identities because it always resolves to one config.

**Possible approach:** Flip the lookup — instead of "which bot user is in this channel?", do "which bot name does this channel map to?" by reversing `channel-registry.yaml` at startup into a `channelId → botName` map. Then look up the bot definition from `bots.yaml`. This removes the need for per-bot Mattermost accounts entirely — one Foreman bot account could serve all channels with different personas.

### Provision-Time Channel Config (Model + Auto-Approve)
`/f provision` currently creates channels and registers them, but channel runtime settings (model, auto-approve, etc.) must be configured manually afterward. Extend provisioning to declare per-channel config so workflows are ready to run hands-free.

**Possible locations for the config:** per-workspace config file (e.g. `workspaces/techops-2187/channels.yaml`), or inline in the `.flow` file itself, or in `bots.yaml`. Workspace level is likely best since the same bot may need different settings in different workflows.

**Minimum viable:** model + auto-approve per channel. Could later extend to timeouts, tool scoping, etc.

### Other
- **Mobile access via tunnel** — expose Mattermost to phone via ngrok, Tailscale, or Cloudflare Tunnel so the Mattermost iOS app can connect (replaces custom mobile layout idea)
- **Ollama adapter** — local open source LLMs (Llama 3, Mistral, etc.) as bots in `bots.yaml`
- **Dockerize Temporal** — add to docker-compose.yml
- **Dockerize everything** — single `docker compose up` for full stack
- **Image attachment in chat**
- **FlowSpec workspace-aware bot namespace resolution** — `@claude-worker` resolves to `techops-2187/claude-worker` when run inside a workspace
- **Enhance `/f session tools`** — list all available tools grouped by source (foreman toolbelts, project MCPs, Claude Code built-ins, plugins)
