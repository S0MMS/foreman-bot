# FlowSpec Language Reference

**Version:** V1 (implemented)
**Runtime:** Temporal TypeScript (running); AWS AgentCore (in progress)
**Authors:** Chris Shreve + Delphi research process (3 rounds, 6 agents)

---

## FlowSpec Was Designed from the Ground Up by AI, for AI

**FlowSpec was not designed by a human. It was designed from the ground up by AI, for AI.**

The dev posed a question to Delphi: *"What should an AI bot orchestration language look like?"* Six AI agents across Claude, Gemini, and GPT each independently proposed a design. A judge synthesized their answers. Workers critiqued the synthesis. The judge revised. After 3 rounds of adversarial debate, the output of that process became the FlowSpec specification.

No human sat down with a blank spec document. The 16 primitives, the Turing completeness principle, the `ask` vs `send` distinction, the `means` operator, the `pause for approval` gate — all of it is what multiple leading AI models concluded, through the same Delphi process that FlowSpec is built to run, was the right design for a language that AI agents would use to orchestrate each other.

---

## Overview

FlowSpec is a workflow description language for orchestrating AI bots. It was designed with Turing completeness as its first and primary principle — everything else is secondary.

**Design principles, in order:**

1. **Turing complete.** Self-referential `run "Workflow"` + `if/otherwise` conditional branching = unbounded recursion with conditional base cases. By the Church-Turing thesis, any computation expressible in any Turing-complete system can be expressed in FlowSpec.
2. **PM-writable.** A non-engineer product manager should be able to write 80% of workflows without help.
3. **Efficient AI↔human communication.** Minimal syntax; all complexity lives in the bots and runtime, not the language.

**How it runs:** FlowSpec compiles to Temporal TypeScript. The `/cc run` Slack command starts a workflow execution. Each `ask` step dispatches work to a named bot (Slack channel), waits for the response, and captures it into a named variable.

### Why Turing Completeness Matters

Most workflow languages are deliberately *not* Turing complete — they restrict loops or recursion to guarantee termination. FlowSpec made the opposite choice intentionally.

Turing completeness means two things practically:

1. **You can express anything.** Any workflow pattern — no matter how complex — can be written in FlowSpec. There is no ceiling.
2. **It can be ported anywhere.** By the Church-Turing thesis, any Turing-complete system can be mechanically translated to any other Turing-complete system. FlowSpec workflows are not locked to any runtime. They can be compiled to Temporal, AWS Step Functions + AgentCore, LangGraph, Apache Airflow, or any future platform. The language outlives its runtime.

This is what makes FlowSpec unusual. Most DSLs are designed around a specific runtime and die with it. FlowSpec was designed to be runtime-agnostic from day one — the language *is* the workflow, independent of where it executes.

**Current and planned porting targets:**
- **Temporal** (running in production locally — the reference implementation)
- **AWS AgentCore** (port in progress — MFP has an existing AWS account and a formal decision to use AgentCore for agent hosting)
- Theoretically also: AWS Step Functions, LangGraph, Apache Airflow, Prefect, Temporal Cloud

---

## Language Primitives

16 primitives total.

| Primitive | Purpose |
|-----------|---------|
| `ask @bot "..."` | Dispatch prompt to bot, start Claude session, wait for response |
| `send @bot "..."` / `send #channel "..."` | Fire-and-forget message — no bot session, just text |
| `-> name` / `{name}` | Capture output to named variable / reference it |
| `at the same time` | Parallel fan-out — wait for ALL branches |
| `race` | Parallel fan-out — first to finish wins, cancel the rest |
| `for each X in {list}` | Bounded iteration over a list |
| `repeat until {X} op "Y", at most N times` | Convergence loop — mandatory max |
| `if {X} contains/equals/means "Y"` | Conditional branch |
| `otherwise` / `otherwise if` | Else / else-if |
| `run "Workflow" [with k=v] [-> name]` | Sub-workflow call — the key to Turing completeness |
| `pause for approval [with message "..."]` | Human gate — workflow pauses until user approves |
| `read "path" -> name` / `read {var} -> name` | Read a file from disk into a variable |
| `write {var} to "path"` / `write {var} to {path_var}` | Write a variable's content to a file on disk |
| `within <duration>` | Timeout on an `ask` step |
| `retry N times` / `if it fails` | Error handling |
| `stop ["message"]` | Exit workflow |

