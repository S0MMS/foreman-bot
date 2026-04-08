# Development Ideas

## 22. Foreman UI Tech Stack — React + Tailwind + shadcn/ui
- **Status**: Partially shipped — React + Vite + Tailwind live in `ui/`. TypeScript and shadcn/ui not adopted.
- **Concept**: When building `foreman ui`, use Vite + React + TypeScript + Tailwind + shadcn/ui. The primary design constraint is that the UI must be fully buildable by a Foreman bot — no hand-written HTML ever.

### Why This Stack
- **React** — component model is deeply represented in LLM training data, bots produce correct code on first try
- **Tailwind** — utility classes inline in JSX, no separate CSS files, no context switching between files
- **shadcn/ui** — pre-built components copied as source code into the project (not a black-box dependency), bots can read and modify them directly
- **Vite** — dev server starts instantly, minimal config, no webpack archaeology

### Why It's Bot-Friendly
Everything lives in one file per component. A bot writes a complete page in one shot — no hunting across CSS files, no style inheritance surprises. The component IS the UI.

### Brutalist Aesthetic via Tailwind
One line produces a brutalist card:
```
border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]
```
No framework needed for the aesthetic — Tailwind utility classes are sufficient.

### Key Constraint
**No hand-written HTML. Ever.** All UI development is delegated to a Foreman bot given a wireframe description or component spec.

---

## 21. bots.yaml — Bot Registry as Single Source of Truth
- **Status**: Shipped — `bots.yaml` exists, `src/bots.ts` parses it, topics auto-created on startup
- **Concept**: A declarative config file that defines all bots — their name, model, provider, and system prompt. Everything in the Foreman ecosystem derives from this file. Replaces the current implicit model-per-Slack-channel approach with explicit, version-controlled bot identity.

### The Problem Today
Bot identity is implicit — whatever model was last set via `/cc model` in a Slack channel. Delphi/Pythia flows assume `#gemini-worker` is Gemini, but only because someone manually set it. Fragile, undocumented, not shareable.

### bots.yaml
```yaml
bots:
  betty:
    model: claude-sonnet-4-6
    provider: anthropic
    system_prompt: "You are Betty, a senior software engineer..."

  clive:
    model: gemini-2.5-flash
    provider: gemini
    system_prompt: "You are Clive, a code reviewer..."

  gpt-judge:
    model: gpt-4o
    provider: openai
    system_prompt: "You are a synthesis judge..."
```

### Everything Derives From It
| Consumer | What it gets from bots.yaml |
|---|---|
| Foreman bot runner | One Kafka consumer per bot with the right SDK adapter |
| `foreman ui` | Left nav bot list |
| Redpanda | Topics auto-created on startup (`betty.inbox`, `betty.outbox`) |
| FlowSpec | `ask @betty` is valid because `betty` is declared |
| Temporal | `dispatchToBot("betty")` resolves to the right adapter |
| `foreman init` | Wizard generates this file during onboarding |

### Developer Onboarding
```bash
npm install -g foreman-bot
foreman init          # wizard creates bots.yaml + config
docker compose up     # Temporal + Redpanda
foreman ui            # open browser, all bots ready
```

No Slack app. No manual `/cc model` per channel. Bots are reproducible across machines and team members.

---

## 20. Slack-Free Foreman — Kafka as Bot Transport, CLI as Interface
- **Status**: Partially shipped — web UI live (`ui/`), Kafka transport built, Mattermost bridge live. CLI commands (`foreman ask`, `foreman flow`, `foreman watch`) not yet built.
- **Concept**: Decouple Foreman from Slack entirely, so developers can run FlowSpec workflows and talk to bots using only a CLI + Redpanda + Temporal. Slack becomes purely optional — an add-on for teams that want it, not a prerequisite.

### The `foreman ui` Local Web App
A `foreman ui` command spins up a local web server and opens a chat-like UI in the browser. Left nav lists all bots (auto-discovered from `*.inbox` topic pairs) and all available `.flow` files. Clicking a bot opens a unified conversation view interleaving `betty.inbox` and `betty.outbox` in real time. Clicking a workflow prompts for inputs and fires the Temporal workflow.

```
┌──────────────────────────────────────────────────────────────┐
│  Foreman                                          ⚙ Settings │
├──────────────┬───────────────────────────────────────────────┤
│  BOTS        │  betty                              🟢 online  │
│              │                                               │
│  🟢 betty    │  [→ IN ] 14:23:01  "Summarize this..."        │
│  🟢 clive    │  [← OUT] 14:23:14  "Here is the summary..."   │
│  🟡 gpt      │  [→ IN ] 14:24:45  "Translate to Spanish..."  │
│  🔴 gemini   │  [← OUT] 14:25:02  "Aquí está..."             │
│              │                                               │
│  WORKFLOWS   │  ┌─────────────────────────────────────────┐  │
│              │  │ Type a message...                   [→]  │  │
│  ▶ pythia    │  └─────────────────────────────────────────┘  │
│  ▶ delphi    │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

- **Bot status** — green/yellow/red based on consumer activity and lag
- **Auto-discovery** — bots appear when their topic pair exists in Redpanda
- **Send box** — produces directly to `betty.inbox`
- **Tool approval** — pending approvals show as yellow badge on bot in left nav
- **Tech**: Express + WebSocket bridge (Kafka → browser) + minimal React, ships inside `foreman-bot` npm package

### The Problem
Right now Foreman requires a full Slack app setup to do anything useful. This creates a high barrier for fellow developers who just want to run bot workflows. Slack is doing double duty: it's both the human UI *and* the inter-bot transport. These should be separate concerns.

### The Core Insight
Foreman already has two distinct jobs — they're just tangled together because Slack is the transport:
1. **Slack bridge** — receive Slack events, post responses, handle commands, tool approvals
2. **Bot runtime** — manage sessions, pick the right SDK adapter, call the API, return the response

With Kafka as the bot-to-bot transport, Job 2 has zero dependency on Slack. A developer without a Slack app can run the full system.

### The CLI Interface
```bash
foreman flow my-workflow.flow        # run a FlowSpec workflow
foreman ask betty "summarize this"   # send a message to a bot, get response
foreman watch betty                  # tail betty.outbox in real time
```

### The Full Stack (No Slack Required)
| Need | Tool |
|---|---|
| Run workflows / talk to bots | `foreman` CLI |
| Watch bot conversations | Redpanda Console (`localhost:8080`) |
| Inspect workflow state | Temporal UI (`localhost:8233`) |

Three browser tabs and a terminal. No Slack required.

### How Bot Communication Works
Each bot gets a Kafka topic pair: `betty.inbox` / `betty.outbox`. Foreman runs a consumer loop per bot — same SessionState, same SDK adapters as today. The only change is *how the prompt arrives* and *how the response leaves*.

```
foreman ask betty "..."
  → produce to betty.inbox { prompt, correlationId }
  → Foreman bot runtime consumes, calls SDK adapter, gets response
  → produce to betty.outbox { correlationId, response }
  → CLI receives response, prints it
