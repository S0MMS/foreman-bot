# Session Handoff — 2026-04-13 (Pre-reboot #2)

## What we were doing

Configuring the durable Mattermost Architect DM. Discovered that all sessions default to
`/Users/chris.shreve` as cwd (from `process.cwd()`), which means CLAUDE.md doesn't auto-load.
Added `"defaultCwd": "/Users/chris.shreve/claude-slack-bridge"` to `~/.foreman/config.json`
to fix this for all sessions going forward, including any DM with the Foreman bot.

## What was changed

`~/.foreman/config.json` only — no source code changes, no build needed.

## Context on the Mattermost Architect

The durable Mattermost Architect is:
- A DM between Chris and the **Foreman bot** account in Mattermost
- NOT registered in `channel-registry.yaml` or `bots.yaml` (immune to config corruption)
- `isDM = true` → SelfReboot works
- After this reboot, new sessions in that DM will start with cwd = repo root → CLAUDE.md auto-loaded

Chris still needs to:
1. Open a DM with the Foreman bot in Mattermost (if not already done)
2. Send any message — the session will start fresh with the correct cwd

## After reboot — verify

1. Send a message in the Mattermost DM with Foreman bot
2. Send `/f session` — confirm `Working dir: /Users/chris.shreve/claude-slack-bridge`
3. Confirm Slack and Mattermost channels still respond normally

## Open questions / next steps

None — this is a clean config-only change.