### `ask` vs `send` — Critical Distinction

**`ask`** starts a Claude session. The bot receives the prompt, reasons, uses tools, and produces a response. The workflow waits. Use `ask` when you need the bot to **do something**.

**`send`** posts a text message. No session is started. The bot does not process it. Use `send` for status updates and notifications.

```
-- CORRECT: bot reads the ticket and does work
ask @writer "Read Jira ticket {ticket} and write a summary" -> summary

-- WRONG: this just posts text — nobody processes it
send @writer "Read Jira ticket {ticket} and write a summary"

-- CORRECT: send a status notification
send #releases "Version 2.1 shipped successfully"
```

### Condition Operators

| Operator | Meaning |
|----------|---------|
| `contains "X"` | Substring match |
| `equals "X"` | Exact match |
| `means "X"` | Semantic classification via follow-up LLM call |
| `is above N` | Numeric comparison |
| `is below N` | Numeric comparison |
| `is empty` / `is not empty` | Presence check |

Compound conditions use `and` / `or` (not mixed in one expression):

```
if {score} is above 80 and {verdict} means "approved"
  ask @bot "Merge the PR"

if {status} equals "done" or {status} equals "skipped"
  send #output "Finished"
```

### The `means` Operator

`means` lets you branch on the **semantic meaning** of a bot's response without requiring the PM to write VERDICT tags. After an `ask` captures a result, the compiler auto-dispatches a focused follow-up: *"Based on your previous response, reply with ONLY one of: approved, needs changes, rejected."* That classification result is what `means` checks against.

```
ask @reviewer "Review PR {pr}" -> review
if {review} means "approved"
  ask @bot "Merge the PR"
otherwise if {review} means "needs changes"
  ask @bot "Fix the issues: {review}"
otherwise if {review} means "rejected"
  stop "PR rejected: {review}"
```

### File I/O: `read` and `write`

`read` loads a file from disk into a variable. `write` saves a variable to a file. **Paths must be absolute** — no relative paths allowed. This avoids ambiguity about "relative to what?" for PMs writing workflows.

```
-- Read a prompt from a file
read "/Users/chris/pythia/prompts/my-question.md" -> question

-- Read from a path stored in a variable
read {question_file} -> question

-- Write results to a file
write {briefing} to "/Users/chris/pythia/results/output.md"

-- Write to a path stored in a variable
write {detailed_report} to {output_file}
```

Both `read` and `write` support variable interpolation in quoted paths:

```
write {result} to "/Users/chris/results/{target_class}-result.md"
```

### `for each` — Delimiter Behavior

`for each` splits lists automatically. The delimiter depends on the list content:

- **List contains newlines** → splits on newlines only (commas within each item are preserved)
- **List has no newlines** → splits on commas

This enables nested `for each` loops for batching:

```
-- Outer loop: batch_list has newlines between batches
-- Each batch line is: "ClassA, ClassB, ClassC"
for each batch in {batch_list}
  -- Inner loop: no newlines in batch, splits on commas
  for each class in {batch}
    run "Process Class" with target_class={class}
```

### `--deep` Mode

Adding `--deep` to a `/cc run` command modifies every `ask` step in the workflow:

- **Prepends** "Think very deeply. Take your time." to every prompt
- **Increases timeout** from 30 minutes to 45 minutes per `ask` step

```
/cc run /path/to/workflow.flow "Name" --deep question="What is X?"
```

Works on any FlowSpec workflow, not just Pythia.

### Bot Session Reset

On the first `ask` dispatch to each bot in a workflow run, the bot's session is automatically cleared. This ensures every workflow starts with clean context — no leftover conversation from a previous run bleeding in. No action needed from the workflow author; this is handled by the runtime.

---

## Syntax Reference

### Workflow Header

```
workflow "Name"
  inputs: param1 (required), param2 (default "value")
  ...steps...
```

### Comments

```
-- This is a comment
```

### Multiple Workflows in One File

A `.flow` file can contain multiple `workflow` blocks. By default, the first workflow is selected. To invoke a specific one:

