# Foreman — Design Document

## Overview

Control and interact with a Claude Code session from your phone via Slack. A Node.js bot running on your Mac connects to the Claude Agent SDK, relaying messages bidirectionally. This enables sending prompts, reading responses, approving/denying tool use, and managing sessions — all from the Slack app on your phone.

**Primary workflow: Message the bot in any channel or DM.** Each channel gets its own independent session. The bot's persona name comes from the channel name — put it in `#clive` and it's Clive. DMs default to "Foreman".

## Architecture

```
┌─────────────────────┐
│  You (Phone/Slack)   │
│  DM with Foreman     │
└──────────┬──────────┘
           │ type a message
           ▼
┌─────────────────────┐
│    Slack API         │
│    (Socket Mode)     │
└──────────┬──────────┘
           │ event received
           ▼
┌─────────────────────────────────────────┐
│  Bot (Node.js on your Mac)              │
│                                         │
│  slack.ts  ─→  claude.ts  ─→  query()   │
│     ▲              │                    │
│     │              ▼                    │
│     │      Claude Agent SDK             │
│     │      (spawns claude CLI)          │
│     │              │                    │
│     │              ├──→ Anthropic API   │
│     │              │    (cloud, costs   │
│     │              │     API tokens)    │
│     │              │                    │
│     │              ├──→ Local tools     │
│     │              │    (read/edit      │
│     │              │     files, bash,   │
│     │              │     search — free) │
│     │              │                    │
│     │              ▼                    │
│     │      result text                  │
│     │             │                     │
│     └─────────────┘                     │
│      format → chunk → post to Slack     │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────┐
│  You see the reply   │
│  in your DM          │
└─────────────────────┘
```

- **Slack App** uses Socket Mode — no public URL needed, runs entirely on your Mac
- **Free Slack workspace** for development (your own, full admin control)
- **DMs are the primary interface** — simple back-and-forth conversation
- **Channels also supported** — no @mention needed, useful for shared/visible sessions
- **Not connecting to an existing Claude instance** — each `query()` spawns a fresh Claude CLI process; session resume loads conversation history for context
- **Costs** come from Anthropic's API (same as running Claude Code in terminal); local tool execution is free

## Tech Stack

- **Runtime**: Node.js 18+ / TypeScript
- **Claude**: `@anthropic-ai/claude-agent-sdk`
- **Slack**: `@slack/bolt` (events, commands, interactive buttons via Socket Mode)
- **Auth**: `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`

## Project Structure

```
foreman/
├── package.json
├── tsconfig.json
├── .env                      # SLACK_BOT_TOKEN, SLACK_APP_TOKEN, ANTHROPIC_API_KEY
├── .env.example
├── .gitignore
├── src/
│   ├── index.ts              # Entry point — starts Bolt app
│   ├── slack.ts              # Slack event handlers (messages, button interactions)
│   ├── claude.ts             # Claude Agent SDK wrapper (query, resume, permissions)
│   ├── session.ts            # Session state management (per-channel, persisted to disk)
│   ├── config.ts             # Config file reading (~/.foreman/config.json)
│   ├── init.ts               # Setup wizard (tokens, launchd service)
│   ├── format.ts             # Markdown → Slack mrkdwn, message chunking
│   └── types.ts              # Shared TypeScript types
├── DESIGN.md                 # This file
└── README.md                 # Setup instructions
```

## Current Development Priority

### Load Claude Code Settings & Plugins

**Status: Implemented**

#### Path 1: Global & Project Settings (automatic)

`settingSources: ["user", "project"]` is passed to `query()`. This loads:
- `~/.claude/settings.json` (global user settings — installed plugins, MCP servers)
- `.claude/settings.json` in the project directory (project-level settings, CLAUDE.md)

Any plugins installed globally via Claude Code are automatically available through Foreman. Project-level settings load based on the current working directory (`/cc cwd`).

#### Path 2: Development Plugins (explicit, via `/cc plugin`)

