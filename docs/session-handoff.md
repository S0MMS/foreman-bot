# Session Handoff — 2026-04-10 (Single-Bot Channel Routing)

## What we were working on
Making Foreman distributable. Prerequisite: switch from per-bot Mattermost accounts to one foreman bot serving all channels via channel-registry.yaml routing.

## What was done
1. Replaced `botUserMap` (user-ID-based routing) with `channelBotMap` (channel-registry-based routing) in `src/mattermost.ts`
2. `identifyChannelBot()` is now a synchronous map lookup instead of an async API call
3. `buildChannelBotMap()` reads channel-registry.yaml at startup and maps channelId → BotConfig
4. Added `MM_FOREMAN_USER_ID` discovery at startup for reactions/typing
5. All channels use the single foreman bot token (`MM_FOREMAN_TOKEN`)
6. Build passes, smoke test passes

## Where we left off
About to reboot Foreman to test the new routing.

## Rollback
```bash
git checkout 1051261 -- src/mattermost.ts
npm run build
# Then reboot Foreman
```

## Next steps after reboot
1. Verify Foreman responds in existing channels (flowbot-01, etc.)
2. Verify DM with Architect still works
3. If pass: commit, then start building bootstrap script + bot definitions
