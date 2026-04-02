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
- [ ] Kafka consumer loop in Foreman — one consumer per bot in `bots.yaml`
- [ ] Each consumer: reads from `{name}.inbox` → calls correct SDK adapter → produces to `{name}.outbox`
- [ ] Per-bot mutex → Kafka consumer group semantics

**Key design decision:** `dispatchToBot()` is **unchanged**. A new parallel function `dispatchToBotInbox(botInboxName, prompt)` handles Kafka dispatch explicitly. Callers opt in — no regression risk.

- `dispatchToBot(channelId, prompt)` — direct SDK call, Slack transport, today's behavior
- `dispatchToBotInbox("betty.inbox", prompt)` — produces to Kafka inbox, awaits `correlationId` on outbox

**Done when:** A Temporal workflow can call `dispatchToBotInbox("betty.inbox", prompt)` and receive a response. Slack still works in parallel — no regression.

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
