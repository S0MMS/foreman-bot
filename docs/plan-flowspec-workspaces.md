# FlowSpec Workspace Architecture — Implementation Plan

## Goal
Make Mattermost FlowSpec work exactly like Slack: one bot, team channels, per-channel session config, sidebar categories for visual organization. No per-bot token routing, no silent defaults.

---

## Phase 1: Foreman Bot Infrastructure
> Get the `foreman` bot wired up and posting to channels.

- [ ] **1.1** Add `foreman` token to `~/.foreman/config.json` under `mattermostBotTokens`
- [ ] **1.2** Add `foreman` bot to `botUserIds` filter set on startup (so its messages are ignored by the WebSocket handler)
- [ ] **1.3** Store `foreman` token as `MM_FOREMAN_TOKEN` in `mattermost.ts` — the single token for all FlowSpec activity
- [ ] **1.4** Add `foreman` bot as member of `claude-worker` and `claude-judge` channels
- [ ] **1.5** Verify: `foreman` bot can post to both channels using its token

## Phase 2: FlowSpec Uses Foreman Token
> Replace all per-bot token routing in FlowSpec with the single foreman token.

- [ ] **2.1** Update `processChannelMessageForFlowSpec` — use `MM_FOREMAN_TOKEN` directly instead of `identifyChannelBotOrThrow`
- [ ] **2.2** Update `postStatusMessage` — use `MM_FOREMAN_TOKEN` for all `mm:` channels
- [ ] **2.3** Update `processChannelMessage` — when called from FlowSpec path, thread `MM_FOREMAN_TOKEN` as `botToken` through all closures (`onProgress`, `onApprovalNeeded`, response posting)
- [ ] **2.4** Remove `identifyChannelBotOrThrow` and `postMessageAsChannelBot` (no longer needed for FlowSpec)
- [ ] **2.5** Build + verify clean compile

## Phase 3: Workspace Bot Registry
> Replace flat `bots.json` with workspace-scoped registry for Mattermost.

- [ ] **3.1** Design workspace config format (JSON or YAML) — maps workspace name to channels, system prompts, models
- [ ] **3.2** Update `bots.json` with Mattermost channel IDs for `claude-worker` and `claude-judge`
- [ ] **3.3** Update `resolveBot` — when transport is `mm`, look up channels from workspace registry
- [ ] **3.4** Update `/f run` — resolve workspace context (which workspace am I in?)
- [ ] **3.5** Per-channel session config: system prompt + model come from workspace definition, not `bots.yaml`

## Phase 4: `/f workspace` Command
> Automate workspace creation from Mattermost.

- [ ] **4.1** `/f workspace create <name> <channel1> <channel2> ...` — creates Mattermost channels, adds foreman bot, creates sidebar category
- [ ] **4.2** `/f workspace list` — show all workspaces
- [ ] **4.3** `/f workspace use <name>` — set active workspace for current session
- [ ] **4.4** `/f workspace info` — show channels, models, system prompts for active workspace

## Phase 5: End-to-End Test
> Run hello-world.flow through Mattermost workspaces.

- [ ] **5.1** Create TECHOPS-2187 workspace with `claude-worker` + `claude-judge` channels
- [ ] **5.2** Write a `.flow` file using `@claude-worker` and `@claude-judge`
- [ ] **5.3** Run via `/f run` from a TECHOPS-2187 channel
- [ ] **5.4** Verify: foreman bot posts all activity, correct models used, results appear in correct channels

---

## Architecture

```
User types /f run workflow.flow
        |
        v
  +-------------+
  |  Workspace   |  <-- resolves @bot-name to channel ID
  |  Registry    |  <-- provides system prompt + model per channel
  +------+------+
         |
         v
  +-------------+
  |  Temporal    |  <-- orchestrates workflow steps
  |  Workflow    |
  +------+------+
         |
         v
  +-------------+
  | Foreman Bot  |  <-- ONE token, posts to ALL channels
  | (mm token)   |  <-- dispatch headers, progress, responses
  +------+------+
         |
    +----+----+
    v         v
 #claude-  #claude-     <-- team channels (sidebar category)
  worker    judge        <-- each has own Claude session
 (sonnet)  (opus)        <-- model + prompt from workspace config
```

## Current State
- Foreman bot created in Mattermost (user_id: `a4x367t6hpr178pnyegwh7mxer`, token: `3xiqeqatjtr8jq6cowdx9sr5xw`)
- TECHOPS-2187 category exists with `claude-worker` + `claude-judge` channels
- Betty/Clive persona bots remain for DM conversations (no changes)
