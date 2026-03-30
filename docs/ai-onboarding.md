# Foreman, FlowSpec & Pythia — AI Onboarding Summary

*This document is written for AI agents who need to get up to speed quickly on the Foreman system, the FlowSpec workflow language, and the Pythia multi-model verification process.*

---

## What Is Foreman?

Foreman is a Slack bot that runs Claude Code (and other LLM backends) locally on a Mac and makes it controllable from Slack. Key properties:

- **One bot per Slack channel.** Each channel is a fully independent AI session with its own working directory, model, and conversation history.
- **Multiple AI backends.** Claude (default), OpenAI, and Gemini are all supported. Switch mid-session with `/cc model gemini:gemini-2.0-flash`.
- **Bot registry.** Bots are registered in `~/.foreman/bots.json` — a map of bot names to Slack channel IDs. This is how FlowSpec workflows find and route work to bots.
- **Slash commands.** All control happens via `/cc` commands: `/cc run`, `/cc bots`, `/cc delphi`, `/cc canvas list`, etc.
- **Tool approval.** Read/search tools auto-approve. Write/edit/bash tools require a Slack button tap from the user.

Foreman is the runtime and control plane. FlowSpec is the language for orchestrating multiple Foreman bots into multi-step workflows.

---

## What Is FlowSpec?

FlowSpec is a workflow description language purpose-built for AI bot orchestration. It was designed by Chris Shreve and developed through a multi-round Delphi research process involving 6 AI agents.

**Design principles (in order of priority):**

1. **Turing complete first.** Self-referential `run "Workflow"` + `if/otherwise` = unbounded recursion with conditional base cases. This was the primary design goal.
2. **Simple enough for a non-engineer (PM) to write.** No functions, types, or control flow complexity beyond what is listed below.
3. **Expressive enough for ~80% of multi-agent workflows.**

**How workflows are run:**
- From a `.flow` file: `/cc run mywf.flow "Workflow Name"`
- From a Slack canvas: `/cc run "Canvas Title" "Workflow Name"`
- From the channel's default canvas: `/cc run canvas "Workflow Name"`

**Runtime:** FlowSpec compiles to Temporal TypeScript workflows. It is currently running on Temporal (self-hosted locally). An AWS AgentCore port is in progress.

**Key primitives:**
- `ask @bot "..."` — dispatch work to a named bot, wait for response
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

**Critical distinction — `ask` vs `send`:** `ask` starts a full Claude session and waits for a response. `send` just posts a text message — no AI session is triggered. Use `ask` to make a bot do work; use `send` for status updates and notifications.

For the complete language spec, examples, and implementation details, see: `docs/flowspec-reference.md`

---

## What Is Pythia?

Pythia is a 5-phase multi-model verification workflow. It is the successor to Delphi (a 3-phase workflow) and was itself designed through a Delphi process.

**The problem Pythia solves:** A single LLM can be confidently wrong. Pythia gets multiple independent models to answer the same question, then runs structured critique and fact-checking phases to surface errors, contradictions, and missing perspectives before producing a final answer.

**Why Pythia over Delphi:**
- Delphi has 3 phases (quorum → verify → revise). Pythia has 5 (answer → synthesize → critique → revise → fact-check).
- Pythia adds a dedicated fact-checking phase using tool-based verification.
- Pythia uses structured VERIFIED/REFUTED/UNVERIFIABLE verdicts with confidence scores.
- Pythia has been run against itself (self-referential quality analysis) — results are in `pythia/results/`.

**How to invoke:**
```
/cc run "Pythia" "Pythia" question="Your question here" mode=code
```
Or run from the `pythia.flow` canvas. Modes: `code` (default), `research`, `design`.

For the full Pythia design, research foundations, and current limitations, see: `docs/pythia-reference.md`

---

## Where to Find More Information

| Topic | File |
|-------|------|
| FlowSpec full language spec | `docs/flowspec-reference.md` |
| FlowSpec implementation status | `docs/flowspec-status.md` |
| Pythia design + research citations | `docs/pythia-reference.md` |
| Pythia self-analysis results | `pythia/results/pythia-self-analysis-2026-03-29.md` |
| Foreman architecture | `ARCHITECTURE.md` |
| Foreman setup + commands | `CLAUDE.md` |
| Bot registry | `~/.foreman/bots.json` |
| Workflow files | `~/.foreman/workflows/` or Slack canvases |
