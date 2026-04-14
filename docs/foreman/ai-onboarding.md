# Foreman, FlowSpec & Pythia — AI Onboarding Summary

*This document is written for AI agents who need to get up to speed quickly on the Foreman system, the FlowSpec workflow language, and the Pythia multi-model verification process.*

---

## What Is Foreman?

Foreman is a multi-transport AI agent bridge. It connects chat platforms (Slack and Mattermost) to AI agent sessions powered by Claude, OpenAI, and Gemini. **Mattermost is the primary interface.** Slack is optional and can run in parallel.

Key properties:

- **One bot per channel.** Each channel is a fully independent AI session with its own working directory, model, conversation history, and persona name.
- **Multiple AI backends.** Claude (Anthropic, default), OpenAI, and Gemini are all supported. Switch mid-session with `/f model gemini:gemini-2.5-flash` or `/f model openai:o4-mini`. In Slack, use `/cc` instead of `/f`.
- **Bot registry.** All bot identities are defined in `bots.yaml` — a single source of truth for names, models, system prompts, and tool scoping. Channel routing for FlowSpec lives in `config/channel-registry.yaml`.
- **Slash commands.** In Mattermost: `/f`. In Slack: `/cc`. Key commands: `/f model`, `/f new`, `/f session`, `/f run`, `/f stop`, `/f reboot`.
- **Tool approval.** Read/search tools auto-approve. Write/edit tools surface as Approve/Deny buttons in the chat. `auto_approve: true` in `bots.yaml` skips all prompts for a bot.

Foreman is the runtime and control plane. FlowSpec is the language for orchestrating multiple Foreman bots into multi-step workflows.

---

## Infrastructure

Foreman 2.0 runs on three services:

| Service | Role | How it starts |
|---|---|---|
| **Foreman** (Node.js) | AI agent bridge + Temporal worker | `npm start` or launchd |
| **Redpanda** (Kafka) | Bot-to-bot message bus for FlowSpec | `docker compose up -d` |
| **Temporal** | Durable workflow execution engine | `temporal server start-dev` |

Mattermost and Postgres also run in Docker. All infrastructure starts with `docker compose up -d`.

### Kafka / Redpanda

All bot traffic in FlowSpec workflows flows through Kafka (Redpanda). Each bot has a topic pair: `{name}.inbox` / `{name}.outbox`. Foreman auto-creates topics on startup. This is mandatory — direct-dispatch shortcuts without Kafka bypass audit logging and break the FlowSpec execution model.

### Temporal

FlowSpec workflows compile to Temporal TypeScript workflows. Temporal provides durable, replayable execution with retries, timeouts, and full history. The Temporal UI is at `localhost:8233`. The Temporal worker runs inside Foreman automatically.

---

## What Is FlowSpec?

**FlowSpec was designed from the ground up by AI, for AI.** No human wrote a spec. The dev posed a question to Delphi — *"What should an AI bot orchestration language look like?"* — and 6 AI agents across Claude, Gemini, and GPT designed it through 3 rounds of adversarial debate. The output of that process *is* the language. Every primitive, every design principle, the Turing completeness goal, the `ask` vs `send` distinction — all of it came from AI consensus, not a human designer.

FlowSpec is a workflow description language for orchestrating AI bots.

**Design principles (in order of priority):**

1. **Turing complete first.** Self-referential `run "Workflow"` + `if/otherwise` = unbounded recursion with conditional base cases.
2. **Simple enough for a non-engineer (PM) to write.** No functions, types, or control flow complexity beyond what is listed below.
3. **Expressive enough for ~80% of multi-agent workflows.**

**How workflows are run:**
- From a `.flow` file: `/f run mywf.flow "Workflow Name"`
- From a Mattermost canvas: `/f run "Canvas Title" "Workflow Name"`
- From the channel's default canvas: `/f run canvas "Workflow Name"`

**Runtime:** FlowSpec compiles to Temporal TypeScript workflows via `src/flowspec/compiler.ts`. Bot dispatch goes through Kafka. The FlowSpec registry maps bot names to channel IDs via `config/channel-registry.yaml`.