For plugins under active development that aren't installed globally:

- `/cc plugin <name-or-path>` — load a plugin for the current session
- If the argument starts with `/`, it's treated as a full path
- Otherwise, it's resolved relative to the current working directory: `cwd + "/" + name`
- The full path is calculated and stored at invocation time — changing cwd later doesn't affect it
- Multiple plugins can be loaded (each `/cc plugin` call adds to the list)
- `/cc plugin` with no args lists currently loaded plugins
- `/cc new` clears all loaded plugins
- Uses the Agent SDK `plugins: [{ type: "local", path: "..." }]` option
- Plugins are passed on both new sessions and resumed sessions

Example workflow (relative name):
```
/cc cwd /Users/chris.shreve/ios-dev3/mfp-claude-plugins
/cc plugin morbius       → resolves to /Users/chris.shreve/ios-dev3/mfp-claude-plugins/morbius
/cc cwd /Users/chris.shreve/ios-dev2/mfp-ios
"migrate MyViewController to Swift"
```

Example workflow (full path, fewer commands):
```
/cc cwd /Users/chris.shreve/ios-dev2/mfp-ios
/cc plugin /Users/chris.shreve/ios-dev3/mfp-claude-plugins/morbius
"migrate MyViewController to Swift"
```

**Future enhancement:** If typing full paths proves painful, add a `~/.foreman/plugins/` directory with symlinks so `/cc plugin morbius` resolves automatically from any cwd.

## Implementation Status

Fully working. Bot connects via Socket Mode. DM and channel messaging both work. Session resume, tool approval buttons, and slash commands all functional.

### Bugs Fixed
- **Session resume failure**: `resumeSession()` was missing `cwd` and `systemPrompt` parameters, causing "process exited with code 1" on the second message.
- **`appendSystemPrompt` invalid**: Not a valid Agent SDK option. Fixed to use `systemPrompt: { type: "preset", preset: "claude_code", append: "..." }`.
- **Stale persisted sessions**: Sessions could become stale after bot restart, causing resume failures. Fixed with automatic fallback — if `resumeSession()` fails, Foreman clears the session and starts fresh transparently.

## How It Works

### Two Ways to Talk to the Bot

**DMs (recommended):**
- Open a direct message with the bot in Slack
- Just type — no @mention needed
- Simple, clean, phone-friendly experience
- Responses appear flat in the conversation (no threads)

**Channels:**
- Invite the bot to a channel
- Just type — no @mention needed (same as DMs)
- Each channel gets its own independent session
- Bot persona name defaults to the channel name
- Responses appear in threads
- Useful for shared/visible sessions

### Message Flow
1. You type a message (DM or @mention in channel)
2. Bot adds a 🤔 reaction (thinking indicator)
3. Bot sends prompt to Claude Agent SDK via `query()`
4. Claude works autonomously, auto-approving read-only tools
5. For mutating tools (Bash, Edit, Write), bot posts Approve/Deny buttons
6. You tap Approve or Deny on your phone
7. Claude continues or adjusts based on your decision
8. Bot posts Claude's final response
9. 🤔 reaction is replaced with ✅

### Session Management
- Sessions persist across messages — Claude retains context from prior exchanges
- Sessions are saved to disk (`~/.foreman/sessions.json`, multi-channel format) and survive bot restarts
- If a persisted session is stale, Foreman automatically falls back to a fresh session
- `/cc new` — clears the session (resets model, clears plugins), next message starts fresh
- `/cc cwd <path>` — sets the working directory
- `/cc model <name>` — set the Claude model (see Model Selection below)
- `/cc plugin <name-or-path>` — load a development plugin (see Plugins section)
- `/cc name <name>` — override the bot's persona name for this channel
- `/cc stop` — cancels the active query
- `/cc session` — show session info (model, cwd, plugins, status)
- `/cc reboot` — restart the Foreman process (launchd auto-restarts it)

### Model Selection

Default model is `claude-sonnet-4-6`. Change it with `/cc model`:

