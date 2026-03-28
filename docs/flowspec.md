# Flowspec: A Workflow Description Language for AI Bot Orchestration

**Status:** Design Spec (Pre-Implementation)
**Date:** 2026-03-25
**Authors:** Chris Shreve + Delphi research process (3 rounds, 6 agents)

---

## Overview

Flowspec is a minimal workflow description language for orchestrating AI bots. It is:

- **Turing complete** — self-referential `run` + conditionals enable unbounded recursion. This is the first and primary design principle.
- **Simple enough** for a non-engineer (e.g. a product manager) to write
- **Expressive enough** to cover ~80% of common multi-agent workflow patterns

The agents in this system are Slack-based Claude Code bots. Each bot lives in its own Slack channel, has its own working directory and filesystem access, and runs a full Claude Code session. Dispatching work to a bot means posting a message to its Slack channel and triggering its Claude session.

---

## Table of Contents

1. [The 80% Patterns](#1-the-80-patterns)
2. [Language Primitives](#2-language-primitives)
3. [Syntax Reference](#3-syntax-reference)
4. [Pattern Examples](#4-pattern-examples)
5. [End-to-End Examples](#5-end-to-end-examples)
6. [The Hard Problems (The Remaining 20%)](#6-the-hard-problems-the-remaining-20)
7. [Compilation Boundary](#7-compilation-boundary)
8. [Runtime Infrastructure](#8-runtime-infrastructure)
9. [Build Order](#9-build-order)

---

## 1. The 80% Patterns

These workflow patterns cover the vast majority of real multi-agent orchestration needs.

| # | Pattern | Temporal Mapping | Example |
|---|---------|-----------------|---------|
| 1 | Sequential steps | Activity chain | Investigate -> fix -> review -> PR |
| 2 | Parallel fan-out | `Promise.all()` | 3 bots research competitors simultaneously |
| 3 | Fan-in / join | `Promise.all()` + next step | Synthesize 3 reports into one |
| 4 | Conditional branching | `if/else` | Security issues -> escalate; else -> merge |
| 5 | Loop over list | `for` loop | For each crash bug, run fix workflow |
| 6 | Convergence loop | `while` loop | Revise until quality score > 8 |
| 7 | Human-in-the-loop | Signal wait | Pause for approval before merge |
| 8 | Timeout | Activity timeout + cancellation scope | 10 min limit on test run |
| 9 | Error / retry | Retry policy + try/catch | Retry deploy, then alert human |
| 10 | Sub-workflow / reuse | Child workflow | Reuse "review-and-merge" across workflows |
| 11 | Race (first-to-finish) | `Promise.race()` + cancellation | 3 bots investigate, first result wins |

---

## 2. Language Primitives

12 primitives total — but really one verb (`ask`) with modifiers.

| Primitive | Purpose |
|-----------|---------|
| `ask @bot "..."` | Core action — dispatch prompt to bot, start a Claude session, wait for response |
| `send @bot "..."` / `send #channel "..."` | Fire-and-forget message — posts text, does NOT start a bot session |
| `-> name` / `{name}` | Capture and reference output |
| `at the same time` | Parallel block (wait for all) |
| `race` | Race block (first wins, cancel rest) |
| `for each X in {list}` | Bounded iteration |
| `repeat until {X} is above/equals/contains/means` | Convergence loop (with mandatory max) |
| `if {X} contains/equals/means "Y"` / `otherwise` | Conditional |
| `pause for approval` | Human gate |
| `within <duration>` | Timeout |
| `retry N times` / `if it fails` | Error handling |
| `run "Workflow"` | Sub-workflow |
| `stop` | Exit workflow with optional message |

### `ask` vs `send` — Critical Distinction

**`ask`** starts a Claude session. The bot receives the prompt, thinks, uses tools, and produces a response. The workflow waits for the bot to finish. Use `ask` when you need the bot to **do something** — read a file, write code, post to a channel, call an API.

**`send`** posts a text message. No Claude session is started. The bot does not process the message. Use `send` for status updates, notifications, and announcements — messages that are informational, not instructions.

```
-- CORRECT: bot reads the ticket and acts on it
ask @writer "Read Jira ticket PROJ-1234 and post a summary to #stakeholders" -> summary

-- WRONG: this just posts text to the bot's channel — nobody processes it
send @writer "Read Jira ticket PROJ-1234 and post a summary to #stakeholders"

-- CORRECT use of send: posting a notification to a channel
send #releases "Version 2.1 shipped"
```

### Key Design Decisions

**Quoted instructions.** Prompts are always quoted strings. This eliminates parsing ambiguity about where an instruction ends:

```
ask @betty "Read Jira ticket {bug} and summarize the root cause" -> analysis
```

Multi-line via triple quotes:

```
ask @clive """
  Read Jira ticket {bug}.
  Examine the code in the MFP plugins repo.
  Write a fix and commit to branch fix/{bug}.
""" -> fix
```

**Explicit named outputs only.** Every `ask` that produces needed output must use `-> name`. No implicit "previous result" — it's fragile and breaks when you insert steps.

**Structured conditions.** `if {X} contains "Y"` uses substring matching. To prevent false matches on LLM free-text, the compiler injects structured-output instructions (VERDICT tags) into prompts whose output feeds an `if` condition.

---

## 3. Syntax Reference

### Workflow Header

```
workflow "Name"
  inputs: param1 (required), param2 (default "value")
  ...steps...
```

The `inputs:` line is optional but enables validation. The compiler can also infer inputs from unresolved `{variables}` at the top level.

### Comments

```
-- This is a comment
```

### Bot References

```
@betty       -- a named bot (maps to a Slack channel)
@coders      -- a bot pool (maps to multiple channels)
#channel     -- a Slack channel (for send)
@chris       -- a human (for approval routing)
```

### Output Capture and Reference

```
ask @betty "Do something" -> result_name    -- capture
ask @clive "Use this: {result_name}"        -- reference
```

### Conditions

Small fixed set — no expression language:

- `contains` — substring match
- `equals` — exact match
- `means` — semantic classification (see below)
- `is above` / `is below` — numeric comparison
- `is empty` / `is not empty` — presence check

For anything more complex, offload to a bot:

```
ask @clive "Evaluate whether coverage dropped >5%. Respond VERDICT:YES or VERDICT:NO" -> check
if {check} contains "VERDICT:YES"
  ...
```

### The `means` Operator

`means` is the most powerful condition operator. It lets you branch on the **meaning** of a bot's response without forcing the PM to write VERDICT tags or structured output instructions.

```
ask @reviewer "Review this PR for quality and security issues" -> review

if {review} means "approved"
  ask @bot "Merge the PR"
otherwise if {review} means "needs changes"
  ask @bot "Fix the issues: {review}"
otherwise if {review} means "rejected"
  stop "PR rejected: {review}"
```

**How it works under the hood:** The compiler performs a two-pass transformation. First pass: it scans all `if {var} means "..."` conditions to collect the possible classifications for each variable. Second pass: it rewrites the upstream `ask` prompt to inject a classification instruction on the last line — asking the bot to append a `FLOWSPEC_CLASS:` tag. At runtime, the tag is stripped from the response (the PM never sees it) and stored in an internal `__class_varName` variable. The `means` condition checks against that variable.

The PM writes natural conditions. The compiler handles the plumbing.

`means` also works in convergence loops:

```
repeat until {verdict} means "approved", at most 3 times
  ask @writer "Revise the draft based on: {feedback}" -> draft
  ask @reviewer "Review this draft: {draft}" -> verdict
```

### Duration Syntax

Natural English: `5 minutes`, `1 hour`, `30 seconds`, `2 hours`

---

## 4. Pattern Examples

### Sequential + Output Passing

```
workflow "Investigate Bug"
  ask @betty "Read Jira ticket {ticket_id} and summarize the root cause" -> analysis
  ask @clive "Write a fix based on: {analysis}" -> fix
  ask @betty "Review this code: {fix}"
```

### Parallel Fan-Out + Fan-In

```
workflow "Competitor Research"
  at the same time
    ask @betty "Research Notion's AI pricing and features" -> notion
    ask @clive "Research Coda's AI pricing and features" -> coda
    ask @roger "Research Confluence's AI pricing and features" -> confluence
  ask @betty "Synthesize into a comparison report: {notion}, {coda}, {confluence}"
```

> **Compiler enforces:** all bots in `at the same time` must be distinct. Same bot in multiple branches produces a compile error.

### Race (First-to-Finish)

```
workflow "Find Vulnerability"
  race
    ask @betty "Find the vulnerability by reading logs" -> finding
    ask @clive "Find the vulnerability by reading code" -> finding
    ask @roger "Find the vulnerability by checking metrics" -> finding
  ask @betty "Write a detailed report on: {finding}"
```

First bot to finish wins. Others are cancelled.

### Conditional

```
workflow "Triage Review"
  ask @clive """
    Review PR {pr_number}. Start your response with exactly one of:
    VERDICT:SECURITY, VERDICT:STYLE, or VERDICT:CLEAN
  """ -> review
  if {review} contains "VERDICT:SECURITY"
    ask @betty "Deep security audit of PR {pr_number}"
  otherwise if {review} contains "VERDICT:STYLE"
    ask @clive "Auto-fix style issues in PR {pr_number}"
  otherwise
    ask @clive "Approve and merge PR {pr_number}"
```

### Loop Over List

```
workflow "Fix Crash Bugs"
  ask @betty "List all open Jira tickets labeled 'crash', one ID per line" -> bugs
  for each bug in {bugs}
    ask @clive "Investigate {bug} and write a fix" -> fix
    ask @betty "Review {fix}" -> review
```

**Loop defaults:**

- Sequential by default (1 at a time) — safe, no bot contention
- Opt into parallelism: `for each bug in {bugs}, 3 at a time` (requires 3 distinct bot instances via bot pools)
- Error behavior: best-effort by default (skip failures, continue)
- Configurable: `for each bug in {bugs}, stop on failure` for fail-fast

### Convergence Loop

```
workflow "Polish Draft"
  ask @clive "Write a first draft about {topic}" -> draft
  repeat until {score} is above 8, at most 5 times
    ask @betty "Critique and suggest improvements: {draft}" -> feedback
    ask @clive "Revise based on: {feedback}" -> draft
    ask @roger "Score from 1-10, respond with just the number: {draft}" -> score
  if it never converges
    send @chris "Draft couldn't reach quality threshold after 5 rounds"
```

> **`at most N times` is required** — compiler error without it.

### Human-in-the-Loop

```
workflow "Publish RFC"
  ask @betty "Draft an RFC for {feature}" -> rfc
  pause for approval with message "Review this RFC: {rfc}"
    on reject
      ask @betty "Revise based on feedback: {feedback}" -> rfc
      pause for approval with message "Review revised RFC: {rfc}"
  ask @betty "Post {rfc} to Confluence"
```

### Timeout

```
workflow "Quick Test"
  ask @clive "Run the full test suite" within 10 minutes -> results
    if it times out
      send @chris "Test suite timed out, needs manual run"
      stop
```

### Error / Retry

```
workflow "Deploy"
  ask @clive "Deploy main to staging", retry 2 times
    if it fails
      send @chris "Deploy failed after retries."
```

### Sub-Workflow

```
workflow "Review and Merge"
  inputs: pr_number (required)
  ask @clive "Review PR {pr_number}" -> review
  pause for approval with message "Review says: {review}. Merge?"
  ask @betty "Merge PR {pr_number}"

workflow "Ship Feature"
  ask @clive "Implement {ticket} and open a PR" -> pr
  run "Review and Merge" with pr_number = {pr}
```

---

## 5. End-to-End Examples

### Fix All Open Crash Bugs

```
workflow "Fix and PR"
  inputs: bug (required)

  ask @clive """
    Read Jira ticket {bug}.
    Examine the code in /Users/chris.shreve/ios-dev3/mfp-claude-plugins.
    Write a fix and commit to branch fix/{bug}.
  """ -> fix

  ask @betty """
    Run tests on branch fix/{bug}.
    Start your response with VERDICT:PASS or VERDICT:FAIL.
  """ within 15 minutes -> test_result
    if it times out
      send @chris "Tests timed out for {bug}"
      stop

  if {test_result} contains "VERDICT:PASS"
    ask @clive "Open a PR for fix/{bug}" -> pr_url
    pause for approval with message "PR ready for {bug}: {pr_url}"
    ask @clive "Merge {pr_url} and close Jira ticket {bug}"
  otherwise
    ask @clive "Tests failed: {test_result}. Revise fix for {bug}.", retry 1 time
      if it fails
        ask @betty "Comment on {bug}: Automated fix failed. Needs manual investigation."

workflow "Fix All Crash Bugs"
  ask @betty """
    Search Jira project MFP for open bugs labeled 'crash'.
    Return one ticket ID per line, nothing else.
  """ -> bugs

  for each bug in {bugs}
    run "Fix and PR" with bug = {bug}

  ask @betty "Summarize what was fixed and what failed" -> summary
  send #mfp-bugs "{summary}"
```

### Competitive Analysis Report

```
workflow "Competitive Analysis"
  at the same time
    ask @betty "Research Notion's AI pricing and features" -> notion
    ask @clive "Research Coda's AI pricing and features" -> coda
    ask @roger "Research Confluence's AI pricing and features" -> confluence

  ask @betty """
    Synthesize into a competitive analysis with:
    1. Feature comparison table
    2. Pricing comparison
    3. Strengths and weaknesses
    4. Recommendations
    Reports: {notion}, {coda}, {confluence}
  """ -> analysis

  pause for approval with message "Review the competitive analysis. Approve to publish."
    on reject
      ask @betty "Revise based on feedback: {feedback}" -> analysis
      pause for approval with message "Review revised analysis."

  ask @betty "Post to Confluence in the Product space: {analysis}"
  send @chris "Competitive analysis published to Confluence."
```

---

## 6. The Hard Problems (The Remaining 20%)

### Critical — Must Solve Before V1

#### 6a. Bot Contention

Each bot is a single Claude session in a single channel. You cannot parallelize to the same bot.

**Solution: Bot Pools.**

```
pool @coders: @clive, @betty, @roger
```

Then:

```
for each bug in {bugs}, 3 at a time using @coders
  ask @coders "Fix {bug}" -> fix
```

The runtime assigns `@coders` to the next available bot from the pool. For named bots (`@clive`), the runtime acquires a per-channel mutex — if Clive is busy, the activity queues and waits.

**Default behavior:** If you `ask @clive` and Clive is busy, the activity blocks until he's free. No silent failure, no interleaving.

#### 6b. The "Done" Signal

How does `dispatchToBot` know a bot finished?

**Solution:** The Foreman bridge emits a completion signal when a Claude session finishes its turn. The activity:

1. Posts prompt to bot's channel
2. Registers a signal listener
3. Heartbeats to Temporal every 30 seconds while waiting
4. Receives completion signal with bot's response text
5. Returns response

**Bridge change required:** After each Claude turn, if the message came from a workflow dispatch (identifiable by metadata), fire a callback to the Temporal activity.

#### 6c. Session Continuity

The language treats `ask` as stateless, but Claude sessions are stateful. Sequential `ask @clive` steps in the same workflow should continue the same session.

**Default:** Persistent session per bot per workflow execution. A workflow starts a fresh session for each bot on first `ask`. Subsequent `ask` to the same bot continues that session.

**Override:**

```
ask @clive (new session) "Review this with fresh eyes: {fix}"
```

#### 6d. Context Window Exhaustion

After 20+ messages in a session, Claude's context fills up. The bridge should monitor token usage and automatically start a new session with a summary when approaching limits. Invisible to the PM.

### High — Should Solve for V1

#### 6e. Condition Fragility

Solved by the VERDICT tag convention. The compiler injects structured output instructions into prompts whose output feeds an `if` condition. `contains` matches against tags, not free text.

#### 6f. List Parsing

`for each bug in {bugs}` needs a clean list. The compiler appends "Return one item per line, no other text" to any prompt whose output feeds a `for each`. The runtime strips numbering, bullets, and preamble via lightweight regex cleanup.

#### 6g. Temporal Determinism

Compiled workflow code must be deterministic:

- Use `workflow.now()` instead of `Date.now()`
- Never generate direct API calls (all external interaction via activities)
- Ensure stable iteration order

This is a compiler correctness concern — the PM never sees it.

#### 6h. History Limits / Continue-as-New

Temporal's ~50K event history limit. The compiler automatically inserts `continueAsNew()` checkpoints:

- After every 100 iterations of `for each`
- After every iteration of `repeat until`
- Carries forward all named variables as workflow input

Invisible to the PM.

### Medium — V2

#### 6i. Triggers / Event-Driven Workflows

```
workflow "Auto Review PRs"
  triggered by new PR on main
  ask @clive "Review PR {pr_number}" -> review
```

Deferred to V2. For V1, external triggers (GitHub webhooks, cron) invoke `/cc run`.

#### 6j. Dry Run / Validation

`/cc check "Fix All Crash Bugs"` — parse, validate bot names, check unresolved variables, estimate cost. Essential UX for non-engineers.

### Known 20% — Out of Scope (Write in TypeScript)

- **Dynamic routing** — bot decides which bot to call next
- **Multi-turn bot-to-bot conversation** — debate, negotiation between bots
- **Shared mutable state** — concurrent file/database access
- **Saga / compensation** — "undo step 1 if step 3 fails"
- **Priority / cancellation / preemption** — interrupt running workflows
- **Workflow versioning / migration** — in-flight workflow upgrades
- **Complex expression language** — compound boolean conditions

The escape hatch for the remaining 20% is writing the Temporal workflow in TypeScript directly.

---

## 7. Compilation Boundary

### What the Compiler Produces

For each `.flow` file:

1. **Temporal workflow function(s)** — the orchestration logic
2. **Activity stubs** — each `ask` becomes a call to the shared `dispatchToBot` activity
3. **Signal definitions** — each `pause for approval` registers a signal
4. **Workflow starter** — callable from `/cc run`
5. **Automatic `continueAsNew()` checkpoints** for loops
6. **Heartbeat configuration** on all activities

### Compilation Mapping

| DSL Construct | Temporal TypeScript |
|---------------|-------------------|
| `ask @bot "X" -> name` | `const name = await executeActivity(dispatchToBot, { bot, prompt, sessionKey })` |
| `at the same time { ... }` | `const [a, b, c] = await Promise.all([...])` |
| `race` | `Promise.race()` + `CancellationScope` |
| `for each x in {list}` | `for (const x of parseList(list)) { ... }` + continueAsNew every 100 |
| `for each x, N at a time` | Batched `Promise.all` with concurrency semaphore |
| `repeat until ... at most N` | `for` loop with condition check + continueAsNew each iteration |
| `if {x} contains "Y"` | `if (x.includes("Y"))` |
| `pause for approval` | `await condition(() => signals.approval !== undefined)` |
| `within <duration>` | `startToCloseTimeout` on activity |
| `retry N times` | `RetryPolicy { maximumAttempts: N + 1 }` |
| `if it fails` | `try/catch` around activity |
| `run "Workflow"` | `await executeChild(workflowFn, { args })` |
| `send` | Fire-and-forget `executeActivity(postStatus)` |
| `stop` | `throw FlowStop` (caught at workflow level) |
| `stop` | `return` from workflow function |

### Compilation Pipeline

```
Author writes .flow file
        |
    Parser (text -> AST)
        |
    Validator (check bot names, unresolved vars, parallel bot conflicts)
        |
    Code Generator (AST -> TypeScript Temporal workflow + activities)
        |
    Registration (compiled workflow registered with Temporal worker)
        |
    Invocation (user triggers via /cc run -> Temporal client starts workflow)
```

### What the Compiler Infers

- **Input schema** — from unresolved `{variables}` at workflow top level
- **Structured output instructions** — appended to prompts feeding `if` conditions or `for each`
- **Session keys** — generated from workflow run ID + bot name
- **continueAsNew boundaries** — inserted automatically for large loops

---

## 8. Runtime Infrastructure

### Runtime Configuration

```jsonc
// ~/.foreman/bots.json
{
  "betty": { "channelId": "C0ABC123", "workdir": "/Users/chris.shreve/ios-dev3" },
  "clive": { "channelId": "C0DEF456", "workdir": "/Users/chris.shreve/ios-dev3" },
  "roger": { "channelId": "C0GHI789", "workdir": "/Users/chris.shreve/tools" }
}

// ~/.foreman/workflow-defaults.json
{
  "defaultTimeout": "30m",
  "defaultRetries": 0,
  "heartbeatInterval": "30s",
  "approvalChannel": "from-trigger",
  "maxConvergenceIterations": 50,
  "continueAsNewThreshold": 100,
  "sessionMode": "persistent"
}
```

### The `dispatchToBot` Activity

This is the single most important piece of runtime infrastructure.

```typescript
async function dispatchToBot(
  ctx: ActivityContext,
  params: {
    channelId: string;
    prompt: string;
    sessionKey: string;       // workflowRunId — for session continuity
    newSession?: boolean;
  }
): Promise<string> {
  // 1. Acquire per-channel mutex (prevents interleaving)
  const lock = await acquireBotLock(params.channelId);

  try {
    // 2. Post prompt to bot's Slack channel with workflow metadata
    const messageTs = await slack.postMessage(params.channelId, params.prompt, {
      metadata: {
        workflowRunId: params.sessionKey,
        callbackTaskToken: ctx.info.taskToken,
        newSession: params.newSession ?? false,
      }
    });

    // 3. Heartbeat while waiting for completion
    const heartbeat = setInterval(() => {
      ctx.heartbeat({ status: 'waiting', messageTs });
    }, 30_000);

    // 4. Wait for bridge completion signal
    const result = await waitForCompletionSignal(params.channelId, messageTs);

    clearInterval(heartbeat);
    return result.text;
  } finally {
    lock.release();
  }
}
```

### Bridge Changes Required

- Accept `workflowRunId` in message metadata -> route to existing session or create new one
- On Claude session turn completion, if message has workflow metadata -> fire Temporal activity completion callback
- Monitor context window usage -> auto-summarize and restart session when approaching limits

### Prompt Injection Mitigation

When interpolating `{name}` into a prompt, the compiler wraps the data:

```
--- BEGIN DATA: analysis ---
{analysis}
--- END DATA: analysis ---
```

### Observability

The runtime automatically:

- Posts a thread in the triggering channel with live status updates
- Updates as each step completes or fails
- Provides a final summary when the workflow finishes

---

## 9. Build Order

| Phase | What | Why |
|-------|------|-----|
| 1 | `dispatchToBot` activity + bridge completion signal + per-bot mutex | Foundation — nothing works without it |
| 2 | Parser (~300 lines TypeScript, hand-written recursive descent) | Grammar is regular: workflow, ask, keywords, indentation |
| 3 | Compiler (~500 lines, AST -> TypeScript with continueAsNew injection) | Template-based emission, each primitive maps 1:1 to Temporal |
| 4 | `/cc run` + `/cc check` commands | Invocation and validation from Slack |
| 5 | Bot pool runtime (mutex, queue, pool assignment) | Enables parallel loops |
| 6 | Observability (auto-post status thread) | Essential UX for running workflows |

### File Convention

- **Extension:** `.flow`
- **Location:** `~/.foreman/workflows/` (or any path, or a Slack canvas)
- **Invocation:**
  - From file: `/cc run fix-all-bugs.flow "Fix All Crash Bugs" ticket_id=BUG-1234`
  - From default canvas: `/cc run canvas "Fix All Crash Bugs"`
  - From named canvas: `/cc run "My Workflows" "Fix All Crash Bugs"`
  - List available canvases: `/cc canvas list`

---

## Design Philosophy

FlowSpec's **first and primary design principle** is Turing completeness. Self-referential `run "Workflow"` combined with `if/otherwise` conditional branching gives the language unbounded recursion with conditional base cases. Everything else — simplicity, PM-readability, efficient AI-to-human communication — is secondary to this.

FlowSpec keeps its primitive count minimal. The complexity lives in the bots and the runtime — not in the language itself. The language handles common patterns simply; the escape hatch for edge cases is writing a Temporal workflow in TypeScript directly.

> Turing complete first. One verb. Named outputs. 1:1 Temporal mapping. TypeScript escape hatch. Don't try to make the DSL grow to cover everything — that's how simple languages die.
