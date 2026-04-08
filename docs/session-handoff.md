# Session Handoff — 2026-04-08 (Foreman bot + FLOWSPEC-101 workspace)

## What Changed

### Architecture: Single foreman bot for all FlowSpec posting
- Created `foreman` Mattermost bot (user_id: `a4x367t6hpr178pnyegwh7mxer`)
- Token stored as `MM_FOREMAN_TOKEN` in `mattermost.ts`, loaded from `config.json`
- `getForemanToken()` exported — throws if not configured
- `processChannelMessageForFlowSpec` uses foreman token exclusively via synthetic `BotConfig`
- `postStatusMessage` uses foreman token exclusively
- All closures (`onProgress`, `onApprovalNeeded`) thread `botToken` explicitly — no defaults anywhere

### FLOWSPEC-101 workspace
- Sidebar category: `FLOWSPEC-101` (id: `i1x6p9f76by8fgn469e1pmztdc`)
- `FlowSpec Engineer` channel (id: `obxixf4pzifg3e7g1jozs5wgya`) — where user types `/f run`
- `flowbot-01` channel (id: `w3fkpfdzd38z5fkei3sdabnhyo`)
- `flowbot-02` channel (id: `witk91ucbjgh58buud53s6w83o`)
- Foreman bot is a member of all three

### Files modified
- `src/mattermost.ts`: `MM_FOREMAN_TOKEN`, `getForemanToken()`, rewrote FlowSpec functions, threaded botToken through closures, removed `identifyChannelBotOrThrow`/`postMessageAsChannelBot`
- `src/temporal/activities.ts`: `postStatus` uses `postStatusMessage`, `resetBotSession` strips `mm:` prefix, `dispatchToBot` routes `mm:` to Mattermost
- `src/flowspec/runtime.ts`: `resolveBot` accepts optional `transport` param
- `src/flowspec/compiler.ts`: `getTransport()` helper, passed to `resolveBot` in `executeAsk`/`executeSend`
- `~/.foreman/config.json`: added `foreman` token to `mattermostBotTokens`
- `~/.foreman/bots.json`: `mm:flowbot-01` and `mm:flowbot-02` point to team channels (not DMs)

## What To Test
1. Go to `FlowSpec Engineer` channel in Mattermost
2. Type `/f run hello-world.flow`
3. Watch `flowbot-01` — foreman bot posts dispatch header, Claude writes a haiku
4. Watch `flowbot-02` — foreman bot posts the haiku (send step)
5. `FlowSpec Engineer` gets status messages

## Architecture (for future sessions)
```
/f run → reportChannelId = mm:${channel}
       → resolveBot("flowbot-01", transport="mm") → "mm:w3fkpfdzd38z5fkei3sdabnhyo"
       → dispatchToBot("mm:w3fk...") → processChannelMessageForFlowSpec("w3fk...", prompt)
         → uses MM_FOREMAN_TOKEN for ALL posting
       → postStatus("mm:obxi...") → postStatusMessage("obxi...", text)
         → uses MM_FOREMAN_TOKEN
```

## Plan (docs/plan-flowspec-workspaces.md)
- Phase 1: COMPLETE (foreman bot, channels, category)
- Phase 2: COMPLETE (FlowSpec uses foreman token exclusively)
- Phase 3: Workspace bot registry (scoped config, per-channel system prompt + model)
- Phase 4: `/f workspace` command
- Phase 5: End-to-end test
