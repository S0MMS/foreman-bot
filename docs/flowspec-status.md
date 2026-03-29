# FlowSpec — Implementation Status

**Last updated:** 2026-03-29

---

## Overview

FlowSpec is a minimal workflow DSL for orchestrating AI bots that compiles to Temporal workflows. See [flowspec.md](./flowspec.md) for the full design spec.

---

## Build Phases

| Phase | What | Status | Estimate | Notes |
|-------|------|--------|----------|-------|
| 1 | `dispatchToBot` activity | **Done** (2026-03-26) | ~30 lines | Tested via `/cc workflow flowspec-test` |
| 2 | Parser (`.flow` text -> AST) | **Done** (2026-03-26) | ~660 lines | Hand-written recursive descent in `src/flowspec/parser.ts` |
| 3 | Compiler (AST -> Temporal TypeScript) | **Done** (2026-03-26) | ~340 lines | Interpreter in `src/flowspec/compiler.ts` — all 10 primitives + `means` two-pass |
| 4 | `/cc run` + `/cc check` + bot registry | **Done** (2026-03-26) | ~130 lines | `/cc run`, `/cc check`, `/cc bots` + `~/.foreman/bots.json` |
| 5 | First `.flow` files | **Done** (2026-03-28) | — | 3 workflows authored: `hello-world.flow`, `peer-review.flow`, `pythia.flow`. Pythia is the flagship — 5-phase multi-model verification. TECHOPS-2186 test generation workflow not yet written. |
| 6 | Bot pools + shared bot mutex | Deferred | — | Not needed yet — each workflow gets its own bot |
| 7 | Observability (live status thread) | Deferred | — | Status updates in Slack as workflow progresses |

**Total estimated new code for Phases 1-4: ~1,000-1,200 lines of TypeScript.**

### Known Issues (from Pythia analysis, 2026-03-28)

| Issue | Status | Priority |
|-------|--------|----------|
| `run "Workflow" -> result` capture syntax | **Done** (2026-03-29) | High — spec's own example is broken without it |
| Compound boolean conditions (`AND`/`OR`) | **Done** (2026-03-29) | High — day-one need for real workflows |
| Bot contention / static channel provisioning | Deferred | Architectural — needs dynamic bot pools |
| `run` recursion depth limit | Deferred | Safety — needs cycle detection or max depth |
| Security / trust model | Deferred | Production blocker but not V1 |

### What each phase produces

**Phase 1 — `dispatchToBot` activity.** The single Temporal activity that sends a prompt to a bot channel and returns the response. This is the only "real operation" in FlowSpec — everything else is control flow around it. Wraps existing `processChannelMessage` with `await` instead of fire-and-forget. See detailed design below.

**Phase 2 — Parser.** Takes `.flow` file text and produces an AST (abstract syntax tree). Handles all 10 primitives: `ask`, `send`, `run`, `race`, `at the same time`, `for each`, `repeat until`, `if/otherwise`, `pause for approval`, `stop`. Plus modifiers (`->`, `within`, `retry`, `if it fails`, `means`, `collect`) and `{variable}` interpolation. Indentation-based blocks, `--` comments, triple-quoted strings.

**Phase 3 — Compiler.** Takes the AST from Phase 2 and emits Temporal TypeScript. Each primitive maps 1:1 to a Temporal construct (see primitive table below). The hardest part is the `means` operator, which requires a two-pass approach: first pass collects all `means` labels referencing a variable, second pass rewrites the upstream `ask` prompt to inject classification instructions and generates last-line extraction code. Also handles `continueAsNew` injection for loops and variable forwarding across `run` calls. Budget 200-300 lines for `means` alone.

**Phase 4 — `/cc run` + `/cc check` + bot registry.** The Slack commands that invoke and validate workflows. `/cc check "Workflow"` parses and validates without executing (bot names exist, variables resolve, no unguarded recursion). `/cc run "Workflow" with param = value` parses, compiles, registers the compiled workflow with the Temporal worker, and starts execution. Bot registry (`~/.foreman/bots.json`) maps `@clive` -> channel ID so the compiler can resolve bot references.

