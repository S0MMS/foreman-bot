# Delphi Performance — v1
**Created:** 2026-03-25
**Mode:** `--design --deep`
**Changes from previous:** Initial version

---

## Setup

- **Workers:** `#WORKER_1`, `#WORKER_2`, `#WORKER_3`
- **Judge:** run the command from the judge channel

## Prompt

```
/cc delphi --design --deep #WORKER_1 #WORKER_2 #WORKER_3 "How should we improve the Delphi multi-agent process to maximize informational correctness — producing output that is more accurate and contains fewer hallucinations than asking the same question to a single model?

Background: The Delphi process runs multiple Claude Code bots (workers) who independently answer a question. A judge synthesizes and verifies their answers. Workers then critique the judge. The judge produces a final answer. There are 3 modes: 'code' (workers read source files, judge verifies claims against actual code), 'research' (workers enumerate options/tradeoffs, judge fills gaps), 'design' (workers propose solutions, judge evaluates feasibility). Implementation is at /Users/chris.shreve/claude-slack-bridge/src/temporal/ if useful.

Explore these questions:

1. Are the three current modes (code/research/design) the right taxonomy? Should there be an 'investigate' mode for 'what is the current state of X?' Should prompts differ more radically across modes?

2. What does the academic Delphi literature and multi-agent debate research say about improving accuracy? Are there specific techniques (structured disagreement, explicit uncertainty quantification, devil's advocate roles) that measurably reduce hallucinations?

3. What is the optimal number of rounds? Would a third round of worker↔judge debate improve output, or do returns diminish quickly?

4. Is it possible to measure 'informational correctness'? Propose a concrete test harness that could verify whether Delphi output is more accurate than single-model output on the same question. What would a benchmark look like?

5. Are there prompt engineering improvements — chain-of-thought, VERDICT tags, requiring explicit source citations — that should be applied systematically across all modes?"
```