```

### Slack Stays Intact
Slack users get everything they have today — it becomes one of multiple input/output adapters sitting on top of the same bot runtime. `npm install -g foreman-bot` becomes genuinely useful to any developer, Slack or not.

### What You Gain
- Any developer can use FlowSpec/Temporal/Kafka with `npm install -g foreman-bot`
- Redpanda Console replaces Slack as the observation plane for bot-to-bot conversations
- Bot runtime is fully decoupled — easy to swap transport later (e.g. AgentCore)
- Eliminates Slack rate limit constraints on bot-to-bot traffic

### Infrastructure
```
docker compose up   # starts Temporal + Redpanda
npm run dev         # starts Foreman (Slack bridge + bot runtime)
```

---

## 19. Kafka-Backed FlowSpec — Enterprise-Scale Bot Communication
- **Status**: Shipped — Kafka transport built in `src/kafka.ts`, bot consumers run on startup (Phase 2 of Foreman 2.0)
- **Concept**: Replace (or augment) Slack as the bot-to-bot communication layer with Kafka, while keeping Slack as the human observation and approval plane. This is the path to scaling FlowSpec beyond what Slack can support, and the natural precursor to deep AgentCore integration.

### The Core Insight
Slack works brilliantly as a development substrate — observable, human-friendly, easy to debug. But it's not an enterprise message bus. Kafka's model maps almost perfectly onto FlowSpec's execution model:
- **Topics = Bot channels.** Each bot gets `betty.inbox` / `betty.outbox`. FlowSpec's `ask @betty` publishes to the inbox, awaits on the outbox.
- **Consumer groups = Parallel dispatch.** `at the same time` is a fan-out to multiple topics — Kafka handles this natively.
- **Log retention = Execution history.** Every message ever sent to every bot is retained. Better than Slack — you can replay, audit, and debug any workflow that ever ran.
- **Bot identity becomes transport-agnostic.** A "bot" is a named topic pair, not a Slack channel. Any process that reads from `betty.inbox` and writes to `betty.outbox` IS Betty — regardless of where it runs.

### Architecture

```
FlowSpec workflow (Temporal)
       ↓
  ask @betty "analyze this PR"
       ↓
  Kafka producer → betty.inbox
       ↓
  Betty's agent consumer
  (AgentCore / Claude session / any LLM)
       ↓
  Kafka producer → betty.outbox
       ↓
  Temporal signal → workflow resumes
```

### Kafka + AgentCore Integration
These two solve different layers and complement each other perfectly:
- **Kafka** = the message bus (routing, delivery, ordering, observability)
- **AgentCore** = the agent runtime (Claude session, tool execution, memory, managed scaling)

A thin **AgentCore trigger consumer** sits between Kafka and AgentCore: reads from `betty.inbox`, calls `InvokeAgent`, publishes response to `betty.outbox`. That's the entire bridge.

AgentCore adds: managed scaling (burst handling for parallel fan-out), session persistence across calls (via session IDs passed in messages), tool execution isolation (microVM), multi-model flexibility (config detail, invisible to FlowSpec).

### The Hybrid Model (Recommended)
Keep Slack for human-facing bots. Move bot-to-bot traffic to Kafka. A mirror consumer publishes simplified summaries to Slack for human observability.

```
dispatchToBot
    ├── Kafka (betty.inbox) → Betty's AgentCore agent (does the work)
    └── Mirror consumer → posts summary to #workflow-log in Slack (humans watch)
