# Session Handoff — 2026-04-07 (reboot 18 — Mattermost bridge)

## What we were working on
Mattermost integration — replacing the custom React UI with Mattermost as the conversation platform.

## Decisions made
- Mattermost replaces the custom React UI entirely (option #1)
- 1:1 Slack → Mattermost swap first, then wire Kafka back in
- Using raw fetch + ws instead of @mattermost/client SDK (CJS/browser issues)
- Conversation layer design: Kafka log topics + conversation IDs independent of participants
- Mattermost runs via Docker (team-edition with platform: linux/amd64 for Apple Silicon)

## What's been built
- Mattermost + PostgreSQL in docker-compose.yml (running at localhost:8065)
- 7 bot accounts created (architect, betty, clive, gemini-worker, gpt-worker, claude-judge, test-double)
- All bots added to Foreman team + Town Square channel
- Bot tokens saved to ~/.foreman/config.json
- `src/mattermost.ts` — full bridge: WebSocket events, message processing, /cc commands, tool approval
- Wired into index.ts and webhook.ts

## Key principle (from Chris)
There is no such thing as a "Slack bot" or "Kafka bot." They are all just LLM SDK calls. The transport (Slack, Kafka, WebSocket) should not determine whether a bot has memory.

## Next steps after reboot
1. Test basic chat through Mattermost Town Square
2. Test /cc commands
3. Wire Kafka routing for non-Architect bots
4. Port remaining /cc commands (canvas, spec, implement, etc.)
