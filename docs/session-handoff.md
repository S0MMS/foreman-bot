# Session Handoff — 2026-04-04

## What we were working on
Adding `/f` session control commands to the Foreman UI chat input.

## What was built
- `src/ui-api.ts` — `POST /api/command` handles: session, model, name, auto-approve, new
- `src/ui-claude.ts` — model read from session state; autoApprove flag checked; handles `stop` WS message
- `ui/src/App.jsx` — `/f` prefix intercepted before sending to agent; `/f stop` sends WS stop signal; others POST to `/api/command`
- `ui/src/components/MessageBubble.jsx` — `system` role renders as monospace gray centered box
- `CLAUDE.md` — memory system path + Dead Man Protocol documented
- `src/mcp-canvas.ts` — SelfReboot allowed from `ui:architect`

## Commands available in the UI
- `/f session` — show current model, name, auto-approve, sessionId
- `/f model <name>` — change model (supports aliases: sonnet, opus, haiku)
- `/f name <name>` — change Architect name
- `/f auto-approve on|off` — toggle tool auto-approval
- `/f new` — clear session (fresh conversation next message)
- `/f stop` — abort current running query

## Why we rebooted
`/api/command` route was returning HTML 404 — old process running without new code.

## Next steps after reboot
1. `curl http://localhost:3001/health`
2. Try `/f session` in the UI — should return a gray system message with session info
3. User mentioned a second UI tweak (not yet revealed)
4. Need to commit + push all Phase 3 work

## Last known good commit
`f84646b` feat: Foreman 2.0 Phase 3 — Foreman UI foundation

## Rollback
```bash
cd /Users/chris.shreve/claude-slack-bridge
git checkout f84646b -- src/ui-api.ts src/ui-claude.ts src/mcp-canvas.ts
npm run build
```
