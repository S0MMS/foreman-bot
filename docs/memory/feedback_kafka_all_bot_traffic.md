---
name: All Bot Traffic Through Kafka
description: Every bot conversation must flow through Kafka/Redpanda — no direct API calls to LLM providers from the UI or API layer
type: feedback
---

ALL bot communication must go through Kafka/Redpanda — no direct LLM API calls from ui-api.ts or the frontend.

**Why:** Kafka gives universal observability (Redpanda Console), persistence (every message saved), and replay capability (re-run conversations for debugging or regression testing). A single transport layer means producers (UI, Slack, Temporal, other bots) don't need to know what provider a bot uses.

**How to apply:** When wiring up new bot types (workspace bots, new adapters), always route through Kafka topics (`{name}.inbox` / `{name}.outbox`). The `/api/chat` endpoint should produce to inbox and consume from outbox — never call LLM APIs directly. This applies to workspace bots too: register their Kafka topics on workspace load, start consumers, and use the same `callBotByName()` path as global bots.