```

Humans never read raw Kafka. They watch Slack like today. Execution doesn't go through Slack at all.

### What You Gain Over Slack
- **Scale:** Millions of messages/second. Thousands of concurrent workflows.
- **Replay + time-travel debugging:** Full log retention. Replay any workflow against a debug instance.
- **Schema enforcement:** Avro/Protobuf schemas — malformed outputs caught at the bus level.
- **Multiple consumers per topic:** Logging, monitoring, AND the actual bot all read `betty.inbox` simultaneously.
- **Dead letter queues:** `betty.inbox.dlq` captures failures automatically.
- **Bot pools:** Multiple AgentCore instances consuming from `betty.inbox`. Kafka load-balances. 100 parallel `ask @betty` steps → 100 AgentCore instances.
- **Cross-org workflows:** `betty.inbox` could be a topic on a different cluster. FlowSpec workflows span organizational boundaries via topic routing config.

### Full Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Language | FlowSpec | Describes what happens |
| Orchestration | Temporal | Manages workflow state, waits, retries |
| Message bus | Kafka | Routes messages between agents |
| Agent runtime | AgentCore | Runs Claude sessions with tools |
| Observation | Kafka mirror consumer → Slack | Human-readable execution trace |
| Human gates | Kafka + approval service | `pause for approval` |

### Migration Path
1. `dispatchToBot` already abstracts the transport — swap Slack dispatch for Kafka publish. FlowSpec doesn't change. Compiler doesn't change.
2. Worker bots (pure AI work, no human interaction) migrate to Kafka + AgentCore. Human-facing bots stay in Slack.
3. Slack becomes purely the human gateway and observation plane.

### What You Lose
- Human observability is no longer free (need mirror consumer + dashboard, or Confluent/Redpanda UI)
- `@chris` in FlowSpec needs a separate approval service (not just a Slack DM)

### Managed Options
- **Confluent Cloud** — fully managed Kafka, easy to start
- **AWS MSK** — fits MFP's all-AWS backend, tighter IAM integration

### Rough Effort
3-5 days for basic Kafka transport swap. AgentCore integration is a separate workstream (idea #16).

---

## 18. Pythia — Multi-Model 5-Phase Verification Workflow
- **Status**: Shipped (v1)
- **Files**: `flows/pythia.flow`, `flows/pythia-overview.md`
- **What it is**: A FlowSpec workflow that evolves the Delphi process into a research-grounded, 5-phase, multi-model answer verification system. Named after the priestess who delivered prophecies at the Oracle of Delphi.
- **Research basis**: `delphi/results/delphi-performance-v1-2026-03-27.md` — Delphi performance assessment identifying monoculture as the #1 structural risk and model heterogeneity as the key unlock
- **Bots required**: `@claude-worker` (Claude), `@claude-judge` (Claude), `@gemini-worker` (Gemini), `@gpt-worker` (GPT)

### The 5 Phases

| Phase | What happens | Key design decision |
|---|---|---|
| 1 — Independent Exploration | 3 workers (Claude, Gemini, GPT) answer in parallel with identical prompts | Identical prompts maximize coverage; heterogeneity is the diversity mechanism, not role assignment |
| 2 — Synthesis + Verification | Claude judge receives full reasoning chains, structures agree/disagree/solo-claim analysis, verifies claims | Full chains (not summaries) prevent information loss; self-structured comparison avoids extra hallucination surface |
| 3 — Heterogeneous Critique | 3 critics with different roles: Factual Accuracy (Claude), Completeness (Gemini), Devil's Advocate (GPT) | Cross-model critique reduces sycophancy; differentiated roles target different failure modes |
| 4 — Targeted Revision | Judge patches synthesis — only addresses substantive issues raised | Prevents problem drift (Becker et al. 2025); no full regeneration |
| 5 — Independent Fact-Check | Gemini in fresh session annotates claims: VERIFIED / UNVERIFIABLE / REFUTED | Fresh session = zero debate history influence; append-only = no corruption |

### The Three Failure Modes Addressed
| Failure Mode | Mechanism |
|---|---|
| Incompleteness | Multi-model diversity (Phase 1) |
| Hallucination | Source citations + factored verification (Phases 1, 2, 5) |
| Overconfidence | Adversarial cross-model critique (Phase 3) |

### Invocation
```
/cc run "Pythia" question="How does diary sync work?"
/cc run pythia.flow "Pythia" question="..." mode="research"
```
`mode` defaults to `"code"`. Options: `"research"`, `"design"`.

### Self-Analysis Results (2026-03-29)
Pythia was run against itself. Full results: `pythia/results/pythia-self-analysis-2026-03-29.md`. 22 VERIFIED · 7 REFUTED (minor) · 2 UNVERIFIABLE. All 4 critical findings confirmed.

**Key findings:**
1. **`within`/`retry` are cosmetic** — parsed but never executed by the compiler (dead code)
2. **`{mode}` is unused** — declared as input, never interpolated into any prompt (regression from Delphi)
3. **No concurrency guard** — two concurrent Pythia runs race on Gemini's history map
4. **Parallel branch failures silently drop variables** — failed `allSettled` branches produce empty strings with no signal to downstream steps

### Next steps
- Fix priority 1–4 from self-analysis (see flowspec-status.md for full list)
- Add benchmarking (Tier 1: 30 grep-verifiable questions, automated scoring)
- Register `#pythia-results` as output channel in bots.json
- Run against Delphi on same questions to measure improvement

## 17. LLM Performance Overclocking — Coordinated Reasoning Techniques

- **Status**: Queued
- **Concept**: A FlowSpec-powered framework that coordinates multiple LLM performance enhancement techniques in combination — chain-of-thought, self-consistency, Delphi/debate, Tree of Thoughts, Constitutional AI critique, and scratchpad reasoning — to maximally extract performance from a fixed model without changing the model itself.
- **Core insight**: Delphi is already one form of "overclocking" — multiple instances, adversarial critique, forced convergence. But each technique targets a different failure mode. Combining them is where the real gains are.

### The Techniques

| Technique | What it fixes | FlowSpec primitive |
|---|---|---|
| **Chain-of-thought** | Shallow reasoning — forces step-by-step work | Inject into every `ask` prompt |
| **Self-consistency** | Single-sample variance — run N times, take majority | `at the same time` + judge |
| **Delphi / debate** | Groupthink — adversarial multi-agent critique | Already implemented |
| **Tree of Thoughts** | Premature commitment — explore multiple branches | `at the same time` fan-out + prune |
| **Constitutional AI** | Value drift — model critiques own output against principles | `repeat until` critique loop |
| **Scratchpad / working memory** | Context window pressure — explicit reasoning space | Structured prompt template |
| **Role assignment** | Generic response — "you are an expert in X" framing | Per-bot system prompt |