```
/cc run myfile.flow "Workflow Name"
/f run myfile.flow --name "Workflow Name"
```

### Sub-Workflow with Capture

```
run "Review and Merge" with pr_number = {pr}

-- With capture: child workflow's public variables serialized as JSON
run "Review and Merge" with pr_number = {pr} -> review_result
```

### Duration Syntax

Natural English: `5 minutes`, `1 hour`, `30 seconds`, `2 hours`

### Bot References

```
@betty       -- named bot (maps to bots.json entry → Slack channel ID)
#channel     -- Slack channel (for send)
@chris       -- human (for approval routing)
```

---

## Examples

### Example 1 — Simple (Linear Pipeline)

A straightforward 3-step workflow: investigate → fix → review.

```
workflow "Fix Bug"
  inputs: ticket (required)

  ask @betty "Read Jira ticket {ticket} and summarize the root cause" -> analysis

  ask @clive """
    Based on this analysis:
    {analysis}
    Write a fix for ticket {ticket} and commit it to branch fix/{ticket}.
  """ -> fix

  ask @betty "Review the fix on branch fix/{ticket}. Post your verdict to #code-reviews."
```

This demonstrates:
- `inputs:` declaration
- Sequential `ask` steps
- Output capture with `-> name`
- Variable interpolation with `{name}`
- Multi-line prompt with triple quotes

---

### Example 2 — Medium (Parallel + Conditional + Loop)

Research multiple competitors in parallel, synthesize, get approval, then publish.

```
workflow "Competitive Analysis"
  inputs: topic (required)

  -- Fan out to 3 bots in parallel
  at the same time
    ask @betty "Research Notion's approach to {topic}: pricing, features, limitations" -> notion
    ask @clive "Research Coda's approach to {topic}: pricing, features, limitations" -> coda
    ask @roger "Research Confluence's approach to {topic}: pricing, features, limitations" -> confluence

  -- Synthesize all three reports
  ask @betty """
    Synthesize these competitive reports into a structured analysis:
    Notion: {notion}
    Coda: {coda}
    Confluence: {confluence}

    Include: feature comparison table, pricing comparison, recommendations.
    Start with QUALITY:HIGH or QUALITY:LOW based on report completeness.
  """ -> analysis

  -- Only proceed if quality is acceptable
  if {analysis} contains "QUALITY:HIGH"
    pause for approval with message "Review the competitive analysis before publishing: {analysis}"
      on reject
        ask @betty "Revise based on feedback: {feedback}" -> analysis
        pause for approval with message "Revised analysis ready: {analysis}"

    ask @betty "Publish this analysis to Confluence in the Product space: {analysis}"
    send #product-team "Competitive analysis for {topic} published to Confluence."
  otherwise
    send @chris "Competitive analysis quality too low — needs manual review. Topic: {topic}"
    stop "Quality gate failed"
```

This demonstrates:
- `at the same time` parallel fan-out
- Output capture across parallel branches
- Conditional branching with `contains`
- Human-in-the-loop with `pause for approval`
- Rejection loop inside an approval gate
- `send` for notifications
- `stop` with message

---

### Example 3 — Kitchen Sink

A full bug-fix pipeline: multi-model analysis, convergence loop, parallel verification, human gate, sub-workflow, and error handling.

