# MFP AI Transformation — S3 Demo Briefing

## Purpose

This document brings a new collaborator up to speed on the MyFitnessPal AI Transformation initiative, its current status, key players, architecture, and the September 2026 E2E demo target.

For a full catalog of every related document, Confluence page, Jira ticket, and external resource, see the companion [Resource Index](resource-index.md).

---

## Executive Summary

MyFitnessPal (owned by **Francisco Partners**) is undergoing an AI Transformation from **S1** (AI as assistant) to **S3** (multi-agent orchestration) by **September 2026**. This is a board-level deliverable for FP, who measures all ~195 portfolio companies on an S0–S3 AI Maturity Model (the [SDLC Evolution Framework](https://sites.google.com/myfitnesspal.com/portal/ai-maturity)).

The core thesis: **"Coding is cheap. Shipping with confidence is the constraint."**

The September demo must show an end-to-end pipeline: **Requirements → Build → Test → Review → Deploy** with **<2 human touchpoints**, across multiple platforms.

---

## Where Everything Lives

All AI Transformation documentation is centralized in the **AT (AI Transformation) Confluence space**: [AT space overview](https://myfitnesspal.atlassian.net/wiki/spaces/AT/overview).

Key pages in the AT space:

| Page | Purpose |
|------|---------|
| [Sequenced Execution Plan](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127909658631) | The 6-wave roadmap with dates, gates, and checkpoints |
| [Agentic Pipeline North Star](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127947014150) | Vision doc — the 10-step pipeline, zones, S-level definitions |
| [Pipeline Team Charter](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127934234627) | Operating model, decision authority, communication cadence |
| [Golden Path Proposal](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127873187851) | Five-phase process from idea to production |
| [Relevant Documents](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127915556885) | Hub linking to external docs (Google Docs, FP materials) |
| [Decision Register, Risks & Dependencies](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127918211091) | Governance — decisions, risks, dependencies (template exists, not yet populated) |
| [5 Key Metrics](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127915394059) | Cycle time, PR throughput, median PR review time, test coverage %, escaped defects |
| [MFP Engineering SDLC](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127931449357) | Current engineering SDLC documentation |
| [Jira, Confluence & Flow of Work](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127939903511) | How work is tracked and organized |
| [Teammates](https://myfitnesspal.atlassian.net/wiki/spaces/AT/pages/127961235468) | Pipeline Team members |

Additional AI-related pages live in the **ENG** space, including the [Android Golden Path Pipeline Design](https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127938691073), [AI Infrastructure Research](https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127963922477), [AI Ticket Harness Architecture](https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127937806346), and the [Foreman, FlowSpec & Pythia onboarding summary](https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127963955247).

Jira work is tracked in the **TECHOPS** project under initiatives TECHOPS-2204 (Wave 1), TECHOPS-2197 (Wave 2), and TECHOPS-2210 (Wave 3).

---

## The AI Maturity Model (S0–S3)

Francisco Partners uses an [SDLC Evolution Framework](https://sites.google.com/myfitnesspal.com/portal/ai-maturity) that measures AI maturity across 7 phases, from S0 to S4. MFP's target is S3.

| Level | Description | MFP Status |
|-------|-------------|------------|
| **S0** | No AI usage | Past (2024) |
| **S1** | AI as assistant — devs use Claude Code, Copilot to work faster. AI suggests code, helps write tests, drafts PRs. Developer drives every decision. | Current baseline. Uneven adoption — some devs daily, many not yet. |
| **S2** | Single-agent autonomous — agent takes a spec, writes code, runs tests, checks standards, opens a PR, iterates on feedback without a human in the middle. | In progress — Waves 2-4 |
| **S3** | Multi-agent orchestration — specialized agents (Planning, Coding, Testing, Standards, Security, Orchestrator) coordinate across the full workflow with <2 human touchpoints. | Target by September 2026 |

### What S2 Requires
- Tests that actually catch regressions (80% coverage gate)
- Linters and standards that are codified, not tribal
- Security scanning that runs automatically
- CI that produces clear pass/fail signals
- Constitution files (CLAUDE.md) that tell agents how to work in each repo
- Reproducible environments where agents can build and test without human help

### What S3 Requires (everything in S2, plus)
- Agent-to-agent communication protocols
- Cross-platform integration testing
- Decomposable requirement contracts
- An orchestration layer
- Extraordinary trust in the system — earned through Waves 1-5

---

## The 10-Step Agentic Pipeline

Every feature follows a journey from idea to production. The goal is to automate the middle — the **Autonomous Zone** — while keeping humans where they matter most.

| Zone | Step | Today | Target State |
|------|------|-------|-------------|
| **Human Input** | 1. Ideation | Human conceives the idea | Human conceives the idea |
| | 2. Task Definition | Human writes the ticket | Human writes structured spec; AI helps refine |
| | 3. Planning | Human creates implementation plan | Human approves AI-generated plan |
| **Autonomous Zone** | 4. Build | Human writes code with AI assist | Agent writes code from spec |
| | 5. Test | Human runs tests, manually QAs | Agent runs tests, interprets results, iterates |
| | 6. Standards | Human checks style, conventions | Agent checks against codified standards |
| | 7. Security | Human reviews (or doesn't) | Agent runs automated security checks |
| | 8. Integration | Human opens PR, monitors CI | Agent opens PR, monitors CI, iterates on failures |
| **Human Output** | 9. Review | Human reviews PR | Human reviews agent-authored PR (or auto-merge for low-risk) |
| | 10. Release | Human approves deploy | Human approves deploy |

The Autonomous Zone is a **loop**, not a straight line. When tests fail, code goes back to Build. When standards are violated, code goes back to Build. These feedback loops only work if each step produces a **machine-readable pass/fail signal**. Building that signal surface is the Pipeline Team's primary job.

---

## The Pipeline Team

| Role | Person |
|------|--------|
| **Sponsor** | Allen Cox (VP Tech Ops) |
| **Lead** | Tyler Talaga |
| **iOS Platform Rep** | Chris Shreve (Senior iOS Engineer, Prod Eng — POW) |
| **Team Size** | 8 people, full-time |
| **Duration** | March 25 – September 25, 2026 |
| **Primary Tool** | Claude Code (chosen per Jason Peterson, 3/19) |

### Other Key Contributors

| Person | Focus |
|--------|-------|
| Harley Nuss | Constitution files & AI test coverage across repos (query-envoy, premium-bravo, logging, campaign-bridge, mealapp-server) |
| Aditya Purandare | AWS cross-account connectivity for AI infrastructure |
| Richard Boneff-Peng | Agent-optimized CLAUDE.md documentation patterns |
| Cory Bailey | Android AI test generation |
| Lejla Prijic | Slackbot K8s deployment |

---

## 6-Wave Execution Plan

### Wave 1: Foundation (Mar 16 – Mar 28)
**Goal: Establish the foundation everything else builds on.**
- Confirm volunteer owners, prepare Jira & Confluence
- Communicate preferred toolset (Claude Code) and training plan
- Create Pipeline Team, begin defining Golden Paths (platform-specific: iOS, Android, Backend)
- Assign three pilot squads to begin daily Claude Code usage
- Ensure 5 key metrics tracked across squads
- **Checkpoint:** Wave 1 complete

### Wave 2: Build S1 Muscle (Mar 30 – Apr 18)
**Goal: Build the practices that gate S2.**
- **AI-generated test coverage** (TECHOPS-2187) — HARD GATE for S2
- Automate AI pre-review (make Claude PR review mandatory and consistent)
- Shift review from line-by-line to outcome-based
- Constitution files Tier 2 rollout (~30-40 repos)
- Evaluate reproducible dev environment — can an agent clone, build, and test without human help?
- Ensure Golden Path is working
- **Checkpoint:** 30% of engineers are Daily Active Users
- **Current status (late March 2026):** Wave 2 starting. TECHOPS-2187 in progress (Chris Shreve).

### Wave 3: Build S2 Infrastructure (Apr 20 – May 15)
**Goal: Build the infrastructure S2 practices need.**
- Extend SonarQube coverage gates to all active repos — HARD GATE
- Build agent infrastructure: VPN for CI, service account tokens (agents can't SSO), sandbox execution policy, cost alerting, audit logging — HARD GATE
- Formal AI training (DevClarity): Foundations 4/28-4/30, Deep Dives 5/5-5/7
- Complete constitution file rollout (all active repos)
- Resolve reproducible dev environment gaps
- **Checkpoint:** 50% DAU, 100% repos have AI context, agent infra operational, SonarQube on all Tier 1

### Wave 4: Demonstrate S2 Practices (May 18 – Jun 12)
**Goal: Demonstrate agents can work autonomously. The paradigm shift happens here.**
- Self-Verifying Agent Loop demonstrated on at least one repo
- First agent-authored PR merged without human mid-loop
- OpenSpec Pilot — agents consuming structured specs
- Experiment monitoring and production alerts wired into agent context
- **Checkpoint:** 80%+ DAU, first autonomous agent PR merged

### Wave 5: Demonstrate S2 Maturity (Jun 15 – Jul 18)
**Goal: S2 is the default way of working, not an experiment.**
- Tiered review policy (auto-merge criteria for low-risk)
- Reliable pre-prod environment for agent validation
- AXe + simulator loop for iOS
- Decomposable requirement contracts (sets up S3)

### Wave 6: Demonstrate S3 Emergence (Jul 20 – Aug 28)
**Goal: Multi-agent coordination demonstrated end-to-end.**
- Agent topology design
- Multi-agent pilot (e.g., iOS + backend agents coordinating on a single feature)
- Cross-agent integration testing
- System-level quality validation
- Multi-component orchestration (deploy)
- Production feedback loops
- **Checkpoint: E2E Orchestration Demo** — the 6-month proof point for FP

---

## What the Pipeline Team Builds

The team builds **shared infrastructure**, not features:

- **AI Context Infrastructure** — Constitution files (CLAUDE.md), skills, coding standards, spec templates. Explicit knowledge replacing tribal knowledge.
- **Quality Gate Infrastructure** — SonarQube, linting, security scanning, test coverage gates. Machine-readable pass/fail signals.
- **Agent Infrastructure** — VPN, service account tokens, sandbox execution policies, cost alerting, audit logging. Practical plumbing for agent access to internal systems.
- **The Golden Path** — Documented end-to-end process from idea to production, with platform-specific variations.
- **Observability** — Dashboards tracking the 5 strategic metrics across squads over time.

---

## FlowSpec — The S3 Orchestration Layer

**FlowSpec** is a Turing-complete, PM-writable workflow description language for orchestrating AI bots. It was designed by AI, for AI — 6 agents across Claude, Gemini, and GPT designed it through 3 rounds of adversarial debate via the Delphi process. It lives in the Foreman (claude-slack-bridge) codebase.

### Why It Matters

The 6-Wave Execution Plan assumes the orchestration layer gets built in Waves 5-6. **FlowSpec Phases 1-4 are already done.** This means the S3 orchestration layer exists today — it could significantly accelerate the timeline.

Chris demonstrated a **working S3 prototype** to leadership on 3/20 at the All Hands (Loom videos recorded 3/13). His assessment: *"S3 is not 6 months away."*

### Technical Details

- **Location**: `claude-slack-bridge/` repo — docs in `docs/flowspec.md` and `docs/flowspec-reference.md`, source in `src/flowspec/`
- **Status**: Phases 1-4 complete (~1,160 lines TypeScript)
- **Architecture**: `.flow` file → Parser → AST → Compiler Backend → Target Platform
- **Runtime**: Currently Temporal (self-hosted locally). AWS AgentCore port in progress.

### 12 Primitives

| Primitive | Description |
|-----------|-------------|
| `ask` | Start a full Claude session on a bot and wait for response |
| `send` | Fire-and-forget message (no AI session triggered) — for status updates and notifications |
| `at the same time` | Parallel fan-out (wait for all) |
| `race` | Parallel, first-to-finish wins (with cancellation) |
| `for each` | Bounded iteration over a collection |
| `repeat until` | Convergence loop with exit condition |
| `if / otherwise` | Conditional branching (supports `contains`, `equals`, `means`) |
| `pause for approval` | Human-in-the-loop gate |
| `within` | Timeout |
| `retry N times / if it fails` | Error handling |
| `run` | Invoke a sub-workflow (enables Turing completeness) |
| `stop` | Halt execution |

**Critical distinction — `ask` vs `send`:** `ask` starts a full Claude session and waits for a response. `send` just posts a text message — no AI session is triggered. Use `ask` to make a bot do work; `send` for status updates and notifications.

The **`means` operator** hides prompt engineering from PMs — a key UX differentiator. PMs write natural-language workflow files; the compiler handles the rest.

### Current Backend & Portability

FlowSpec currently compiles to **Temporal** (TypeScript). The AST is platform-independent, so new backends are ~300-500 lines each.

| Backend | Coverage | Effort | Priority |
|---------|----------|--------|----------|
| Temporal (TypeScript) | MFP + advanced eng orgs | Done | Done |
| AWS Step Functions | ~50%+ of FP portfolio | ~2 weeks | 1st |
| Azure Durable Functions | ~20-25% of portfolio | ~2 weeks | 2nd |
| LangGraph (Python) | Greenfield AI companies | ~2-3 weeks | 3rd |

**Total for top 3 new backends: ~6-7 weeks for ~80-90% FP portfolio coverage.**

### Wave 2 Task Coverage

8 of 17 Wave 2 TECHOPS tasks are expressible in FlowSpec today.

---

## Foreman — The Runtime

Foreman is a Slack bot that runs Claude Code locally on a Mac and makes it controllable from Slack. FlowSpec workflows execute on Foreman.

- **One bot per Slack channel.** Each channel is an independent AI session with its own working directory, model, and conversation history.
- **Multiple AI backends.** Claude (default), OpenAI, and Gemini.
- **Bot registry.** Bots registered in `~/.foreman/bots.json` — how FlowSpec workflows find and route work.
- **Slash commands.** All control via `/cc` commands: `/cc run`, `/cc bots`, `/cc delphi`, `/cc canvas list`, etc.
- **Tool approval.** Read/search auto-approve. Write/edit/bash require a Slack button tap.

---

## Pythia — Multi-Model Verification

Pythia is a 5-phase multi-model verification workflow (successor to Delphi). It solves the problem of single-LLM confident wrongness by getting multiple independent models to answer, then running structured critique and fact-checking.

**5 phases:** Answer → Synthesize → Critique → Revise → Fact-check

Uses structured VERIFIED/REFUTED/UNVERIFIABLE verdicts with confidence scores. Invoked via `/cc run "Pythia" "Pythia" question="..." mode=code`.

Like FlowSpec, Pythia was designed by AI for AI — the dev asked Delphi to run Delphi on itself, and the output became Pythia's design spec.

---

## Francisco Partners Context

- **~195 current portfolio companies**, $45B+ capital raised, 25+ years, 450+ investments
- FP has a **CTO group** that actively engages portfolio companies on AI adoption
- MFP reaching S3 is a **proof point** for the entire portfolio
- Portfolio page: https://www.franciscopartners.com/investments

### Notable Portfolio Companies & FlowSpec Relevance

| Company | Sector | FlowSpec Use Case |
|---------|--------|-------------------|
| MyFitnessPal | Health & Fitness | Current target, Temporal backend |
| New Relic | Observability | Incident triage, runbook automation |
| Sumo Logic | Log Analytics | Alert response orchestration |
| Forcepoint | Cybersecurity | SOAR-lite, threat response playbooks |
| Jamf | Apple Device Mgmt ($2.2B, Jan 2026) | Fleet compliance, policy rollouts |
| LogMeIn / LastPass | SaaS / Remote Access | Security workflows, credential rotation |
| Boomi | Integration Platform | AI-augmented integration workflows |
| Black Duck | Software Composition Analysis | Vuln detection → remediation → PR |
| Jama Software | Requirements Management | Requirements → build → verify |
| AdvancedMD | Healthcare IT | Compliance, regulatory gates |
| Merative (fka IBM Watson Health) | Healthcare AI | Compliance, regulatory gates |
| STARLIMS | Lab Information Systems | Compliance, audit trails |
| Zenefits | HR / Payroll | Onboarding, enrollment workflows |
| bswift | Benefits Administration | Enrollment, compliance |
| The Weather Company | Media / Data | Data pipeline orchestration |

### Likely Platform Mapping

- **AWS (Step Functions):** New Relic, Sumo Logic, Forcepoint, MFP, AdvancedMD, The Weather Company, and many others
- **Azure (Durable Functions):** Jamf, LogMeIn/LastPass, bswift, Zenefits
- **LangGraph:** Any FP company beginning AI transformation with no infrastructure commitment

---

## Training Calendar (DevClarity)

| Date | Event | Duration |
|------|-------|----------|
| 4/14 | Working Sessions 1 & 2 (Tooling, Requirements & Code Review) | 2 hrs |
| 4/15 | Working Sessions 3 & 4 (Coding & Metrics, QA & Unit Testing) | 2 hrs |
| 4/21 | Environmental Setup Workshop | 60 min |
| 4/24 | Opening Report | 60 min |
| 4/28 | AI Coding Foundations Day 1 | 3 hrs |
| 4/30 | AI Coding Foundations Day 2 | 3 hrs |
| 5/5 | Deep Dive Training #1 (TBD) | 90 min |
| 5/7 | Deep Dive Training #2 (TBD) | 90 min |
| 5/11 | Directed Effort Kickoff | 60 min |
| 5/15 | Directed Effort Session 1 | 2 hrs |
| 5/20 | Directed Effort Session 2 | 2 hrs |
| 5/27 | Directed Effort Wrap-up | 60 min |
| Week of 6/1 | Knowledge Sharing + Final Report | TBD |

Training lands in Waves 2-3. People learn the tools right as S2 infrastructure is being built — theory and practice in parallel. Directed Effort sessions should target Wave 4 milestones (self-verifying agent loop, OpenSpec pilot).

---

## MFP iOS Codebase Context

- **Workspace**: `MyFitnessPal.xcworkspace`
- **Architecture**: Hybrid — legacy Classic (ObjC/Swift) + preferred Modern (Swift-only). All new code goes in `Sources/Modern/`.
- **Pattern**: Coordinators → ViewModels → Services → Views (SwiftUI mandatory for new views)
- **DI**: ServiceLocator (not initializer injection)
- **Data/Sync/Network**: QueryEnvoy SDK (Kotlin Multiplatform)
- **Testing**: XCTest only (no Swift Testing)

---

## What Success Looks Like

In September 2026, a developer on any squad at MFP can:

- Write a structured spec for a feature and hand it to an agent
- The agent builds, tests, checks standards, checks security, opens a PR, and iterates until all gates pass
- The developer reviews a clean, well-tested PR and approves it
- The code ships with confidence

The developer didn't write the code. They didn't run the tests. They didn't check the linter. They didn't open the PR. They defined what to build and verified the result. The Agentic Pipeline handled the rest.

---

## Strategic Summary

1. **The September demo is the deliverable.** Everything feeds into proving E2E with <2 human touchpoints.
2. **Test coverage is the current gate.** TECHOPS-2187 must land for S2 qualification.
3. **FlowSpec is ahead of schedule.** The orchestration layer the plan assumes will be built last already exists at Phase 4.
4. **FlowSpec has cross-portfolio value.** Multi-backend compilation could make it an S3 accelerator for FP's entire ~195-company portfolio.
5. **Chris has already demonstrated S3.** Working prototype shown 3/20, Loom videos from 3/13. The question is not "can we get there" but "how fast can we formalize it."
6. **The Decision Register is empty.** Governance infrastructure exists but no decisions, risks, or dependencies have been formally recorded yet.
7. **No S3 policies have been defined.** The FP SDLC Evolution Framework (SSO-protected Google Site) likely contains per-level policies, but they haven't been surfaced into the AT space yet.

---

*Last updated: 2026-03-30*
