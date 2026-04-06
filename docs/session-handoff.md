# Session Handoff — 2026-04-06 (reboot 13 — workspace bots via Kafka)

## What we were working on
Building Phase 4 workspaces — Step 4: Workspace bots wired through Kafka.

## What was done
- Steps 1-3 complete and committed (backend APIs, LeftNav, canvas from disk)
- Added `registerWorkspaceBots()` in `bots.ts` — reads workspace.yaml files and registers bots into global registry with namespaced names (e.g. `getting-started/helper`)
- Called `registerWorkspaceBots()` at startup in `index.ts` before `ensureBotTopics()`
- Removed "coming soon" guard in `App.jsx` — workspace bots now route through `/api/chat` → `callBotByName()` → Kafka

## Key design decision
ALL bot traffic must flow through Kafka/Redpanda — no direct LLM API calls from the UI/API layer. This gives universal observability, persistence, and replay capability. Saved as feedback memory.

## Next steps after reboot
1. Verify: click `helper` bot in Getting Started workspace, send a message, confirm it responds
2. Check Redpanda Console for `getting-started/helper.inbox` / `.outbox` topics
3. Commit and push Step 4
4. Remaining Phase 4: image attachment, mobile layout, Ollama adapter, Dockerize Temporal
