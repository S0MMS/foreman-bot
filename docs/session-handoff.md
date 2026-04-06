# Session Handoff — 2026-04-06 (reboot 17 — stateful bot sessions)

## What we were working on
Bots communicated via Kafka were stateless — each call to callBot() sent only the system prompt and a single user message. No conversation history.

## What was done
- Added `botSessions` Map in kafka.ts — per-bot conversation history
- `callBot()` now pushes user message to history, calls LLM with full history, pushes assistant response
- Works for all providers: Anthropic (messages array), OpenAI (messages array), Gemini (startChat with history)
- History is in-memory (resets on reboot) — Kafka topics still persist everything for replay

## Key principle (from Chris)
There is no such thing as a "Slack bot" or "Kafka bot." They are all just LLM SDK calls. The transport (Slack, Kafka, WebSocket) should not determine whether a bot has memory. Session state lives in the session, not the pipe.

## Next steps after reboot
1. Chat with a TECHOPS-2187 bot, ask it something, then ask a follow-up referencing the first answer
2. Verify the bot remembers the prior conversation
3. Commit and push
