# FlowSpec Fix Plan: `run -> result` + Compound Booleans

**Created:** 2026-03-28
**Source:** Pythia analysis critique, validated by Dread Redbeard
**Tracks:** Known Issues #1 and #2 in `flowspec-status.md`

---

## Fix #2: `run "Workflow" -> result` Capture Syntax

**Problem:** The parser doesn't recognize `-> varName` after `run`. The compiler already copies child vars into the parent (`compiler.ts:335-339`), but the language has no syntax to name the capture. The spec's own "Fix All Crash Bugs" example is broken without this — Betty can't summarize sub-workflow results she never received.

**Design decision:** When `-> name` is present, serialize the child's public vars as JSON under `name`. When absent, merge child vars into parent (existing behavior, preserved for backward compat).

### Steps

- [ ] **2a. `ast.ts` — add `capture` field to `RunStep`**
  - Add `capture?: string` to the `RunStep` interface
  - File: `src/flowspec/ast.ts`, line ~99-105

- [ ] **2b. `parser.ts` — parse `-> varName` in `parseRun()`**
  - After existing `with` and `at most` parsing (~line 600), check for `-> (\w+)`
  - Must handle all orderings: `run "X" -> r`, `run "X" with a = {b} -> r`, `run "X" with a = {b}, at most 5 total -> r`
  - Regex: `/->\\s*(\\w+)/` applied to the full `afterName` string
  - File: `src/flowspec/parser.ts`, line ~576-607

- [ ] **2c. `compiler.ts` — use `capture` in `executeRun()`**
  - If `step.capture` is set: filter out `__`-prefixed vars, JSON.stringify the rest, store as `ctx.vars[step.capture]`
  - If `step.capture` is not set: existing merge behavior (lines 335-339)
  - File: `src/flowspec/compiler.ts`, line ~323-340

- [ ] **2d. Build + test**
  - `npm run build` — must compile clean
  - Add a test `.flow` snippet or test against existing flows
  - Verify backward compat: `run "X"` without `->` still merges vars as before

**Estimated effort:** ~20 lines across 3 files.

---

## Fix #5: Compound Boolean Conditions (`AND` / `OR`)

**Problem:** `if` conditions only support a single test. `if {review} means "approved" and {tests} contains "PASS"` is unparseable. This is a day-one need for any real workflow with multiple gates.

**Design decision:** `and` binds tighter than `or`. Mixing `and`/`or` without grouping is a parse error (keeps it PM-readable, no precedence confusion). All-`and` or all-`or` chains are fine.

### Steps

- [ ] **5a. `ast.ts` — add compound condition types**
  - Add `CompoundCondition` interface: `{ type: 'and' | 'or'; left: ConditionExpr; right: ConditionExpr }`
  - Add `ConditionExpr` type alias: `Condition | CompoundCondition`
  - Update `IfStep.condition`, `IfStep.elseIf[].condition`, and `RepeatUntilStep.condition` from `Condition` to `ConditionExpr`
  - File: `src/flowspec/ast.ts`, lines ~6-21 and ~72-84

- [ ] **5b. `parser.ts` — parse `and` / `or` in conditions**
  - Add `parseConditionExpr(text, lineNum)` that splits on ` and ` or ` or ` (case-insensitive)
  - Must not split inside quoted strings (e.g. `{x} contains "rock and roll"` is one condition, not two)
  - If both `and` and `or` appear at top level, throw `ParseError` telling the user to simplify
  - Replace all `parseCondition()` call sites with `parseConditionExpr()`: lines ~465 (repeat until), ~508 (if), ~526 (otherwise if)
  - Keep `parseCondition()` as the leaf parser for single conditions
  - File: `src/flowspec/parser.ts`, line ~157+

- [ ] **5c. `runtime.ts` — evaluate compound conditions**
  - Add `evaluateConditionExpr(vars, cond)` that recurses on `and`/`or` nodes
  - Leaf nodes delegate to existing `evaluateCondition()`
  - File: `src/flowspec/runtime.ts`, line ~39+

- [ ] **5d. `compiler.ts` — swap to `evaluateConditionExpr`**
  - Replace `evaluateCondition` with `evaluateConditionExpr` at 3 call sites:
    - Line ~268 (repeat until)
    - Line ~278 (if)
    - Line ~284 (otherwise if)
  - Update import
  - File: `src/flowspec/compiler.ts`

- [ ] **5e. `runtime.ts` — update `buildMeansMap` for compound conditions**
  - `collectMeansConditions` currently walks `Condition` nodes looking for `means` ops
  - Must also recurse into `CompoundCondition.left` and `CompoundCondition.right`
  - File: `src/flowspec/runtime.ts`, line ~77+

- [ ] **5f. Build + test**
  - `npm run build` — must compile clean
  - Test cases:
    - `if {a} contains "x" and {b} means "approved"` — should parse as `CompoundCondition(and)`
    - `if {a} is empty or {b} is empty` — should parse as `CompoundCondition(or)`
    - `if {a} contains "rock and roll"` — should NOT split (quoted string)
    - `if {a} is empty and {b} is empty or {c} is empty` — should ERROR (mixed operators)
  - Verify existing single-condition flows still parse and run

**Estimated effort:** ~50-60 lines across 4 files. Parser quote-awareness is the trickiest part.

---

## Implementation Order

1. Fix #2 first — smaller, self-contained, unblocks the broken spec example
2. Fix #5 second — builds on same files, slightly more involved
3. Both can be done in one session

## Status

| Step | Status |
|------|--------|
| 2a. AST `capture` field | **Done** |
| 2b. Parser `-> varName` | **Done** |
| 2c. Compiler capture logic | **Done** |
| 2d. Build + test | **Done** — 6/6 pass |
| 5a. AST compound conditions | Not started |
| 5b. Parser `and`/`or` | Not started |
| 5c. Runtime eval | Not started |
| 5d. Compiler swap | Not started |
| 5e. Means map recursion | Not started |
| 5f. Build + test | Not started |
