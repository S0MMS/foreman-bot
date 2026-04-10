# Foreman Session Handoff

*Use this doc to resume context in a fresh Claude Console session if Foreman goes down and can't restart itself.*

---

## How to Restart Foreman Manually

```bash
cd /Users/chris.shreve/claude-slack-bridge
npm run build
# Then restart the launchd service, or:
node dist/index.js
```

Config lives at `~/.foreman/config.json`. Sessions persist at `~/.foreman/sessions.json`.

---

## What Foreman Is

Foreman is a Claude Code instance running locally on a Mac, controllable via Slack. The bridge codebase lives at `/Users/chris.shreve/claude-slack-bridge`. Each Slack channel gets its own independent bot session with its own model, cwd, and conversation history.

---

## Docs Structure

All docs are in `/Users/chris.shreve/claude-slack-bridge/docs/`:

```
docs/
├── flowspec/
│   ├── flowspec.md              — full engineering spec (728 lines, NOT on Confluence)
│   ├── flowspec-reference.md    — AI onboarding version (IS on Confluence)
│   ├── flowspec-status.md       — implementation status
│   └── flowspec-fix-plan.md     — fix plan
├── pythia/
│   └── pythia-reference.md      — Pythia design + research (IS on Confluence)
├── foreman/
│   ├── ai-onboarding.md         — top-level AI onboarding summary (IS on Confluence)
│   ├── prototype-workflow.md    — multi-agent channel design doc
│   └── session-handoff.md       — this file
└── s3demo/
    ├── ai-transformation-overview.md
    └── resource-index.md
```

---

## Confluence Pages (MFP ENG Space)

Under parent page "AI Infrastructure Research":

| Page | Confluence Page ID | URL |
|------|--------------------|-----|
| Foreman, FlowSpec & Pythia — AI Onboarding Summary | `127963955247` | https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127963955247 |
| FlowSpec Language Reference | `127964381198` | https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127964381198 |
| Pythia: Multi-Model Verification Workflow | `127964217426` | https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127964217426 |

Parent page: https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127963332110

To push any local doc to Confluence: pass the raw `.md` file content directly as the `body` param to `ConfluenceUpdatePage`. No HTML, no macros.

---

## Editorial Rules for AI Onboarding Docs

1. Both FlowSpec and Pythia descriptions must open with: **"[X] was designed from the ground up by AI, for AI."** — before any description of what they do.
2. Use **"the dev"** not "Chris" in narrative descriptions. Only exception: the Authors header in `flowspec-reference.md` stays as "Chris Shreve."
3. Push to Confluence as **raw markdown only** — no HTML tags, no noformat macros.
4. `flowspec.md` (full engineering spec) is NOT on Confluence — it's local only. `flowspec-reference.md` is the published version.

---

## Current Status — Foreman 2.0 In Progress

### Infrastructure (complete ✅)
- **Docker Desktop** installed and running
- **Redpanda** running via `docker compose up` — broker at `localhost:19092`, Console UI at `localhost:8080`
- **Bot topics** auto-created on Foreman startup from `bots.yaml`: `betty.inbox/outbox`, `clive.inbox/outbox`, `gemini-worker.inbox/outbox`, `gpt-worker.inbox/outbox`, `claude-judge.inbox/outbox`
- **Temporal** still runs natively: `temporal server start-dev` (Homebrew, port 7233, UI at 8233)

### New files (committed and pushed)
- **`bots.yaml`** — bot registry, single source of truth for all bot identities
- **`src/bots.ts`** — YAML parser, bot registry, `getAllTopics()`, `getBot()`, etc.
- **`src/kafka.ts`** — KafkaJS singleton, `ensureBotTopics()`, `getProducer()`, `sendToBot()`
- **`docker-compose.yml`** — Redpanda only (Temporal NOT in Docker — runs natively)

### Canvas tools (complete ✅, committed and pushed)
Honest tool set — all fake operations removed:
- `CanvasCreate` — real create via `conversations.canvases.create`
- `CanvasAppend` — what old CanvasCreate actually did (insert_at_end)
- `CanvasRead` — returns raw HTML; element IDs (`id='temp:C:...'`) feed UpdateElementById/DeleteElementById
- `CanvasFindSection` — find section by text via `canvases.sections.lookup`, returns IDs
- `CanvasUpdateElementById` / `CanvasDeleteElementById` — surgical edits by raw element ID
- Removed: `CanvasUpdate` (fake whole-canvas replace), `CanvasUpdateSection`, `CanvasDeleteSection`

### activities.ts additions
- **`dispatchToBotInbox(botInboxName, prompt)`** — new Kafka-native dispatch function
  - Takes explicit inbox topic name (e.g. `"betty.inbox"`)
  - Produces to inbox, awaits matching `correlationId` response on outbox
  - `dispatchToBot()` is **completely unchanged** — no regression risk
  - Requires: Redpanda running + Kafka consumer loop (Phase 2, not yet built)

### TECHOPS-2187
- `pythia/results/techops-2187.csv` — 362 ObjC classes, 121 batches of 3, all `status=pending`
- `flows/techops-2187.flow` + batch/inventory variants — FlowSpec workflows

---

## Pending — Foreman 2.0 Phase 2

1. **Kafka consumer loop** — one consumer per bot in `bots.yaml`. Reads from `{name}.inbox`, calls SDK adapter, produces response to `{name}.outbox`. This is what makes `dispatchToBotInbox()` actually work end-to-end.
2. **Per-bot mutex → Kafka consumer group semantics**

## Pending — Foreman 2.0 Phase 3

- `foreman ui` — Vite + React + Tailwind + shadcn/ui web app
- WebSocket bridge tailing Kafka topics → browser
- Left nav: bots from `bots.yaml`, workflows from `flows/`
- Conversation view, send box, workflow launcher, tool approval UI

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/mcp-canvas.ts` | All MCP tools (Jira, Confluence, Canvas, Diagram, etc.) |
| `src/confluence.ts` | Confluence API integration |
| `src/jira.ts` | Jira API integration |
| `src/slack.ts` | All `/cc` commands and Slack event handlers |
| `src/claude.ts` | Claude Agent SDK integration |
| `src/session.ts` | Per-channel state management |
| `src/adapters/OpenAIAdapter.ts` | OpenAI/Gemini adapter + shared tool definitions |
| `~/.foreman/config.json` | Tokens, API keys, default cwd |
| `~/.foreman/sessions.json` | Persisted channel sessions |
| `~/.foreman/bots.json` | Bot name → Slack channel ID registry |
