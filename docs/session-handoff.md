# Session Handoff — 2026-04-04 (reboot 4 — PreToolUse hook fix)

## What we were working on
Debugging why `tool_progress` WS events are not appearing in the Foreman UI chat.

## Root cause found
`~/.claude/settings.local.json` pre-approves Bash, Read, Edit, Write, Glob, Grep etc. at the settings level. The SDK sees these and bypasses `canUseTool` entirely — that's why debug logs never appeared. `canUseTool` is only called for tools NOT already in the settings allow list.

## Fix applied
Switched from `canUseTool` to `hooks: { PreToolUse: [...] }` in `src/ui-claude.ts`. PreToolUse hooks fire regardless of settings-level approval — same mechanism the Slack adapter uses for progress. Using wildcard matcher `'.*'` to catch all tools.

## Next steps after reboot
1. `curl http://localhost:3001/health`
2. Ask Architect in the UI to read a file — should see italic progress lines
3. If tool name shows as 'unknown', switch to explicit per-tool hooks (same as buildProgressHooks in AnthropicAdapter.ts)

## Last known good commit
`8936468`

## Rollback
```bash
cd /Users/chris.shreve/claude-slack-bridge
git checkout 8936468 -- src/ui-claude.ts
npm run build
```
