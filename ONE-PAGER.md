# Foreman — One Pager

## What Is Foreman?
A Slack bot that bridges Claude Code sessions into your channels. Each channel gets its own independent AI agent with its own working directory, model, and context. Published to npm as `foreman-bot`.

---

## Multi-Agent Dispatch
Send work to multiple channels simultaneously — bots work in parallel and report back when done.

```
/cc message #ios-dev4 #and-dev1 Read the canvas in #burger-view-01, implement the feature, launch the app, and post back when you are done.
```

---

## Canvas Intelligence
- `/cc spec` — reads your canvas, asks 3 clarifying questions, writes **Acceptance Criteria** (Gherkin) + **Tech Spec** to the canvas
- `/cc implement` — reads the canvas spec and implements the feature in code
- Full canvas CRUD — read, write, update, delete sections

---

## Mobile Dev Integration
- `/cc launch-ios` — installs + launches on booted iOS simulator
- `/cc launch-android` — gradlew install + launches on Android emulator
- `/cc build [scheme]` — builds Xcode project
- `/cc bitrise <workflow>` — triggers Bitrise CI (TestFlight, QA Release, etc.)
- `/cc commit <message>` — stages all + commits
- `/cc push` — pushes to origin

---

## Integrations
- **Jira** — create, read, update tickets and comments
- **Confluence** — read, search, create, update pages
- **GitHub** — create PRs, read issues, search repos
- **Bitrise** — trigger CI workflows (TestFlight, QA Release, etc.) via natural language
- **Diagrams** — generate Mermaid diagrams posted as images

---

## Session Control
| Command | What it does |
|---|---|
| `/cc cwd <path>` | Set working directory |
| `/cc model <name>` | Switch model (opus/sonnet/haiku) |
| `/cc auto-approve on\|off` | Skip all tool approval prompts |
| `/cc session` | Show current session state |
| `/cc new` | Fresh session |
| `/cc stop` | Cancel active query |
| `/cc plugin <path>` | Load a Claude Code plugin |
| `/cc message #ch [text]` | Send a message to one or more channels |
| `/cc help` | Full command list |

---

## Tool Approval
Every tool Claude wants to use either auto-runs (read-only tools, canvas, Jira, GitHub, LaunchApp, PostMessage, TriggerBitrise, Bash) or prompts Approve/Deny in Slack — unless `/cc auto-approve on` is set.

---

## Under the Hood
- Node.js + TypeScript, one process handles all channels
- Claude Agent SDK with in-process MCP server
- Sessions persisted across reboots (`~/.foreman/sessions.json`)
- `npx foreman-bot` to run