**Key primitives:**
- `ask @bot "..."` — dispatch work to a named bot via Kafka, wait for response
- `send @bot "..."` / `send #channel "..."` — fire-and-forget message (no bot session)
- `-> name` / `{name}` — capture and reference output
- `at the same time` — parallel fan-out (wait for all)
- `race` — parallel, first to finish wins
- `for each X in {list}` — bounded iteration
- `repeat until ... at most N times` — convergence loop
- `if {X} contains/equals/means "Y"` / `otherwise` — conditional
- `run "Workflow"` — sub-workflow call (enables Turing completeness)
- `pause for approval` — human-in-the-loop gate
- `within <duration>` — timeout
- `retry N times` / `if it fails` — error handling
- `stop` — exit workflow

**Critical distinction — `ask` vs `send`:** `ask` starts a full AI session and waits for a response (via Kafka inbox). `send` just posts a text message — no AI session is triggered. Use `ask` to make a bot do work; use `send` for status updates and notifications.

For the complete language spec, examples, and implementation details, see: `docs/flowspec/flowspec-reference.md`

---

## What Is Pythia?

**Pythia was designed from the ground up by AI, for AI.** The dev asked Delphi to run Delphi on itself — the question was *"How should Delphi be improved?"* Three models independently analyzed Delphi's architecture, a judge synthesized their answers, workers critiqued it, the judge revised. The output of that process *became* Pythia's design spec. No human wrote it. Pythia's 5-phase architecture is what multiple leading AI models concluded, through the very process Pythia now implements, was the best multi-model verification pipeline.

Pythia is a 5-phase multi-model verification workflow — the successor to Delphi.

**The problem Pythia solves:** A single LLM can be confidently wrong. Pythia gets multiple independent models to answer the same question, then runs structured critique and fact-checking phases to surface errors, contradictions, and missing perspectives before producing a final answer.

**Why Pythia over Delphi:**
- Delphi has 3 phases (quorum → verify → revise). Pythia has 5 (answer → synthesize → critique → revise → fact-check).
- Pythia adds a dedicated fact-checking phase using tool-based verification.
- Pythia uses structured VERIFIED/REFUTED/UNVERIFIABLE verdicts with confidence scores.
- Pythia has been run against itself (self-referential quality analysis) — results are in `pythia/results/`.

**How to invoke:**
```
/f run "Pythia" "Pythia" question="Your question here" mode=code
```
Or run from the `pythia.flow` canvas. Modes: `code` (default), `research`, `design`.

For the full Pythia design, research foundations, and current limitations, see: `docs/pythia/pythia-reference.md`

---

## The foreman-toolbelt

Every Claude session gets an in-process MCP server called `foreman-toolbelt` (`src/mcp-toolbelt.ts`). It's organized into 6 domains:

| Domain | Tools |
|---|---|
| `foreman-slack` | Canvas (read/write/append/delete), PostMessage, ReadChannel |
| `foreman-atlassian` | Jira (create/read/update/transition/assign/search), Confluence (read/search/create/update) |
| `foreman-github` | GitHubCreatePR, GitHubReadPR, GitHubReadIssue, GitHubSearch, GitHubListPRs |
| `foreman-bitrise` | TriggerBitrise |
| `foreman-admin` | SelfReboot, GetCurrentChannel |
| `foreman-xcode` | LaunchApp (iOS simulator + Android emulator) |

Bots can be scoped to a subset of domains via `mcp_servers:` in `bots.yaml`. Omitting `mcp_servers` gives the bot all tools.

If `googleOAuthClientId` and `googleOAuthClientSecret` are in `~/.foreman/config.json`, Claude bots also get access to the `google-workspace` MCP server (Google Docs, Sheets, Slides, Drive, Gmail, Calendar).

---

## Where to Find More Information

| Topic | File |
|-------|------|
| Human setup guide (start here) | `ONBOARDING.md` |
| FlowSpec full language spec | `docs/flowspec/flowspec-reference.md` |
| FlowSpec implementation status | `docs/flowspec/flowspec-status.md` |
| Pythia design + research citations | `docs/pythia/pythia-reference.md` |
| Pythia self-analysis results | `pythia/results/pythia-self-analysis-2026-03-29.md` |
| Foreman architecture | `ARCHITECTURE.md` |
| Foreman 2.0 status + roadmap | `docs/memory/project_foreman_2.md` |
| Dead Man Protocol (self-mod safety) | `docs/memory/dead_man_protocol.md` |
| Bot registry | `bots.yaml` |
| Channel routing | `config/channel-registry.yaml` |
| Workflow files | `flows/` directory |
