# FlowSpec — v1
**Created:** 2026-03-25
**Mode:** `--design --deep --context /Users/chris.shreve/claude-slack-bridge/docs/flowspec.md`
**Changes from previous:** Initial version

---

## Setup

- **Workers:** `#WORKER_1`, `#WORKER_2`, `#WORKER_3`
- **Judge:** run the command from the judge channel

## Prompt

```
/cc delphi --design --deep --context /Users/chris.shreve/claude-slack-bridge/docs/flowspec.md "Critically evaluate and improve FlowSpec — a minimal workflow DSL for orchestrating AI bots that compiles to Temporal workflows.

The PRIMARY purpose of FlowSpec, in strict priority order:
1. 80% of real-world workflow scenarios involving AI can be expressed in it — this is the most important goal
2. Non-technical people (product managers, not engineers) can write it naturally
3. Whatever the syntax, it must translate cleanly and obviously into Temporal workflows
4. MINIMAL primitives — every primitive must earn its place by covering real scenarios
5. Super extra bonus: Turing completeness

The language is NOT executed directly. It is always compiled to Temporal TypeScript. This is the key insight: the language only needs to be expressive enough to describe intent — Temporal handles the hard runtime problems (durability, retries, timeouts, state).

Specific questions to address:

1. Given the primary purpose — 80% of real AI workflow scenarios, written by non-engineers — what are the most common patterns people actually need? Think: 'research this and give me a report', 'have 3 bots investigate in parallel and pick the best answer', 'keep revising until I approve it', 'do this for each item in a list'. Does the current language cover these naturally?

2. The current design has 12 primitives. Which can be eliminated or merged without losing real-world coverage? Can 'notify' just be 'ask' without waiting for a reply? Can the two loop types collapse into one? Can 'call' be expressed differently?

3. Is the syntax readable and writable by a non-engineer encountering it for the first time? Walk through the examples in the doc as if you are a product manager. What is confusing, awkward, or requires technical knowledge to understand?

4. Does every construct map cleanly to Temporal? Are there any primitives that would be hard to compile reliably? Are there simpler constructs that would be easier to compile while expressing the same intent?

5. On Turing completeness: the language has conditionals, bounded loops, and recursion via 'call'. Is it already Turing complete? The mandatory 'at most N times' on loops limits it — what is the minimal change that achieves Turing completeness while remaining safe and non-technical-user-friendly?

Deliver: a revised primitive table (your recommended minimal set), a revised syntax for anything that should change, and 3 new example workflows written in your revised syntax that demonstrate real-world AI workflow scenarios not covered in the existing doc."
```
