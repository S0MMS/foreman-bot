# Foreman — Developer Onboarding Guide

Welcome to Foreman. This guide walks you from zero to a working multi-bot AI environment in about 15 minutes.

---

## What You're Building

By the end of this guide you'll have:

- A local Mattermost instance (the chat UI)
- 20+ channels, each with its own AI bot (Claude, Gemini, GPT)
- A FlowSpec workflow engine (Temporal) for orchestrating multi-bot pipelines
- A Kafka/Redpanda bus for bot-to-bot messaging

The architecture looks like this:

```
You (Mattermost) → Foreman (Node.js) → Claude / GPT / Gemini
                         ↕
                   Redpanda (Kafka)      ← bot-to-bot messaging
                         ↕
                   Temporal              ← durable workflow engine
```

Foreman runs locally on your Mac. Everything else runs in Docker.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| **Docker Desktop** | Latest | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) |
| **Node.js** | 18+ | `brew install node` or [nodejs.org](https://nodejs.org/) |
| **Anthropic API key** | — | [console.anthropic.com](https://console.anthropic.com/) |
| **Gemini API key** | optional | [aistudio.google.com](https://aistudio.google.com/) |
| **OpenAI API key** | optional | [platform.openai.com](https://platform.openai.com/) |

Claude (Anthropic) is required — it powers the infrastructure bots. Gemini and OpenAI are optional; their channels will show a "key not configured" message until you add them.

---

## Step 1: Clone and Install

```bash
git clone https://github.com/S0MMS/foreman-bot.git
cd foreman-bot
npm install
```

---

## Step 2: Run Setup

The setup script does everything in one shot: starts Docker, creates the Mattermost instance, creates all channels and bot accounts, and writes your config file.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...        # optional
export OPENAI_API_KEY=sk-...         # optional

npm run setup
```

This takes 1–2 minutes. When it finishes, it prints your Mattermost login credentials. **Save these.**

> **What setup does behind the scenes:**
> - Runs `docker compose up -d` (Mattermost, Postgres, Redpanda, and Temporal — everything in Docker)
> - Calls the Mattermost API to create a team, all channels, and all bot accounts
> - Writes `~/.foreman/config.json` with tokens for every bot

---

## Step 3: Start Foreman

```bash
npm run build && npm start
```

You should see:

```
[foreman] Mattermost connected
[foreman] Kafka connected (Redpanda)
[temporal] Worker started
[foreman] Listening on port 3001
```

---

## Step 4: Open Mattermost

Go to [http://localhost:8065](http://localhost:8065) and log in with the credentials printed by the setup script.

You'll see a sidebar organized into categories:

| Category | Channels | Purpose |
|---|---|---|
| **General** | `#thought-pad`, `#alice`, `#bob`, `#charlie` | Everyday AI chat |
| **Models** | `#claude`, `#gemini`, `#gpt` | Raw model access, one per provider |
| **FlowSpec Tutorial** | `#flowspec-engineer`, `#flowbot-01/02/03` | Learn multi-bot workflows |
| **TECHOPS-2187** | `#claude-worker`, `#gemini-worker`, `#gpt-worker`, `#claude-judge` | Real-world workflow example |
| **Pythia** | `#pythia-*` | Multi-model research pipeline |

---

## Your First Conversation

Go to `#alice` and type anything. Alice will respond. Each channel is an independent AI session — its own model, conversation history, and persona.

```
Hi Alice! What can you help me with?
```

Try `#claude` for Opus-class Claude, `#gemini` for Gemini, `#gpt` for GPT. Each model has its own channel.

---

## Commands

Use `/f` in any channel to control the bot:

| Command | What it does |
|---|---|
| `/f model sonnet` | Switch to Claude Sonnet |
| `/f model opus` | Switch to Claude Opus |
| `/f model gemini:gemini-2.5-flash` | Switch to Gemini Flash |
| `/f model openai:o4-mini` | Switch to GPT o4-mini |
| `/f session` | Show current session info (model, cwd, etc.) |
| `/f new` | Reset the session — fresh conversation |
| `/f auto-approve on` | Skip tool approval prompts |
| `/f stop` | Abort a running query |
| `/f cwd ~/projects/myapp` | Set the working directory |
| `/f run flows/my-workflow.flow` | Run a FlowSpec workflow |
| `/f reboot` | Restart the Foreman process |

> **Slack users:** Use `/cc` instead of `/f`. Everything else is the same.

---

## Tool Approvals

When a bot wants to write or edit a file, Foreman pauses and posts an **Approve / Deny** button in the channel. You tap the button to allow or reject the action.

Read-only tools (file reads, web searches, canvas reads) are **auto-approved** — no button needed.

To skip all prompts for a channel: `/f auto-approve on`

All out-of-the-box bots have `auto_approve: true` in `bots.yaml`, so you won't see approval prompts unless you change this.

---

## Your First FlowSpec Workflow

FlowSpec is a plain-text language for orchestrating multi-bot workflows. Open the FlowSpec tutorial:

```
/f run flows/flowspec-tutorial.flow "Lesson 1"
```

This runs the first lesson — it asks two bots the same question and compares their answers. The tutorial has 7 progressive lessons.

Here's a simple workflow you can write yourself:

```
workflow "Quick Review"
  ask @alice "Summarize the key risks in this code: {code}"
  ask @bob "Do you agree with Alice's assessment? What would you add?"
end
```

---

## Running as a Service

On macOS, you can keep Foreman running automatically after reboots using launchd:

```bash
foreman init
# Offers to create a launchd plist automatically.
# After setup: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.foreman.bot.plist
```

Logs: `~/.foreman/foreman.out.log` and `~/.foreman/foreman.err.log`

After a Mac reboot, start Docker and Temporal manually — only Foreman auto-restarts via launchd.

---

## Health Check

After startup, verify everything is running:

```bash
curl -s http://localhost:3001/health     # Foreman
curl -s http://localhost:8065/api/v4/system/ping | grep -o '"status":"[^"]*"'  # Mattermost
curl -s http://localhost:8080 > /dev/null && echo "Redpanda Console OK"
curl -s http://localhost:7233 > /dev/null && echo "Temporal OK"
docker ps --format "{{.Names}} {{.Status}}" | grep foreman
```

| Service | URL | Expected |
|---|---|---|
| Foreman | localhost:3001 | `{"status":"ok"}` |
| Mattermost | localhost:8065 | Chat UI |
| Redpanda Console | localhost:8080 | Kafka topic explorer |
| Temporal UI | localhost:8233 | Workflow history |

---

## Customizing Bots

Bot definitions live in `bots.yaml`. Each bot has a name, model, provider, and system prompt:

```yaml
bots:
  alice:
    type: sdk
    provider: anthropic
    model: claude-sonnet-4-6
    auto_approve: true
    system_prompt: |
      You are Alice, a versatile assistant...
```

**To add a new bot:**

1. Add an entry to `bots.yaml`
2. Create a channel in Mattermost (via the UI or API)
3. Add the channel ID to `config/channel-registry.yaml` under `mattermost:`
4. Invite the Foreman bot account to the channel
5. Done — no restart needed for new channels

**Note:** There's only one Foreman bot account. It serves all channels. Each channel is a routing target, not a separate bot identity.

---

## Optional Integrations

### Jira + Confluence

Add to `~/.foreman/config.json`:
```json
{
  "jiraHost": "https://myorg.atlassian.net",
  "jiraEmail": "you@example.com",
  "jiraApiToken": "your-token"
}
```

Bots can then create/read/update Jira tickets and Confluence pages directly.

### Bitrise CI

```json
{
  "bitriseToken": "your-personal-access-token",
  "bitriseAppSlug": "your-app-slug"
}
```

Bots can trigger CI builds with the `TriggerBitrise` tool or `/f bitrise <workflow>`.

### Google Workspace

With Google OAuth credentials configured, Claude bots can read/write Google Docs, Sheets, Slides, Drive, Gmail, and Calendar. See the [Google Workspace setup section in README.md](README.md#google-workspace-optional).

---

## Common Gotchas

**"Cannot connect to Docker daemon"**
Docker Desktop isn't running. Open it from Applications and wait for the whale icon to stop animating before running commands.

**Bots not responding after a Mac reboot**
Foreman auto-restarts via launchd, but Docker doesn't. Run:
```bash
docker compose up -d
```

**Bot responds once then stops (hung session)**
A tool call may have gotten stuck. Run `/f new` to reset the session. If that doesn't work:
```bash
# Edit ~/.foreman/sessions.json and set "sessionId": null for the affected channel
```

**Long responses are truncated**
Mattermost has a 16K character limit per post. Responses over 15,000 characters are automatically truncated with a note. The full response is still available as a workflow variable in FlowSpec contexts.

**`/f run` says "workflow not found"**
The workflow name in the command must match the `workflow "Name"` declaration in the `.flow` file exactly (case-sensitive).

---

## Going Further

| Topic | Where to look |
|---|---|
| FlowSpec language reference | `docs/flowspec/flowspec-reference.md` |
| Architecture deep-dive | `ARCHITECTURE.md` |
| Foreman 2.0 status + roadmap | `docs/memory/project_foreman_2.md` |
| Self-modification safety protocol | `docs/memory/dead_man_protocol.md` |
| All FlowSpec examples | `flows/` directory |
| Pythia multi-model pipeline | `docs/pythia/pythia-reference.md` |
