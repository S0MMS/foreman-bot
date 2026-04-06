# Session Handoff — 2026-04-06

## Current State
Foreman 2.0 Phase 4 Workspaces — all major pieces working and verified.

## What was built this session
1. **Workspace backend** (`src/workspaces.ts`) — CRUD APIs, slugify, path traversal protection
2. **LeftNav three-section model** — Architect, Bots, Workspaces with collapsible workspace items
3. **Canvas from disk** — workspace files render as tabs (markdown, code, csv, mermaid)
4. **Workspace bots via Kafka** — `registerWorkspaceBots()` registers workspace bots with namespaced names, Kafka topics auto-created
5. **Resizable LeftNav** — drag handle on right edge, 160-480px range
6. **Kafka topic name fix** — replaced `/` with `.` in topic names (Kafka rejects `/`)
7. **Persistent outbox consumer** — fixed race condition where per-request consumers missed responses
8. **Bot status dots** — workspace bots now show live online/busy/offline status
9. **TECHOPS-2187 workspace** — 5 bots (claude-worker, gemini-worker, gpt-worker, claude-judge, coordinator) + flow file + results

## Key design decision
ALL bot traffic flows through Kafka/Redpanda. No direct LLM API calls from the API layer. Saved as feedback memory (`feedback_kafka_all_bot_traffic.md`).

## Verified working
- Workspace bot chat routed through Kafka (produce→inbox, consumer→LLM→outbox, persistent outbox consumer→response)
- Bot dots turn yellow (busy) during processing, green (online) when done
- Messages visible in Redpanda Console

## Uncommitted changes
- `src/kafka.ts` — persistent outbox consumer, callBotByName via Kafka
- `src/bots.ts` — registerWorkspaceBots, Kafka topic name fix
- `src/index.ts` — startOutboxConsumer at startup
- `ui/src/components/LeftNav.jsx` — workspace bot status dots, resizable width
- `workspaces/techops-2187/` — new workspace with 5 bots and files

## Next steps
- Commit and push all pending changes
- FlowSpec workspace-aware bot namespace resolution (`@claude-worker` → `techops-2187/claude-worker` when run inside workspace)
- Remaining Phase 4: image attachment, mobile layout, Ollama adapter, Dockerize Temporal