### The Key Insight
LLMs are **better critics than generators**. Every technique above exploits this asymmetry in some way — generating multiple candidates then filtering is almost always better than generating one "best" answer directly. The question is which combination of techniques to apply for a given problem type.

### Proposed FlowSpec Workflow: `overclocked-answer`

```
workflow "Overclocked Answer"
  inputs: question (required), domain (default "general")

  -- Phase 1: Tree of Thoughts — generate 3 independent reasoning branches
  at the same time
    ask @worker-1 "You are an expert in {domain}. Think step by step. Approach this from first principles: {question}" -> branch_a
    ask @worker-2 "You are an expert in {domain}. Think step by step. Approach this from an empirical/evidence angle: {question}" -> branch_b
    ask @worker-3 "You are an expert in {domain}. Think step by step. Approach this by considering what could go wrong: {question}" -> branch_c

  -- Phase 2: Constitutional critique — each branch critiques another
  at the same time
    ask @worker-1 "Critique this reasoning for logical flaws and unsupported claims: {branch_b}" -> critique_b
    ask @worker-2 "Critique this reasoning for logical flaws and unsupported claims: {branch_c}" -> critique_c
    ask @worker-3 "Critique this reasoning for logical flaws and unsupported claims: {branch_a}" -> critique_a

  -- Phase 3: Self-consistency revision
  at the same time
    ask @worker-1 "Revise your answer given this critique: {critique_a} Original: {branch_a}" -> revised_a
    ask @worker-2 "Revise your answer given this critique: {critique_b} Original: {branch_b}" -> revised_b
    ask @worker-3 "Revise your answer given this critique: {critique_c} Original: {branch_c}" -> revised_c

  -- Phase 4: Judge synthesizes
  ask @judge """
    Three independent expert reasoners have each proposed and revised an answer to: {question}

    Answer A: {revised_a}
    Answer B: {revised_b}
    Answer C: {revised_c}

    Synthesize the strongest elements into a single definitive answer.
    Explicitly note where all three agreed (high confidence) vs diverged (uncertain).
  """ -> final
```

### Selectable "Overclocking Profiles"
Different problem types benefit from different combinations:

| Profile | Best for | Techniques used |
|---|---|---|
| `--fast` | Quick factual questions | Self-consistency (3 samples) only |
| `--deep` | Complex analysis | Full pipeline above |
| `--code` | Code generation | Tree of Thoughts + Constitutional critique |
| `--decision` | High-stakes decisions | Delphi + adversarial debate |
| `--creative` | Open-ended generation | Role diversity + Constitutional polish |

### Relationship to existing Delphi
Delphi (`/cc delphi`) is already a 3-phase version of this. This idea generalizes Delphi into a configurable multi-technique pipeline with selectable profiles. Delphi becomes `--decision` profile.

### Implementation path
1. Build the `overclocked-answer` workflow as a FlowSpec `.flow` file
2. Add `/cc overclock [--profile] "question"` as a Slack command
3. Profiles map to different `.flow` variants
4. Long term: auto-select profile based on question classification

## 16. FlowSpec → AgentCore Compiler Target
- **Status**: Queued
- **Concept**: Add a second compiler target to FlowSpec that generates AgentCore-compatible code instead of Temporal TypeScript. Same FlowSpec DSL, different runtime backend. Viable because FlowSpec is Turing complete — and Turing completeness guarantees mutual translatability between any two Turing complete systems.
- **Invocation**: `flowspec-compiler --target agentcore my-workflow.flow`

### Two-Layer Architecture
The cleanest mapping is **two AWS layers** working together:
- **Orchestration layer**: AWS Step Functions — handles sequencing, branching, loops, parallel fan-out
- **Bot invocation layer**: AgentCore — handles the actual AI agent calls (replaces Slack-based Claude Code bots)

```
FlowSpec DSL
    ↓ compile
Step Functions (orchestration)
    ↓ per step
AgentCore InvokeAgent (AI execution)
```

### Compilation Mapping

| FlowSpec | AgentCore/Step Functions equivalent |
|---|---|
| `ask @bot "..."` | AgentCore `InvokeAgent` (Bedrock model + tools) |
| `at the same time` | Step Functions Parallel state |
| `at the same time, take the first` | Parallel state + early exit via EventBridge |
| `for each X in {list}` | Step Functions Map state |
| `if / otherwise` | Step Functions Choice state |
| `call "Workflow"` | Nested Step Functions execution |
| `pause for approval` | Step Functions `.waitForTaskToken` + SNS notification |
| `notify` | SNS/EventBridge event |
| `retry N times` | Step Functions retry policy |
| `within <duration>` | Step Functions timeout config |
| `stop` | Step Functions Succeed/Fail state |

