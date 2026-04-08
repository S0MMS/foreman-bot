---
name: SDK Update 2026-03-25
description: Completed update of @anthropic-ai/claude-agent-sdk from 0.2.70 to 0.2.83
type: project
---

## Status
Done — SDK updated to 0.2.83. The `delete process.env.CLAUDECODE` workaround in `src/index.ts` is still in place (not yet confirmed unnecessary).

## What
Updating `@anthropic-ai/claude-agent-sdk` from `0.2.70` → `0.2.83` in `/Users/chris.shreve/claude-slack-bridge`.

## Why
- 13 patch versions behind
- Incident on 2026-03-25: CLI v2.1.83 added anti-nesting guard (`CLAUDECODE=1` check). SDK v0.2.70 doesn't pass `--team-name` bypass. Workaround added: `delete process.env.CLAUDECODE` in `src/index.ts`.
- SDK 0.2.83 may resolve this mismatch properly, making the workaround unnecessary.

## Steps
1. `npm install @anthropic-ai/claude-agent-sdk@0.2.83`
2. `npm run build` — verify no TypeScript errors
3. Check if `delete process.env.CLAUDECODE` in `src/index.ts` is still needed
4. Rebuild and reboot Foreman

## If something breaks
- Rollback: `npm install @anthropic-ai/claude-agent-sdk@0.2.70`
- Rebuild: `npm run build`
- Reboot Foreman via launchd: `launchctl kickstart -k gui/$(id -u)/com.foreman.bot`
- The `CLAUDECODE` workaround must stay in `src/index.ts` until confirmed unnecessary

## Incident reference
See `INCIDENT-2026-03-25.md` in `/Users/chris.shreve/claude-slack-bridge/` for full context.