**Phase 5 — First `.flow` files.** Three workflows authored in `flows/`:
- `hello-world.flow` — minimal: one `ask`, one `send`, tests basic dispatch + variable passing
- `peer-review.flow` — uses `means` operator for semantic branching on review outcome
- `pythia.flow` — flagship 5-phase multi-model verification workflow (parallel fan-out, synthesis, heterogeneous critique, targeted revision, independent fact-check). Evolution of Delphi using model diversity (Claude + Gemini + GPT). Also available on canvas. TECHOPS-2186 test generation workflow (the original Phase 5 target) not yet written.

### Key simplification: one bot per workflow

Each FlowSpec workflow gets its own dedicated bot channel. Bots are not shared across workflows. This eliminates per-channel mutex, bot pool management, and session key routing. Phase 6 (bot pools) is deferred until we need parallel `for each` with multiple bots.

### Dependencies between phases

```
Phase 1 (dispatchToBot) — no dependencies, can build now
Phase 2 (Parser) — no dependencies, can build in parallel with Phase 1
Phase 3 (Compiler) — depends on Phase 1 (needs dispatchToBot) + Phase 2 (needs AST)
Phase 4 (/cc run) — depends on Phase 3 (needs compiled output)
Phase 5 (First .flow) — depends on Phase 4 (needs /cc run)
```

---

## Phase 1: `dispatchToBot` — Design

### What it does

A single Temporal activity that sends a prompt to a dedicated bot channel, waits for the Claude session to complete, and returns the bot's response text.

### How it works