### What you gain vs Temporal
- **Fully managed** — no self-hosted Temporal server
- **AWS security/IAM baked in** — Cedar policy integration (idea #15) fits naturally as IAM policies
- **Auto-scales** — no worker process to manage
- **Enterprise ready** — audit logs, CloudWatch, X-Ray tracing out of the box
- **MFP alignment** — MFP backend is entirely AWS; this keeps everything in one ecosystem

### What you lose vs Temporal
- **No full Claude Code sessions** — AgentCore agents are Bedrock model invocations, not persistent sessions with filesystem access, plugins, or tools beyond what Bedrock provides
- **No Slack visibility** — agents live in AWS, not in inspectable Slack channels
- **No `/cc run` from Slack** — needs API Gateway or Lambda trigger
- **Less debuggable** — can't watch a bot "think" in its Slack channel in real time

### When to use which target
| Use Temporal | Use AgentCore |
|---|---|
| Deep code tasks (need filesystem, shell, plugins) | Enterprise/regulated environment |
| Want Slack visibility into each bot's work | Fully managed infra preferred |
| Rapid iteration / local dev | MFP production deployment |
| Human-in-the-loop via Slack buttons | AWS-native security model |

- **Test path**: Get AWS Bedrock access → build trivial single-step compiler → test `ask @agent "What is 2+2?"` → compare DX vs Temporal
- **Prerequisite**: AWS account with Bedrock + AgentCore access

## 15. Cedar Policy Integration for FlowSpec
- **Status**: Queued
- **Concept**: Add a `policy:` block to FlowSpec workflows that references a Cedar policy file. The FlowSpec runtime loads the policy at workflow start and enforces it on every tool call made by every bot in the workflow — without the workflow author needing to think about it.
- **Syntax**:
  ```
  workflow "Deploy Feature"
    policy: "mfp-deploy-policy.cedar"
    ask @clive "Build and test {branch}" -> result
    ask @betty "Deploy {branch} to staging"
  ```
- **How it works**:
  1. Workflow starts → loads named `.cedar` policy file into memory
  2. Every `ask` passes the policy to `dispatchToBot`
  3. `dispatchToBot` intercepts each tool call from the Claude session and evaluates it against the policy before allowing execution
  4. Violations are blocked and logged
- **Why**: Non-engineer writes the workflow. Security team writes the Cedar policy. They are completely independent. A PM cannot accidentally create a workflow that deletes production data.
- **vs AgentCore**: AgentCore's policies live separately in AWS. FlowSpec's policies are declared in the workflow itself — visible, versioned, and auditable alongside the workflow code.
- **Key challenge**: Foreman must intercept Claude Code tool calls and validate them against Cedar at runtime. This is real infrastructure work.
- **Cedar**: Open source policy language from AWS. Natural language → Cedar is supported. Policies are human-readable.

## 14. Kafka as FlowSpec Message Bus
- **Status**: Shipped (superseded by #19 — actual topic naming is `{botName}.inbox` / `{botName}.outbox`)
- **Concept**: Replace (or augment) Slack as the communication bus between FlowSpec bots with Kafka. Currently `dispatchToBot` posts to a Slack channel and polls for the response — Kafka would make this faster, more durable, and more scalable.
- **Architecture**:
  - One topic per bot: `foreman.bot.{channelId}.in` (prompts) and `foreman.bot.{channelId}.out` (responses)
  - `dispatchToBot` publishes to `.in`, subscribes to `.out`, awaits response
  - Foreman index.ts adds a Kafka consumer alongside the existing Slack Socket Mode listener
  - Slack retained for human-in-the-loop steps and observability (humans still see bot channels)
- **npm package**: `kafkajs`
- **Observability**: Kafka UI, Conduktor, or AKHQ for watching messages flow in real-time (similar to watching Slack channels)
- **Config**: `~/.foreman/config.json` gets a `kafka` block — Slack remains default, Kafka opt-in
- **FlowSpec impact**: Zero — `dispatchToBot` is the only change; FlowSpec DSL doesn't change
- **Managed options**: Confluent Cloud or AWS MSK (fits MFP's all-AWS backend)
- **Rough effort**: 2-3 days

## 13. Back Up Ideation/Memory Files to Git
- **Status**: Done (2026-04-08) — memory files migrated to `docs/memory/` in the Foreman repo, version-controlled and pushed.
- **Original concept**: The `~/.claude/projects/.../memory/` files (dev-ideas.md, project_mfp_sync.md, etc.) lived outside any git repo. If the Mac dies or the directory is wiped, all accumulated context is gone.
- **Solution**: Add a git repo to the memory directory (or a dedicated `~/foreman-memory` repo), commit the markdown files, and push to GitHub (private repo). Could be as simple as a cron or post-session hook that auto-commits and pushes.
- **Options**:
  1. `git init` in the memory dir, push to a private GitHub repo
  2. Symlink memory files into `claude-slack-bridge/memory/` so they're versioned with the project
  3. Foreman hook: after each session ends, auto-commit + push
- **Why**: Catastrophic recovery. These files represent hours of design thinking that can't be recovered from code or git history.

## 12. MFP iOS App Crawler / Sitemap Generator
- **Status**: Queued
- **Concept**: Tell a Foreman Claude bot to autonomously crawl the MFP iOS app running in the simulator and produce a complete sitemap — a screenshot of EVERY unique screen, its accessibility tree, and a directory structure that mirrors the app's navigation hierarchy. No script needed — the bot uses its existing Bash + AXe tools directly.
- **Tools used**: AXe CLI (describe-ui, tap, swipe-from-left-edge), xcrun simctl (screenshots), Bash, Write
- **Output structure**:
  ```
  ~/mfp-sitemap/
  ├── sitemap.json              ← index of all screens
  ├── .crawler-state.json       ← resumability state
  ├── Home/
  │   ├── screenshot.png        ← screenshot of EVERY screen
  │   ├── accessibility-tree.json
  │   ├── screen.json           ← metadata (id, breadcrumb, nav title, etc.)
  │   ├── Dashboard/
  │   │   ├── Log_Food/
  │   │   └── Exercise/
  │   └── Settings/
  ```
- **How it works**:
  1. `describe-ui` → read current screen's accessibility tree
  2. Take screenshot → save to current node's directory
  3. Fingerprint the screen → check if already visited (see below)
  4. Save screenshot + tree + metadata to directory
  5. Find tappable elements (up to MAX_TAPS per screen)
  6. For each unvisited tappable → tap → wait → recurse → swipe-back → verify back
- **Fingerprinting strategy** — identifies screen TEMPLATES not instances (100% automated):
  - Primary: `navTitle + activeTab + layoutType + sorted(accessibilityIdentifiers)`
  - `accessibilityIdentifiers` (AXIdentifier) are set by developers for UI testing — stable regardless of content
  - `layoutType` = search / list / grid / detail — derived from element roles, not counts
  - Dynamic IDs filtered out (contain 4+ digits or UUID patterns)
  - Result: SHA-256 hash → 16-char fingerprint
  - Two "Food Detail" screens for different foods → same fingerprint (template match) ✓
- **Why NOT element counts**: MFP has premium/free tiers, A/B tests, connected devices, user preferences, onboarding state — element counts vary wildly on the same screen template
- **Safety bounds**:
  - Max depth: 8 levels
  - Max tappable elements per screen: 10 (prioritized: tabs > buttons > cells)
  - Max total screens: 400
  - Skip destructive labels: delete, remove, sign out, log out, clear, reset
  - For list cells: only tap FIRST cell per label type (prevents tapping 100 food items)
  - Keyboard/alert detection: dismiss before continuing
  - Resumable: saves state to `.crawler-state.json` every 5 screens
- **Hard cases (the 20%)**:
  - State-dependent screens (only after logging food/workout)
  - Screens behind paywalls or feature flags
  - Screens requiring data entry to proceed
  - Very deeply nested flows beyond depth limit
- **Goal**: 80% automated coverage of all screens — a visual photo album + accessibility map of the entire app, useful for onboarding engineers AND AI bots working on the codebase
- **To run**: Point a Foreman bot at any working directory, boot the MFP simulator and log in, then give the bot the crawl prompt below

### Crawl Prompt

```
Crawl the entire MFP iOS app running in the simulator and build a detailed sitemap.

For each unique screen:
1. Take a screenshot and save it
2. Save the accessibility tree as JSON
3. Save a screen.json with metadata (name, depth, breadcrumb path, nav title, how to reach it)

Organize everything in a directory structure that mirrors the app's navigation — each screen gets its own folder, nested inside its parent screen's folder. Save to ~/mfp-sitemap/

**Navigation tools:**
- `axe describe-ui` — read the current screen's accessibility tree
- `axe tap --label "X"` or `axe tap --id "X"` — tap an element
- `axe swipe-from-left-edge` — go back to the previous screen
- `xcrun simctl io booted screenshot ~/mfp-sitemap/<path>/screenshot.png` — take a screenshot

**Fingerprinting — identify screen TEMPLATES, not instances:**
Compute a fingerprint for each screen: nav bar title + active tab name + layout type (list/grid/detail/search) + sorted list of AXIdentifier values (ignore any ID containing 4+ consecutive digits or UUID patterns). SHA-256 hash the result, take 16 chars. Only explore each unique fingerprint once. Two "Food Detail" screens for different foods should match — that's correct.

**Safety bounds:**
- Max depth: 8 levels
- Max tappable elements per screen: 10 (prioritize: tab bar items > buttons > first cell of each list section)
- Max total screens: 400
- Skip any element whose label contains: delete, remove, sign out, log out, clear, reset
- For list cells: only tap the FIRST cell per unique label/section type (never tap 100 food items)
- If a keyboard appears: dismiss it (tap Done or swipe down) before continuing
- If an alert/modal appears: tap Cancel or the non-destructive option, then continue
- Save crawler state to ~/mfp-sitemap/.crawler-state.json every 5 screens (for resumability)

**After each screen:**
- Swipe back to return to the parent screen
- Verify you're back (describe-ui, check nav title matches expected parent)
- Continue to the next tappable element

When done, write ~/mfp-sitemap/sitemap.json — a flat index of every screen found, with: id, name, breadcrumb path, fingerprint, screenshot path, depth, and how to reach it (the tap sequence from home).
```

## 11. MFP iOS Sync Replacement — Architecture Options
- **Status**: Exploring — 2 options under consideration
- **Constraints**: (1) offline-first reads AND writes, (2) automatic sync with no client sync code, (3) mobile devs write GraphQL not SQL
- **Context**: QueryEnvoy is abandoned. Backend is entirely on AWS. Local mobile DB is ~60 tables.

### Option A: PowerSync (bidirectional) + Apollo Client + Postgres bridge
- **Local store**: SQLite — keeps existing schema, no local DB migration
- **Sync engine**: PowerSync is **bidirectional**. Reads and writes both go through local SQLite. Writes are queued by PowerSync and uploaded to the backend automatically when online.
- **Backend bridge**: PowerSync syncs to **Postgres** (its native target). A backend process keeps each of 16 Postgres shards in sync with the corresponding MySQL shard. MySQL remains source of truth.
- **GraphQL**: Apollo Client wraps the local SQLite as a GraphQL layer. iOS devs write GraphQL queries/mutations against Apollo; Apollo routes them to local SQLite via `@client` resolvers. No AppSync needed on the read/write path — Apollo is purely a local GraphQL interface.
- **Architecture**:
  ```
  iOS SQLite  ←──  PowerSync  ←──→  Postgres (1 of 16)  ←──→  MySQL shard
       ↕
  Apollo Client (@client resolvers)
       ↕
  iOS developer writes GraphQL
  ```
- **Read flow**: `Apollo @client query → local resolver → PowerSync SQLite (always offline)`
- **Write flow**: `Apollo @client mutation → PowerSync SQLite (instant) → PowerSync upload queue → Postgres → MySQL`
- **Pros**: Preserves existing SQLite schema. Bidirectional sync handled automatically. iOS devs use GraphQL, never raw SQL. Offline-first reads AND writes.
- **Cons**: Postgres-to-MySQL bridge is a new backend component to build/maintain. Local Apollo resolver layer requires upfront work (~60 tables). PowerSync Swift SDK recently reached GA (early 2025) — relatively new.
- **Key unknown**: Scale and performance of PowerSync across 16 shards with large user base.

### Option B: AWS Amplify DataStore + AppSync + DynamoDB bridge
- **Local store**: Amplify DataStore (manages its own local DB — replaces existing SQLite)
- **Sync**: Fully automatic — DataStore syncs with AppSync/DynamoDB in background, offline writes queued, conflict resolution built in
- **GraphQL**: Amplify generates Swift model classes from GraphQL schema. Devs use Swift objects — no raw SQL, no query strings.
- **Architecture**:
  ```
  iOS (Amplify local DB)  ←──→  AppSync  ←──→  DynamoDB (1 of 16)  ←──→  MySQL shard
  ```
- **Read flow**: `Amplify.DataStore.query() → local store (always offline)`
- **Write flow**: `Amplify.DataStore.save() → local store (instant) → AppSync → DynamoDB → backend sync → MySQL`
- **Pros**: One unified framework handles everything. Cleanest developer experience. AWS-native end to end. DynamoDB is AppSync's native target — no Lambda bridge needed on the sync path.
- **Cons**: Replaces local SQLite entirely (migration required for ~60 tables). Backend process needed to sync DynamoDB → MySQL (same pattern as Option A's Postgres → MySQL bridge). More opinionated/less flexible.
- **Backend**: AWS AppSync + DynamoDB, with a backend sync process → MySQL shards

### Comparison
| | Option A | Option B |
|---|---|---|
| Offline reads | ✅ | ✅ |
| Offline writes | ✅ | ✅ |
| Auto sync | ✅ | ✅ |
| GraphQL for devs | ✅ | ✅ |
| Keeps existing SQLite | ✅ | ❌ |
| Cloud sync target | Postgres | DynamoDB |
| MySQL bridge | Postgres→MySQL (backend) | DynamoDB→MySQL (backend) |
| Migration risk | Low (SQLite stays) | Medium (new local DB) |
| AWS-native | ✅ | ✅ |

## 10. Delphi Phase Status Improvements
- **Status**: Queued
- **Concept**: Make phase status banners more informative by reflecting what just happened and what's next
- **Example**: After workers finish, instead of just showing the next phase banner, show something like:
  - `✅ Workers done — assessing answers...`
  - `✅ Judge verified — sending critiques to workers...`
  - `✅ Critiques done — writing final answer...`
- **Goal**: A PM watching the judge channel can follow the workflow progress without knowing the internals


## 8. Bot Delegation DSL (Recursive Agent Chaining)
- **Status**: Queued
- **Concept**: A minimal language for bot-to-bot delegation with only 2 primitives:
  1. A **statement** — a prompt directed at a bot ("Do X")
  2. A **statement about a statement** — a meta-instruction whose content is another prompt ("Tell Bot A to do X")
- **Key insight**: Primitive 2 is itself a Primitive 1 — it's a prompt to Bot B whose content is a prompt for Bot A. This nests infinitely: "Tell Bot C to tell Bot B to tell Bot A to do X"
- **What's missing**: `PostMessage` only posts — it doesn't *trigger* the receiving bot. Need a `DispatchMessage` tool that both posts the message AND calls `processChannelMessage` directly (like `/cc message` does today, but available as a tool bots can call themselves)
- **What to build**: `DispatchMessage` tool in foreman-toolbelt — takes `channel` + `text`, posts visibly AND triggers the session
- **Prior art / related systems**:
  - **LangGraph** — closest conceptual match. Nodes are LLM agents, edges are transitions, nodes can spawn sub-graphs. But agents run *in-process* as API calls, not as full isolated sessions.
  - **CrewAI** — "crews" of agents with roles/goals/tasks. Hierarchical mode = manager delegates to workers (same as Delphi). Built on LangGraph concepts.
  - **Temporal** — durable workflow-as-code (Go/TS/Python). "Activities" + "Workflows" that can spawn sub-workflows. Infrastructure-level, not AI-native.
  - **AWS Step Functions** — JSON/YAML state machine DSL. Fan-out, fan-in, wait states built in.
  - **Key differentiator**: All of the above run agents in-process. Foreman's agents each have their own Slack channel, filesystem/cwd, model, plugins, and full Claude Code session — far more powerful and inspectable.
- **Two distinct layers (important distinction)**:
  1. **Workflow Language** — a human-readable DSL to *describe* a workflow (the "what"). Non-developers can write it. Declarative, focused on intent, not mechanics.
  2. **Workflow Platform/Runtime** — executes the language (the "how"). Handles dispatch, polling, timeouts, errors. Foreman is already partially this.
- **Key insight**: These layers should be separate. Right now Delphi is a hardcoded workflow with no language — changing it requires TypeScript. A DSL would let you describe workflow variations without touching code. Analogy: SQL is the language, Postgres is the platform.
- **Compilation approach**: The language should compile/transpile to a target runtime (Temporal, LangGraph, Foreman, etc.), making it portable. Claude could serve as both *author* (help write the workflow DSL) and *compiler* (translate it to executable code). This separation — language + compiler + runtime — is not something any existing tool does today.
- **Target audience**: A PM or non-engineer should be able to write this. Not Python, not YAML — something closer to natural language with minimal structure.
- **Proposed syntax** (sketch):
  ```
  # Parallel — both bots run at the same time
  [bot1] Checkout Jira ticket 1234 and implement it
  [bot2] Checkout Jira bug ticket 4321 and fix it and submit a PR

  # Sequential — bot1 must finish before bot2
  [bot1] Implement feature from JIRA-1234
  [bot2] Review bot1's PR and approve or request changes

  # Fan-out then converge
  [bot1, bot2, bot3] Research options for replacing the sync layer
  [judge] Verify the worker answers and produce a final recommendation

  # Loop
  [bot1] Check JIRA project MFP for all open bugs tagged "crash"
          → for each ticket: fix it and submit a PR

  # Conditional
  [bot1] Run the test suite
          → if failing: open a Jira ticket with the failure details
          → if passing: tag the build as ready for QA
  ```
  Key conventions: `[agent]` = assignment, indented `→` = control flow, plain English = the task.
- **Closest existing analogies**:
  - **GitHub Actions YAML** — closest *feel* for the DSL layer: declarative, readable, explicit parallel/sequential, named agents, data flow between steps. Not AI-native.
  - **LangGraph** — closest for the *runtime* layer: graph of agent nodes, typed shared state, parallel fan-out via `asyncio.gather`, conditional edges, cycles. But it's Python — not readable by a non-engineer.
  - **Gap**: Nothing combines (1) human-readable DSL + (2) AI-native primitives + (3) reliable runtime. That's the opportunity.
- **Workflow patterns to support** (Delphi is just one example):
  - **Broadcast/Synthesize** (Delphi): N bots answer the same question → judge synthesizes
  - **Map**: For each item in a dataset, assign a *different* task to a different bot (e.g. "for each open bug ticket in Jira, assign to a bot and fix it")
  - **Map-Reduce**: Map as above, then aggregate/summarize results
  - **Pipeline**: Bot A output → Bot B input → Bot C input (sequential chain)
  - **Conditional**: If Bot A finds X, dispatch to Bot B, else Bot C
  - **Event-driven**: When a new Jira ticket is created, auto-assign to a bot
  - **Loop**: Keep iterating until a condition is met (e.g. all tests pass)
- **Map pattern requirements** (not in Foreman today): data source connectors (Jira, GitHub), dynamic bot pool management, unique task per bot, writing results back to the source, state tracking across many parallel bots
- **Scope**: This is a platform-level product — a general-purpose AI workflow automation layer where Foreman bots are the workers. The Jira bug-fix workflow is the canonical non-Delphi example to design against.

## 7. Skill Injection for OpenAI & Gemini Adapters
- **Status**: Queued
- **Concept**: When the OpenAI or Gemini adapter is active, automatically inject the content of relevant SKILL.md files into the system prompt — the same way the Anthropic adapter does via Claude Code's skill system
- **How**: Read `~/.claude/skills/*/SKILL.md` at session start, append to system prompt for non-Anthropic adapters
- **Benefit**: Skills like `ios-simulator-axe` would work across all 3 adapters without manual instruction
- **Note**: Could optionally filter which skills to inject based on cwd or session config

## 6. Multi-Bot Discussion Channel
- **Status**: Queued
- **Concept**: Two Foreman bots (Bot A, Bot B) can discuss a topic in a shared neutral channel via a "moderator" bot
- **Architecture**:
  - `#discussion` channel has a Foreman bot in **moderator mode** — it's a member (so the app can read/post) but never auto-responds
  - Bot A and Bot B live in their own channels with their own cwd/model
  - Either bot can read `#discussion` (via Slack MCP `slack_read_channel`) and post to it (via `PostMessage`)
  - User manually orchestrates: "hey Bot A, read #discussion and respond there"
- **What needs building**:
  - `moderator` flag in `SessionState` (boolean, persisted)
  - `/cc moderator on/off` command
  - Message handler skips processing if `state.moderator === true`
- **Future**: Bot-to-bot automation via bot_id whitelisting (no `bot_id` filter for trusted Foreman instances)
- **Goal**: Eventually enables a "Virtual Chris" orchestrator directing specialized sub-agents


## 4. Live Progress Updates
- **Status**: Fully shipped and tested
- **Concept**: Post real-time status messages to Slack as Claude works on long tasks
- **How**: `PreToolUse` hooks in the Agent SDK fire for every auto-approved tool call; `canUseTool` is NOT called for read-only tools so hooks are the right mechanism
- **Files changed**: `claude.ts` (added `OnProgress` type, `buildProgressHooks()`, threaded through `startSession`/`resumeSession`), `slack.ts` (added `formatProgress()` helper, passes `onProgress` to sessions)

## 3. Plugin Slash Command Passthrough
- **Status**: Fully shipped and tested
- **Concept**: Allow Claude plugin slash commands (e.g. `/freud:pull main`) to be invoked from Slack using `!` prefix instead of `/`
- **How**: In `slack.ts` message handler, messages starting with `!` are converted to `/` before passing to Claude Agent SDK
- **Example**: `!freud:pull feature-branch` → `/freud:pull feature-branch`

## 2. Architecture Injection
- **Status**: Queued
- **Concept**: Inject Foreman system architecture into every Claude session so each bot understands the full system
- **Approach**: Option B — ship a default `~/.foreman/ARCHITECTURE.md`, copy it during `foreman init`, inject into system prompt append in `claude.ts`
- **Benefit**: Every Foreman bot becomes a Foreman architect out of the box

## 1. Foreman Self-Reboot
- **Status**: Fully shipped and tested
- **Project**: `~/claude-slack-bridge`
- **Concept**: `/cc reboot` command that gracefully shuts down the Foreman server and restarts it
- **Approach**: launchd with `KeepAlive: true` auto-restarts the process after `/cc reboot` calls `process.exit(0)`
- **Changes made**:
  - `src/slack.ts`: Added `case "reboot"` — responds with ":recycle: Rebooting...", then exits after 1.5s delay
  - `~/Library/LaunchAgents/com.foreman.bot.plist`: Created with KeepAlive, RunAtLoad, ThrottleInterval=5, logs to `~/.foreman/`
  - Help text updated to include `/cc reboot`
  - Project built successfully
- **To activate**: `launchctl load ~/Library/LaunchAgents/com.foreman.bot.plist`
- **To deactivate**: `launchctl unload ~/Library/LaunchAgents/com.foreman.bot.plist`
