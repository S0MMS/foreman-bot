# Session Handoff — 2026-04-04 (reboot 6 — bot status indicators)

## What we were working on
Adding real-time bot status indicators (green/yellow/gray dots) to the LeftNav roster.

## What was built
- `src/bot-status.ts` (NEW) — in-memory status tracking with change event listeners
- `src/kafka.ts` — `setBotStatus()` calls in consumer loop: online on connect, busy while processing, offline on crash
- `src/ui-api.ts` — `GET /api/bots/status` (snapshot) + `GET /api/bots/status/stream` (SSE)
- `ui/src/App.jsx` — SSE subscription for bot statuses, passes to LeftNav
- `ui/src/components/LeftNav.jsx` — colored dots replace emoji icons

## Why the reboot is needed
The Kafka consumer loop in the running process doesn't have the `setBotStatus()` calls — it's running old compiled JS. Bots show gray (offline) even though Redpanda is up and bots work via HTTP.

## Expected result after reboot
Bot dots should turn green once Kafka consumers connect. When a bot processes a message, dot goes yellow briefly, then back to green.

## Next steps after reboot
1. `curl http://localhost:3001/health`
2. Check LeftNav — bots should show green dots
3. Chat with a bot — dot should flash yellow then return to green
4. Commit + push all bot status indicator changes

## Last known good commit
`384405e` feat: Foreman UI — message timestamps + stats footer alignment

## Rollback
```bash
cd /Users/chris.shreve/claude-slack-bridge
git checkout 384405e -- src/kafka.ts src/ui-api.ts ui/src/App.jsx ui/src/components/LeftNav.jsx
rm src/bot-status.ts
npm run build
```
