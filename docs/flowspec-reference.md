# FlowSpec Language Reference

**Version:** V1 (implemented)
**Runtime:** Temporal TypeScript (running); AWS AgentCore (in progress)
**Authors:** Chris Shreve + Delphi research process (3 rounds, 6 agents)

---

## Overview

FlowSpec is a workflow description language for orchestrating AI bots. It was designed with Turing completeness as its first and primary principle — everything else is secondary.

**Design principles, in order:**

1. **Turing complete.** Self-referential `run "Workflow"` + `if/otherwise` conditional branching = unbounded recursion with conditional base cases. By the Church-Turing thesis, any computation expressible in any Turing-complete system can be expressed in FlowSpec.
2. **PM-writable.** A non-engineer product manager should be able to write 80% of workflows without help.
3. **Efficient AI↔human communication.** Minimal syntax; all complexity lives in the bots and runtime, not the language.

**How it runs:** FlowSpec compiles to Temporal TypeScript. The `/cc run` Slack command starts a workflow execution. Each `ask` step dispatches work to a named bot (Slack channel), waits for the response, and captures it into a named variable.

**Porting targets:** Because FlowSpec is Turing complete, it can be mechanically compiled to any other Turing-complete workflow system. Current and planned targets:
- **Temporal** (running in production locally)
- **AWS AgentCore** (port in progress — MFP has an existing AWS account and a decision to use AgentCore for agent hosting)
- Theoretically also: AWS Step Functions, LangGraph, Apache Airflow, Prefect, Temporal Cloud

---

## Language Primitives

12 primitives total.

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

A `.flow` file can contain multiple `workflow` blocks. The run command specifies which to invoke:

```
/cc run myfile.flow "Workflow Name"
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

- **File:** `/cc run path/to/workflow.flow "Workflow Name"`
- **Named canvas:** `/cc run "Canvas Title" "Workflow Name"`
- **Default canvas:** `/cc run canvas "Workflow Name"`
- **List canvases:** `/cc canvas list`

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
| `pause for approval` | Step Functions `Wait` state + callback token |
