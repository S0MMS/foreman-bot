# Pythia Workflow — Structural Weaknesses Analysis

*Output of a 5-phase multi-model Pythia analysis. Question: "What are the structural weaknesses of the Pythia workflow itself, and how could it be improved?"*

---

## TL;DR (3-Paragraph Summary)

**The core problem is dead code everywhere.** Pythia's FlowSpec language looks powerful on paper — you can write `within 30 seconds`, `retry 3 times`, `(new session)` — but the compiler ignores all of it. Four AST properties (`timeout`, `retries`, `timeoutHandler`, `newSession`) are faithfully parsed and stored, then never read when the workflow actually executes. The most dangerous of these is `(new session)`: Gemini maintains a persistent conversation history keyed by channel ID, so Phase 5 inherits the full context from Phases 1 and 3. The contamination was verified directly in the adapter code. What looks like an isolation mechanism is a no-op.

**Pythia also regressed from its predecessor.** Delphi — the workflow it replaced — had 12 mode-specific prompt variants across its phases (research vs. design vs. code). Pythia declares a `mode` parameter and even sets a default, but `{mode}` appears in zero prompts. Every phase uses the same generic instruction regardless of what kind of question you're asking. On top of that, the bot concurrency model relies entirely on a gentleman's agreement: the design assumes one workflow per bot channel at a time, but nothing in the code enforces it. Two concurrent runs would silently race on the same Gemini history.

**The fixes are all tractable, none are massive.** Priority one is wiring up `newSession` in the compiler to actually clear Gemini's channel history. After that: add a concurrency guard, port Delphi's mode-specific prompts to Pythia's five phases, and implement timeout/retry handling in `executeAsk`. The verification confirmed all four critical findings against source — the refutations were almost entirely off-by-one line numbers. The architecture is sound; it's the execution layer that's half-built.

---

## Priority-Ranked Fix List

| Priority | Fix | Effort |
|----------|-----|--------|
| 1 | Wire up `newSession` in compiler — clear Gemini history + reset sessionId | Low-Med |
| 2 | Add concurrency guard (mutex or channel-per-run) | Med |
| 3 | Port Delphi's mode-specific prompts to Pythia's 5 phases | Med |
| 4 | Implement `timeout`/`retries` in compiler, then use them in `pythia.flow` | Med |
| 5 | Track branch success/failure, surface status in judge prompts | Low |
| 6 | Add explicit REFUTED-claim handling to `@output` prompt | Low |

---

## Detailed Findings

### 1. Session Contamination (CRITICAL — Confirmed)

`(new session)` is parsed into the AST (`parser.ts:266-268`) but `executeAsk` in `compiler.ts:144-169` never reads `step.newSession`.

Gemini's adapter (`GeminiAdapter.ts`) maintains a persistent `Map<channelId, Content[]>` backed by `~/.foreman/gemini-histories.json`. On every call it reconstructs chat from stored history and persists it back after each response. Phase 5 dispatches to `@gemini-worker` via the same channel, so it inherits full conversation history from Phases 1 and 3. The `resume()` method ignores `sessionId` entirely — history is keyed by `channelId`, achieving the same contamination effect.

**Fix:** Wire `newSession` in `executeAsk` to clear the Gemini history map entry for the channel before dispatching.

### 2. Four Dead Compiler Flags (CRITICAL)

All four of these are parsed and stored in the AST but never read by the compiler:

- `timeout` — parsed from `within N seconds/minutes`
- `retries` — parsed from `retry N times`
- `timeoutHandler` — parsed from `if it times out`
- `newSession` — parsed from `(new session)`

Only `failHandler` is actually wired up (`compiler.ts:152-154`). This means `within` and `retry` clauses in `.flow` files are currently cosmetic.

**Fix:** Implement timeout/retry handling in `executeAsk`, then add the clauses to `pythia.flow`.

### 3. Mode Regression from Delphi (HIGH)

Delphi has 4 prompt builder functions × 3 modes = **12 mode-specific prompt variants**. Pythia declares `mode (default "code")` at line 2 of `pythia.flow`, but `{mode}` appears in **zero prompts** across all 7 `ask` steps. All phases use identical generic prompts regardless of mode.

This is a functional regression, not just dead code. Research and design queries need fundamentally different prompting than code analysis.

**Fix:** Port Delphi's mode-conditional prompt logic to each of Pythia's 5 phases.

### 4. Unenforced Single-Tenancy (MEDIUM)

`processChannelMessage` has no `isRunning` check before processing (`slack.ts:244-275`). `dispatchToBot` in `activities.ts:66-97` calls it directly with no mutex or lock. The design comment says "each workflow gets its own dedicated bot, so no mutex is needed" — but nothing enforces this assumption. Two concurrent Pythia runs (or a user messaging a worker channel mid-run) would race on Gemini's history map and interleave responses.

**Fix:** Mutex on channel-level dispatch, or dedicated ephemeral channel-per-run.

### 5. Partial Branch Results Silently Lost (MEDIUM)

`executeParallel` in `compiler.ts:186-195` uses `Promise.allSettled` but chains `Object.assign` in `.then()`:

```js
return executeSteps(branchCtx, branch).then(() => {
  Object.assign(ctx.vars, branchCtx.vars);
});
```

If a branch fails mid-way, the `.then()` never fires — even variables successfully captured before the failure point are lost. Failed branches silently produce empty strings with no status signal to downstream judge prompts.

### 6. Context Window Pressure (MEDIUM — mode-dependent)

`dispatchToBot` returns `result.result` (final text output only, not chain-of-thought). Context pressure is real but primarily a risk for research/design modes where answers are verbose. Lower risk for code mode where typical answers are 2-4K tokens.

### 7. `@output` Bot Hallucination Surface (LOW)

The `@output` bot synthesizes from accumulated variables with no explicit instruction to preserve verification findings or flag REFUTED claims. Its follow-up capability is valuable (only interactive endpoint post-run), but the prompt needs explicit handling for claims that were challenged during Phase 4.

---

## Verification Summary

| Status | Count |
|--------|-------|
| VERIFIED | 22 |
| REFUTED | 7 |
| UNVERIFIABLE | 2 |

All 7 refutations were minor: 5 off-by-one line number errors, 1 slightly overstated severity (concurrency), 1 wrong filename (`flowspec-status.md` → `flowspec-fix-plan.md`). All four critical structural findings were independently confirmed against source code.
