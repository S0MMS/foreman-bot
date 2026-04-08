---
name: Conversation Layer Design
description: SUPERSEDED by Mattermost (2026-04-07). Original Kafka log topic design preserved here for reference. Mattermost now provides channels, history, pagination natively.
type: project
---

# Conversation Layer — Original Design (SUPERSEDED)

**Status:** This design was superseded on 2026-04-07 when we adopted Mattermost as the conversation platform. Mattermost provides channels, persistent paginated history, multi-participant conversations, search, threads, and reactions natively — no custom build needed. The Kafka log topic concept below is preserved for potential future use (cross-platform replay, audit trails).

**Original problem:** The Foreman React UI stored all messages in React state (browser memory). Refresh = gone. No pagination, no multi-participant conversations, no persistence.

**How to apply:** This is the architectural blueprint for Phase 5. All implementation should follow this design. Do NOT add SQLite or any other database — Kafka is the conversation store.

## Design Decisions (agreed 2026-04-06)

1. **Kafka as conversation store** — all bot traffic already flows through Kafka (design principle). Don't duplicate into a second store. Kafka IS the source of truth.

2. **Three topic types per bot:**
   - `{bot}.inbox` — transport (user → bot routing)
   - `{bot}.outbox` — transport (bot → user routing)
   - `{bot}.log` — conversation log (append-only, all messages chronologically, tagged with conversationId)

3. **Conversation ID is independent of participants** — a conversation is its own entity. Participants join/leave without changing the ID. Supports 1:1, group, and workflow conversations. This is the Slack channel model.

4. **Message structure in log topics:**
   ```json
   {
     "conversationId": "conv_a7f3b2",
     "sender": "chris",
     "role": "user",
     "content": "...",
     "ts": 1712345678
   }
   ```

5. **UI becomes a thin viewer** — loads last N messages from API on bot switch, lazy-loads older on scroll up. Per-bot loading state, per-bot draft text.

6. **Future Mattermost integration** — once the conversation layer is solid, evaluate Mattermost for auth, permissions, search, threads, reactions, notifications. Build the thin abstraction now; adopt the platform later if needed.

## Open Questions
- How to handle Architect (WebSocket) conversations — do they also write to a log topic?
- Kafka retention policy for log topics (infinite? time-bounded?)
- How to bootstrap: migrate existing in-memory messages to log topics, or start fresh?
- Conversation creation UX — auto-create on first message? Explicit "new conversation" button?
