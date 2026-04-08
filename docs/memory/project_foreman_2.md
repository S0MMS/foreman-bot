---
name: Foreman 2.0 Status
description: Current state of Foreman 2.0 — Kafka/Redpanda bot transport layer + Foreman UI. Read this if Foreman is broken or you need to resume this work.
type: project
---

# Foreman 2.0 — Current Status

**Why:** Add Kafka/Redpanda as bot-to-bot communication layer and a local web UI. Slack bridge stays intact — zero breaking changes.

**How to apply:** Read this before touching any Foreman 2.0 code. If Foreman won't start, go straight to Emergency Recovery below.

---

## Current Health: ✅ STABLE — FlowSpec /f run parsing fixed

**Last known good commit:** `c1411f4` (pre-parsing fix; new commit pending)
**Rollback:** `git checkout c1411f4 -- src/mattermost.ts && npm run build`

---

## Infrastructure State

- **Docker Desktop**: installed and running
- **Redpanda**: running via `docker compose up` in `/Users/chris.shreve/claude-slack-bridge`
  - Kafka broker: `localhost:19092`
  - Console UI: `http://localhost:8080`
- **Bot topics** auto-created on startup: `betty.inbox/outbox`, `clive.inbox/outbox`, `gemini-worker.inbox/outbox`, `gpt-worker.inbox/outbox`, `claude-judge.inbox/outbox`, `test-double.inbox/outbox`
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

```bash
# 0. Stop launchd supervisor first
launchctl unload ~/Library/LaunchAgents/com.foreman.bot.plist

# 1. Kill anything on port 3001
lsof -ti :3001 | xargs kill -9

# 2. Revert to last known good
cd /Users/chris.shreve/claude-slack-bridge
git log --oneline -5
git checkout <commit> -- <files>

# 3. Rebuild and smoke test
npm run build
node dist/index.js   # confirm "Foreman is running" then Ctrl-C

# 4. Re-enable launchd
launchctl load ~/Library/LaunchAgents/com.foreman.bot.plist
```

**If Foreman starts but is unresponsive in Slack (hung tool call):**
Edit `~/.foreman/sessions.json`, set `sessionId: null` for the affected channel. Or `/cc new` in that channel.

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
| 7 bot accounts (architect, betty, clive, gemini-worker, gpt-worker, claude-judge, test-double) | ✅ Created with tokens |
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
- [ ] **Verify FlowSpec workflows still run** — confirm end-to-end after all the Mattermost refactoring
- [ ] **Migrate memory files into Foreman** — move `~/.claude/projects/.../memory/` into `claude-slack-bridge/docs/memory/`
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

- **Mobile-friendly layout** — collapsible sidebar, hamburger menu
- **Ollama adapter** — local open source LLMs (Llama 3, Mistral, etc.) as bots in `bots.yaml`
- **Dockerize Temporal** — add to docker-compose.yml
- **Dockerize everything** — single `docker compose up` for full stack
- **Image attachment in chat**
- **FlowSpec workspace-aware bot namespace resolution** — `@claude-worker` resolves to `techops-2187/claude-worker` when run inside a workspace