| Command | Model |
|---------|-------|
| `/cc model opus` | `claude-opus-4-6` |
| `/cc model sonnet` | `claude-sonnet-4-6` |
| `/cc model haiku` | `claude-haiku-4-5` |
| `/cc model claude-opus-4-6` | Full model IDs also work |
| `/cc model` | Show current model and aliases |

- Model persists across messages and bot restarts
- `/cc new` resets model back to Sonnet
- `/cc session` shows the active model
- The model is passed to the Agent SDK's `query()` via the `model` option

### Tool Approval Policy

| Tool | Auto-approve | Needs tap |
|------|:---:|:---:|
| Read, Glob, Grep | ✅ | |
| Edit, Write | | ✅ |
| Bash | | ✅ |
| Task (subagents) | ✅ | |
| WebFetch, WebSearch | ✅ | |

Configurable via `AUTO_APPROVE_TOOLS` set in `src/types.ts`.

### Approval Flow Detail

```
Claude needs tool approval
  → claude.ts: canUseTool creates a Promise, stores resolve fn in session state
  → claude.ts: calls onApprovalNeeded(toolName, input)
    → slack.ts: posts message with Approve/Deny buttons
      "🔧 Bash: `npm install express`  [Approve] [Deny]"
  → You tap Approve on phone
    → slack.ts: acks immediately, updates message to "✅ Approved"
    → slack.ts: resolves pending promise with { approved: true }
  → claude.ts: canUseTool returns { behavior: "allow" }
  → Claude proceeds
```

## Setup Steps (in order)

1. Create a Slack workspace (or use an existing one)
2. Create a Slack App at api.slack.com/apps > From scratch
3. Enable Socket Mode — generate App-Level Token (`xapp-`)
4. Add Bot Token Scopes: `chat:write`, `channels:history`, `channels:read`, `reactions:write`, `commands`, `im:history`, `im:write`
5. Enable Event Subscriptions — subscribe to `message.channels` and `message.im`
6. Enable Interactivity
7. Create Slash Command: `/cc`
8. Under App Home, check **Allow users to send Slash commands and messages from the messages tab**
9. Install App to Workspace — save Bot Token (`xoxb-`)
10. Create `.env` file with tokens and working directory
11. Run `npm run dev`
12. Open a DM with the bot and start chatting

## Known Issues / Troubleshooting

- **`invalid_auth` on startup**: Reinstall the Slack App to your workspace (Settings > Install App > Reinstall) and copy the new bot token. Also verify the App-Level Token is complete (check under Basic Information > App-Level Tokens).
- **Tokens in `.env`**: No quotes, no trailing spaces, no inline comments. Just `KEY=value`.
- **Requires Claude Code CLI**: The Agent SDK spawns the `claude` CLI binary. It must be installed (`which claude` should return a path).
- **Bot not responding to DMs**: Ensure `im:history` and `im:write` scopes are added, `message.im` event is subscribed, and "Allow users to send messages" is enabled under App Home.
- **Stale sessions after restart**: Now auto-recovered — Foreman falls back to a fresh session if resume fails. Can also manually clear with `/cc new`.

## Running as a Service

Foreman runs as a macOS launchd service for always-on operation:

- `foreman init` offers to create the plist and load the service
- Plist at `~/Library/LaunchAgents/com.foreman.bot.plist`
- `KeepAlive` + `RunAtLoad` ensure it starts on login and restarts on crash
- `ThrottleInterval: 5` prevents rapid restart loops
- `/cc reboot` exits the process; launchd auto-restarts it
- Logs at `~/.foreman/foreman.{out,err}.log`
- `launchctl print gui/$(id -u)/com.foreman.bot` to check status

The plist's `EnvironmentVariables.PATH` includes `/opt/homebrew/bin` so the `claude` CLI is discoverable. `claude.ts` resolves the path dynamically via `which claude` at startup.

## Future Ideas

- File upload/download via Slack
- Cost tracking per session
- Web UI for session management
