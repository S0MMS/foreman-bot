# Foreman

A multi-model AI agent bridge for teams. Chat with Claude, Gemini, and GPT bots from a shared Mattermost instance. Orchestrate multi-bot workflows with FlowSpec.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org/) 18+
- An [Anthropic API key](https://console.anthropic.com/) (required)
- Google Gemini and/or OpenAI API keys (optional — channels show setup instructions if missing)

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/S0MMS/foreman-bot.git
cd foreman-bot
npm install

# 2. Set your API key(s)
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...        # optional
export OPENAI_API_KEY=sk-...         # optional

# 3. Run setup (starts Docker, creates everything)
npm run setup

# 4. Start Foreman
npm run build && npm start
```

That's it. Open [http://localhost:8065](http://localhost:8065) and log in with the credentials printed by the setup script.

## What You Get

Setup creates a fully configured Mattermost instance with 20+ channels, organized into sidebar categories:

| Category | Channels | What they do |
|---|---|---|
| **General** | `#thought-pad`, `#alice`, `#bob`, `#charlie` | Everyday AI chat, brainstorming |
| **Models** | `#claude`, `#gemini`, `#gpt` | Raw model access — one channel per provider |
| **FlowSpec Tutorial** | `#flowspec-engineer`, `#flowbot-01/02/03` | Learn multi-bot workflows |
| **TECHOPS-2187** | `#claude-worker`, `#gemini-worker`, `#gpt-worker`, `#claude-judge` | Real-world workflow example |
| **Pythia** | `#pythia-*` | Multi-model research pipeline |

Every channel is an independent AI session. Each has its own model, conversation history, and persona. Type a message and the bot responds.

## Commands

Use `/f` in any channel to control sessions:

| Command | Description |
|---|---|
| `/f model <name>` | Switch model (`opus`, `sonnet`, `haiku`, or `vendor:model` like `gemini:gemini-2.5-flash`) |
| `/f session` | Show current session info |
| `/f new` | Reset the session (fresh conversation) |
| `/f auto-approve on\|off` | Toggle tool approval prompts |
| `/f stop` | Abort a running query |
| `/f run <file.flow>` | Run a FlowSpec workflow |

## Tool Approvals

When a bot wants to edit a file or run a shell command, Foreman posts an **Approve / Deny** button in the channel. Read-only tools (file reads, searches, web fetches) are auto-approved. You can skip all prompts with `/f auto-approve on` — this is enabled by default for all out-of-the-box bots.

## FlowSpec Workflows

FlowSpec is a plain-text language for orchestrating multi-bot workflows. Bots work in sequence or parallel, with results flowing between them.

```
workflow "Quick Review"
  ask @alice "Summarize the key risks in this PR"
  ask @bob "What would you change about this approach?"

  at the same time
    ask @alice "Draft a response addressing Bob's feedback"
    ask @bob "Rate Alice's summary on a scale of 1-10"
  done
end
```

Run it: `/f run flows/my-workflow.flow`

See `flows/flowspec-tutorial.flow` for a hands-on walkthrough with 7 progressive lessons.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Mattermost  │────▶│   Foreman    │────▶│ Claude / GPT │
│  (Chat UI)   │◀────│  (Node.js)   │◀────│  / Gemini    │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────┴───────┐
                     │   Redpanda   │  Bot-to-bot messaging
                     │   (Kafka)    │  for FlowSpec workflows
                     └──────┬───────┘
                            │
                     ┌──────┴───────┐
                     │   Temporal   │  Durable workflow execution
                     │              │  (retries, state, history)
                     └──────────────┘
```

All infrastructure runs in Docker via `docker compose`. Foreman itself runs natively on Node.js.

| Service | URL | Purpose |
|---|---|---|
| Mattermost | [localhost:8065](http://localhost:8065) | Chat with bots |
| Redpanda Console | [localhost:8080](http://localhost:8080) | Inspect bot message traffic |
| Temporal UI | [localhost:8233](http://localhost:8233) | Monitor workflow executions |

## Adding API Keys Later

If you skipped Gemini or OpenAI during setup, add them anytime:

```bash
# Option A: Re-run setup with new keys
export GEMINI_API_KEY=AIza...
export OPENAI_API_KEY=sk-...
npm run setup

# Option B: Edit config directly
# Add to ~/.foreman/config.json:
#   "geminiApiKey": "AIza..."
#   "openaiApiKey": "sk-..."
```

Restart Foreman after adding keys. Channels that showed "API key not configured" will start working.

## Slack (Optional)

Foreman can also connect to Slack in parallel with Mattermost. Add `slackBotToken` and `slackAppToken` to `~/.foreman/config.json`. See `slack-manifest.json` for the Slack app manifest. Use `/cc` instead of `/f` for slash commands in Slack.

## Running as a Service

On macOS, you can use launchd to keep Foreman running:

```bash
# Install the launchd service
foreman init    # offers to create the plist automatically

# Or manually load it
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.foreman.bot.plist
```

Logs: `~/.foreman/foreman.out.log` and `~/.foreman/foreman.err.log`

## Project Structure

```
src/                  TypeScript source
  index.ts            Entry point — starts all transports
  mattermost.ts       Mattermost WebSocket bridge
  slack.ts            Slack Socket Mode bridge (optional)
  adapters/           Claude, Gemini, OpenAI agent adapters
  temporal/           Workflow engine (workflows, activities, worker)
  flowspec/           FlowSpec parser and compiler
bots.yaml             Bot definitions — models, prompts, providers
config/
  channel-registry.yaml   Channel ID mappings per transport
flows/                FlowSpec workflow files (.flow)
scripts/
  bootstrap.sh        Zero-browser Mattermost setup
docker-compose.yml    Redpanda + Mattermost + Temporal + Postgres
```

## Configuration

All config lives in `~/.foreman/config.json`, written automatically by `npm run setup`:

| Field | Description |
|---|---|
| `anthropicApiKey` | Anthropic API key (required for Claude bots) |
| `geminiApiKey` | Google Gemini API key (optional) |
| `openaiApiKey` | OpenAI API key (optional) |
| `mattermostUrl` | Mattermost server URL (default: `http://localhost:8065`) |
| `mattermostAdminToken` | Admin access token for Mattermost API |
| `defaultCwd` | Default working directory for bot sessions |
| `slackBotToken` | Slack bot token (optional, for Slack bridge) |
| `slackAppToken` | Slack app token (optional, for Slack bridge) |

## License

MIT
