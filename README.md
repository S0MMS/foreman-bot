# Foreman

Control [Claude Code](https://claude.ai/code) sessions from Slack. Run Claude locally on your Mac and send it tasks from your phone.

## How it works

Foreman runs on your Mac and connects to Slack via Socket Mode (no public URL needed). You message the bot in Slack, it runs Claude Code locally, and replies with the result. Tool calls that modify files or run commands require your approval via Slack buttons.

## Prerequisites

1. **[Claude Code](https://claude.ai/code)** — Foreman controls Claude Code, so you need it installed first:
   ```sh
   npm install -g @anthropic-ai/claude-code
   ```
2. **Node.js 18+**
3. **An Anthropic API key** (`sk-ant-...`) — same key used by Claude Code
4. **A Slack workspace** where you can create apps

## Install

```sh
npm install -g foreman-bot
```

## Setup

### 1. Create your Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From Manifest**
3. Paste the contents of [`slack-manifest.json`](./slack-manifest.json) from this repo
4. Click **Install to Workspace**
5. From **OAuth & Permissions**, copy your **Bot Token** (`xoxb-...`)
6. From **Basic Information** → **App-Level Tokens**, create a token with the `connections:write` scope and copy it (`xapp-...`)

### 2. Run the setup wizard

```sh
foreman init
```

This prompts for your tokens and writes them to `~/.foreman/config.json`.

### 3. Start Foreman

```sh
foreman
```

Invite the bot to a Slack channel and start messaging it.

## Usage

Message the bot in any channel it's been invited to. Each channel gets its own independent Claude session with its own working directory, model, and conversation history.

The bot's persona name comes from the channel name — put it in `#clive` and it's Clive, `#betty` and it's Betty. DMs default to "Foreman".

### Tool approvals

When Claude wants to edit a file or run a shell command, Foreman posts an **Approve / Deny** button in Slack. Read-only tools (file reads, searches, web fetches) are auto-approved.

### Slash commands

| Command | Description |
|---|---|
| `/cc cwd <path>` | Set working directory for this channel (`~/` paths supported) |
| `/cc model <name>` | Set model (`opus`, `sonnet`, `haiku`, vendor:model, or full model ID) |
| `/cc name <name>` | Override the bot's persona name for this channel |
| `/cc plugin <path>` | Load a Claude Code plugin |
| `/cc stop` | Cancel the running query |
| `/cc session` | Show current session info |
| `/cc new` | Clear session and start fresh |
| `/cc canvas list` | List all canvases in this channel |
| `/cc run <file.flow> [workflow]` | Run a FlowSpec workflow from a file |
| `/cc run "Canvas Title" [workflow]` | Run a FlowSpec workflow from a named canvas |
| `/cc delphi #w1 #w2 #w3 "question"` | Run a 3-phase Delphi multi-bot verification workflow |
| `/cc reboot` | Restart the Foreman process |

## Running as a service

On macOS, `foreman init` offers to install a launchd service that starts Foreman on login and keeps it running.

If you prefer manual setup, create `~/Library/LaunchAgents/com.foreman.bot.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.foreman.bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/node</string>
    <string>/path/to/foreman/dist/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>/path/to/foreman</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>/Users/you/.foreman/foreman.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/.foreman/foreman.err.log</string>
</dict>
</plist>
```

Then load it:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.foreman.bot.plist
```

Check status:

```sh
launchctl print gui/$(id -u)/com.foreman.bot
```

Logs are at `~/.foreman/foreman.out.log` and `~/.foreman/foreman.err.log`.

## Configuration

Config lives at `~/.foreman/config.json` (written by `foreman init`):

```json
{
  "slackBotToken": "xoxb-...",
  "slackAppToken": "xapp-...",
  "anthropicApiKey": "sk-ant-...",
  "defaultCwd": "/Users/you/projects"
}
```

A `.env` file in the project directory also works and takes lower priority than `config.json`.

## Running from source

```sh
git clone https://github.com/your-username/foreman
cd foreman
npm install
npm run dev    # uses .env for config
```
