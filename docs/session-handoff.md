# Session Handoff — 2026-04-07 (reboot 31 — bot reactions use bot token)

## What We Changed
🤔 reaction wasn't appearing in Betty's DM channel because the Architect bot isn't a member of those channels and can't add reactions there. Fix:
- Added `userId` field to `BotConfig`
- Moved `identifyChannelBot()` call BEFORE the reaction code
- Bot channels now use the bot's own `userId` + `token` for 🤔 reaction and typing indicator
- Architect channels continue using `MM_ARCHITECT_USER_ID` + `MM_ARCHITECT_TOKEN` (unchanged)

## What's Working
- Betty, Clive, claude-judge all respond in their DM channels
- Architect responds in DMs to the admin user
- 🤔 reaction should now appear in bot channels too (pending this reboot)
- Reboot notification works
- docker-compose has `extra_hosts: host.docker.internal:host-gateway`

## Still TODO
- `/f` command rename + slash command auto-registration (was mid-edit when session cut off twice)
- Action button callback investigation
- FlowSpec verification
- Commit all pending changes

## Files Changed Since Last Commit (f1c780c)
- `src/claude.ts` — systemPromptOverride param
- `src/mattermost.ts` — bot routing, BotConfig.userId, bot reactions
