# Foreman

Control [Claude Code](https://claude.ai/code) sessions from Slack. Run Claude locally on your Mac and send it tasks from your phone.

## How it works

Foreman runs on your Mac and connects to Slack via Socket Mode (no public URL needed). You message the bot in Slack, it runs Claude Code locally, and replies with the result. Tool calls that modify files or run commands require your approval via Slack buttons.

## Requirements

- Node.js 18+
- [Claude Code](https://claude.ai/code) installed (`npm install -g @anthropic-ai/claude-code`)
- A Slack workspace where you can create apps

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
| `/cc cwd <path>` | Set working directory for this channel |
| `/cc model <name>` | Set model (`opus`, `sonnet`, `haiku`, or full model ID) |
| `/cc name <name>` | Override the bot's persona name for this channel |
| `/cc plugin <path>` | Load a Claude Code plugin |
| `/cc stop` | Cancel the running query |
| `/cc session` | Show current session info |
| `/cc new` | Clear session and start fresh |

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