```
workflow "Deep Fix and PR"
  inputs: ticket (required), target_branch (default "main")

  -- Phase 1: Multi-model analysis (race for fastest answer)
  race
    ask @claude-worker "Analyze Jira ticket {ticket}. Find root cause. Respond with VERDICT:FOUND or VERDICT:UNCLEAR at the start." -> analysis_a
    ask @gemini-worker "Analyze Jira ticket {ticket}. Find root cause. Respond with VERDICT:FOUND or VERDICT:UNCLEAR at the start." -> analysis_b

  -- Use whichever analysis won the race
  if {analysis_a} contains "VERDICT:FOUND"
    ask @clive "Root cause analysis: {analysis_a}" -> analysis
  otherwise
    ask @clive "Root cause analysis: {analysis_b}" -> analysis

  -- Phase 2: Write and converge on a quality fix
  ask @clive "Write an initial fix for ticket {ticket} based on: {analysis}" -> fix

  repeat until {score} is above 8 and {verdict} means "approved", at most 4 times
    at the same time
      ask @betty "Critique this fix for correctness and edge cases. Score it 1-10 (just the number): {fix}" -> score
      ask @roger "Review this fix for security issues and style. Verdict: approved/needs changes: {fix}" -> verdict

    if {score} is below 6
      ask @clive "Improve the fix significantly based on: score={score}, review={verdict}\nCurrent fix: {fix}" -> fix
    otherwise if {verdict} means "needs changes"
      ask @clive "Apply these style/security improvements: {verdict}\nCurrent fix: {fix}" -> fix

  if it never converges
    send @chris "Could not reach quality threshold after 4 rounds for ticket {ticket}."
    stop "Quality loop did not converge"

  -- Phase 3: Run tests with timeout
  ask @clive "Commit the fix to branch fix/{ticket} and run the test suite" within 15 minutes -> test_result
    if it times out
      send @chris "Test suite timed out for {ticket}. Manual intervention needed."
      stop "Tests timed out"

  if {test_result} means "failed"
    ask @clive "Tests failed: {test_result}. Debug and fix.", retry 2 times
      if it fails
        send @chris "Tests failed after retries for {ticket}. Needs manual fix."
        stop "Test retry exhausted"

  -- Phase 4: Open PR and hand off to sub-workflow
  ask @clive "Open a PR from fix/{ticket} to {target_branch}" -> pr_url

  run "Review and Merge" with pr_number = {pr_url} -> pr_result

  -- Phase 5: Notify and close
  send #engineering "Fix for {ticket} merged. PR: {pr_url}"
  ask @betty "Comment on Jira ticket {ticket}: Automated fix merged. PR: {pr_url}. Summary: {pr_result}"

-- Reusable sub-workflow (can be called from any other workflow)
workflow "Review and Merge"
  inputs: pr_number (required)

  at the same time
    ask @claude-judge "Review PR {pr_number} for correctness. VERDICT:APPROVE or VERDICT:REJECT." -> code_review
    ask @gemini-worker "Review PR {pr_number} for security. VERDICT:APPROVE or VERDICT:REJECT." -> security_review

  if {code_review} contains "VERDICT:APPROVE" and {security_review} contains "VERDICT:APPROVE"
    pause for approval with message "Both reviews passed for PR {pr_number}. Merge?"
    ask @clive "Merge PR {pr_number} and delete the branch"
  otherwise
    pause for approval with message "Reviews flagged issues on PR {pr_number}. Code: {code_review} | Security: {security_review}. Override and merge anyway?"
      on reject
        stop "PR {pr_number} not merged — review issues unresolved"
    ask @clive "Merge PR {pr_number} despite flagged issues"
```

This demonstrates:
- `race` (first-to-finish wins)
- `repeat until ... at most N times` convergence loop with compound `and` condition
- `at the same time` inside a convergence loop
- Nested `if/otherwise if` inside a loop
- `if it never converges` fallback
- `within` timeout with `if it times out`
- `retry N times` with `if it fails`
- `run "Workflow" -> capture` (sub-workflow with named capture)
- `send` for notifications to channels
- Both `contains` and `means` conditions
- Reusable sub-workflow definition in the same file

---

## Runtime Architecture

FlowSpec compiles to Temporal TypeScript. Each primitive maps 1:1:

| FlowSpec | Temporal TypeScript |
|----------|-------------------|
| `ask @bot "X" -> name` | `await executeActivity(dispatchToBot, { bot, prompt })` |
| `at the same time` | `await Promise.all([...])` |
| `race` | `Promise.race()` + CancellationScope |
| `for each x in {list}` | `for (const x of parseList(list))` + continueAsNew every 100 |
| `repeat until ... at most N` | `for` loop with condition + continueAsNew each iteration |
| `if {x} contains "Y"` | `if (x.includes("Y"))` |
| `if {x} means "Y"` | Follow-up classification call → `if (classified === "Y")` |
| `pause for approval` | `await condition(() => signals.approval !== undefined)` |
| `within <duration>` | `startToCloseTimeout` on activity |
| `retry N times` | `RetryPolicy { maximumAttempts: N + 1 }` |
| `run "Workflow"` | `await executeChild(workflowFn, { args })` |
| `send` | Fire-and-forget `executeActivity(postStatus)` |
| `read "path" -> var` | `await executeActivity(readFlowFile, { path })` |
| `write {var} to "path"` | `await executeActivity(writeFlowFile, { path, content })` |
| `stop` | `throw FlowStop` |

