# Session Handoff — 2026-04-12

## What we were working on
- Bot-owned channels now auto-initialize adapter + model from `bots.yaml` at startup
- Previously, all channels defaulted to `anthropic:claude-sonnet-4-6` regardless of the bot definition
- Fix: `buildChannelBotMap` in `mattermost.ts` now calls `setAdapter` + `setModel` for SDK bots

## Uncommitted changes
- `src/mattermost.ts` — auto-init adapter/model from bots.yaml in buildChannelBotMap

## Next steps
- Verify gemini/gpt channels work out of the box (no `/f model` needed)
- Commit and push
- User had more things to discuss