1. **Posts the prompt** to the bot's Slack channel (visible for observability)
2. **Calls `processChannelMessage`** — the same function Foreman already uses to run Claude sessions — and **awaits** the result
3. **Heartbeats to Temporal** every 30 seconds while waiting, so Temporal doesn't kill long-running bot calls
4. **Returns `result.result`** (the bot's response text) to the calling workflow

### What it replaces

The current Delphi pattern is three steps: fire-and-forget (`runClaudeInChannel`), poll Slack history for "Done in N turns" (`waitForWorkers`), then scrape the bot's messages (`collectWorkerMessages`). `dispatchToBot` collapses all three into one synchronous call by awaiting `processChannelMessage` instead of fire-and-forgetting it.

### Key simplification

Each FlowSpec workflow gets its own dedicated bot. No shared bots. This eliminates:
- Per-channel mutex / locking
- Bot pool management
- Session key routing (one workflow = one bot = one session)

### What already exists

- `processChannelMessage` in `slack.ts` (line ~140-212) — manages session start/resume, blocks until Claude finishes, returns the full result object with `.result`, `.turns`, `.cost`
- `getSlackApp()` / `getProcessChannelMessage()` in `slack-context.ts` — Temporal activity context already has access to these
- Heartbeat infrastructure — already used in `waitForWorkers`
- The "Done in N turns" completion marker (line 210) proves `processChannelMessage` blocks until the bot is done

### Function signature

```typescript
export async function dispatchToBot(
  channelId: string,   // the bot's Slack channel
  prompt: string,      // the prompt to send
): Promise<string>     // returns the bot's response text
```

### New code needed

- `dispatchToBot` activity function (~20 lines in `src/temporal/activities.ts`)
- Register the activity in the Temporal worker
- A heartbeat wrapper around the `processChannelMessage` call (setInterval every 30s)

### How compiled FlowSpec uses it

`ask @clive "Fix this bug" -> result` compiles to:

```typescript
const result = await executeActivity(dispatchToBot, {
  channelId: bots.clive.channelId,
  prompt: 'Fix this bug',
});
```

Sequential `ask` calls to the same bot share a session automatically because `processChannelMessage` checks for an existing `sessionId` on the channel's session state.

---

## Design Review

### Delphi review completed: 2026-03-26

Full results: [`delphi/results/flowspec-v1-2026-03-26-0929.md`](../delphi/results/flowspec-v1-2026-03-26-0929.md)

Key decisions from the review:

| Decision | Rationale |
|---|---|
| Keep `->` (not `as`) | `as` collides with English in prompts ("rewrite this as a haiku as poem") |
| `notify` -> `send` | More natural English |
| `call` -> `run` | More natural English |
| `at the same time, take the first` -> `race` | Short, unambiguous, maps to `Promise.race` |
| Add `means` condition operator | Hides VERDICT prompting from PMs; compiler injects last-line classification |
| Keep `pause for approval` + fix `on reject` | `on reject -> feedback` makes feedback capture explicit; eliminates magic `{feedback}` variable |
| Add `collect {var} as name` on `for each` | Fills accumulation gap (no way to gather results across loop iterations) |
| Recursion guard: `at most N total` | Prevents exponential breadth explosion; default 50; counter passed as workflow input |
| Add `timeout:` at workflow level | Compiles to `workflowExecutionTimeout` |
| Parallel blocks use `Promise.allSettled` | Best-effort default; failed branches produce empty variables |
| Language is already Turing complete | Recursive `run` + conditionals = unbounded computation; own it |

### Updated primitive table (post-review)

| # | Primitive | Temporal Mapping |
|---|-----------|-----------------|
| 1 | `ask @bot "..." -> name` | `executeActivity(dispatchToBot)` |
| 2 | `send @target "..."` | Fire-and-forget activity |
| 3 | `at the same time` | `Promise.allSettled()` |
| 4 | `race` | `Promise.race()` + cancel scope |
| 5 | `for each X in {list}` | `for...of` + continueAsNew |
| 6 | `repeat until` | Bounded `while` + continueAsNew |
| 7 | `if / otherwise` | `if/else` |
| 8 | `pause for approval` | Signal wait |
| 9 | `run "Workflow"` | `executeChild()` |
| 10 | `stop` | `return` |

---

## TECHOPS-2197 Coverage Analysis

Analyzed 2026-03-26. The Wave 2 initiative has 17 child tasks. FlowSpec can drive 8 of them.

### Fully expressible (8 tasks)

| Ticket | What | FlowSpec pattern |
|---|---|---|
| TECHOPS-2186 | AI-generate tests — backend | `for each` file: ask bot to write tests, `repeat until` passing, open PR |
| TECHOPS-2187 | AI-generate tests — iOS | Same pattern as 2186 |
| TECHOPS-2188 | AI-generate tests — Android | Same pattern as 2186 |
| TECHOPS-2190 | Mandatory PR review on Tier 1 | `for each` repo: check config, `if` not configured then set up |
| TECHOPS-2191 | Tier 2 constitution rollout | `for each` repo: analyze codebase, generate claude.md, open PR |
| TECHOPS-2196 | Operationalize golden path | Bot audits repos + drafts plan, `pause for approval` for human judgment |
| TECHOPS-2200 | Plugin discovery audit | `race` across sources (GitHub/Slack/Confluence), synthesize, `pause for approval` |
| TECHOPS-2203 | claude.md drift detection | `for each` repo: compare constitution to code, flag drift |

### Not expressible (9 tasks)

| Ticket | Why |
|---|---|
| TECHOPS-2185 | Human curation against Backstage data |
| TECHOPS-2189 | Technical writing (playbook documentation) |
| TECHOPS-2192 | Policy/standards definition |
| TECHOPS-2193/2194/2195 | Interactive environment debugging |
| TECHOPS-2201 | Architecture decision |
| TECHOPS-2202 | Claude admin configuration |
| TECHOPS-2206/2207/2208 | Strategy docs, process mapping, dashboards |

### Recommended first workflow

Test generation (TECHOPS-2186/2187/2188) — it's the most repetitive, highest-value, and uses FlowSpec's strongest patterns (`for each`, `repeat until`, `means`, `collect`).