### Bot Registry

Bots are registered in `~/.foreman/bots.json`:

```json
{
  "betty": "C0ABC123",
  "clive": "C0DEF456",
  "claude-worker": "C0APLQ31N04",
  "gemini-worker": "C0APLQ4JYJG"
}
```

Register a new bot: `/cc bots add <name> #channel-name`

### Workflow Sources

**Slack (`/cc run`):**
- **File:** `/cc run workflow.flow "Workflow Name" key=value`
- **Named canvas:** `/cc run "Canvas Title" "Workflow Name"`
- **Default canvas:** `/cc run canvas "Workflow Name"`
- **List canvases:** `/cc canvas list`

**Mattermost (`/f run`):**
- **File:** `/f run workflow.flow key=value`
- Auto-selects the first workflow in the file (no name needed for single-workflow files)
- Disambiguate with `--name`: `/f run multi.flow --name "Workflow Name"`

### Input Parameters

Inputs declared in `inputs:` can be overridden with `key=value` pairs:

```
/f run hello-world.flow topic=cats
/f run hello-world.flow topic=the meaning of life
/f run hello-world.flow topic="the meaning of life"
/f run peer-review.flow topic="why tabs beat spaces"
```

Multi-word values work both quoted and unquoted. Unquoted values are greedy — everything after `key=` until the next `key=` is captured as the value.

### Runtime Flags

- **`--deep`** — Prepends "Think very deeply. Take your time." to every `ask` prompt. Increases per-step timeout from 30 to 45 minutes.

```
/cc run /path/to/flow.flow "Name" --deep key="value"
```

### Default Timeouts

- **Normal mode:** 30 minutes per `ask` step
- **`--deep` mode:** 45 minutes per `ask` step
- **Override per step:** `ask @bot "..." within 1 hour`

### Validation

Before running, `/cc run` validates:
- All bot names in the workflow exist in `bots.json`
- Required inputs are provided
- Parallel branches don't reuse the same bot

---

## AWS AgentCore Port (In Progress)

Because FlowSpec is Turing complete, it can be compiled to any other Turing-complete workflow system. The AWS AgentCore port compiles FlowSpec to a two-layer architecture:

- **Outer layer:** AWS Step Functions — handles sequential steps, branching, parallel fan-out, loops
- **Inner layer:** AWS AgentCore — handles each `ask` step; runs Claude in a managed microVM with tool access

MFP (MyFitnessPal) has an existing AWS account and has made a formal decision (Confluence: "Hosting Agent Infrastructure") to use AgentCore as the agent runtime (hybrid approach, us-east-1 region).

The compilation mapping for AgentCore targets:

| FlowSpec | AgentCore / Step Functions |
|----------|--------------------------|
| `ask @bot "X"` | `InvokeAgent` API call (AgentCore) |
| `at the same time` | Step Functions `Parallel` state |
| `for each` | Step Functions `Map` state |
| `if/otherwise` | Step Functions `Choice` state |
| `run "Workflow"` | Step Functions sub-state-machine |
| `read "path" -> var` | Lambda function (S3 or EFS read) |
| `write {var} to "path"` | Lambda function (S3 or EFS write) |
| `pause for approval` | Step Functions `Wait` state + callback token |

---

## See Also

`docs/flowspec.md` is the full engineering spec — it covers topics not in this reference doc:

- **The 80% Patterns** — how real-world workflows break down into primitives
- **Hard Problems (the 20%)** — `dispatchToBot` TypeScript pseudocode, bot pool design, security/trust model gaps
- **Compilation Boundary** — exactly what the compiler does vs. what the runtime handles
- **Runtime Infrastructure** — activity retry logic, signal handling, `continueAsNew` mechanics
- **Build Order** — recommended implementation sequence for the compiler

If you're implementing the FlowSpec compiler or extending the runtime, start there.
