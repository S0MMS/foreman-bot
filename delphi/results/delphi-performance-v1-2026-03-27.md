# Delphi Performance v1 — Final Recommendation

**Date:** 2026-03-27
**Process:** Delphi (2 workers, 1 judge, 2 critics)
**Subject:** Improving informational correctness of the Delphi multi-agent process

---

## Consensus Findings

Both workers, the judge, and both critics converged on these points:

| Finding | Confidence |
|---|---|
| Current 4-phase, 2-round structure is at the sweet spot | High — literature consistently shows 2-3 rounds optimal |
| All workers getting identical prompts is suboptimal | High — ChatEval, ReConcile, Zhang et al. all support heterogeneity |
| Code mode is the strongest mode; research/design are under-differentiated | High — code mode has structural verification, others have vague evaluation |
| Source citations should be required in all modes, not just code | High — VeriFact-CoT: +67% citation F1 |
| Don't add more debate rounds | High — diminishing returns, problem drift beyond 3 rounds |
| A benchmark harness is necessary to measure whether changes actually help | High — without measurement, you're guessing |
| Monoculture (all workers are Claude) is the biggest structural risk | High — but no easy fix with same-model workers |

---

## Key Disagreements and Resolutions

### 1. Investigate Mode: New mode vs flag?

- **Worker 1 (judge):** Don't add it — alias to `code` mode
- **Worker 2:** Add as fourth mode with distinct prompts
- **Critic 1:** Agree with judge — add `--investigate` flag to code mode instead
- **Critic 2:** Add `--thorough` flag, don't create a full mode

**Resolution:** Add a flag (`--investigate` or `--thorough`) that modifies code-mode prompts to emphasize completeness over correctness. A full mode isn't justified — the behavioral difference is one sentence.

### 2. Structured Summary Pre-Processing (replace raw worker text to judge)

- **Worker 1 (judge):** Recommended as #4 priority — add agree/disagree/unique summary step
- **Critic 1:** Skeptical — introduces new hallucination surface, lossy compression contradicts Du et al. finding that reasoning chains > summaries
- **Critic 2:** Agrees it contradicts the literature — "structured summaries are closer to 'final answers' than 'reasoning chains'"

**Resolution: Drop this.** Instead, strengthen the judge prompt to self-produce a structured comparison as its first step before synthesis. Gets the same analytical benefit without information loss or an extra LLM call.

### 3. Claim Decomposition: Atomic claims in all modes?

- **Worker 1 (judge):** Yes — require numbered atomic claims with confidence tags across all modes
- **Critic 1:** Counterproductive for research/design — destroys causal reasoning chains. Use confidence-tagged outline sections instead.
- **Critic 2:** Not addressed directly

**Resolution:** Mode-specific approach:
- **Code mode:** Require atomic claims with `file:line` citations (already nearly does this)
- **Research/design modes:** Require confidence-tagged *sections* (HIGH/MEDIUM/LOW per section), not atomic claims per sentence. Preserves reasoning chains while giving the judge verification targets.

### 4. Devil's Advocate: Mandatory minimum ("MUST find 3 problems")?

- **Worker 1 (judge):** Yes — assign one critic with mandatory 3-problem minimum
- **Critic 1:** Mandatory minimum incentivizes fabricated criticism. Use softer framing.
- **Critic 2:** Agrees adversarial role is good but doesn't address the quota issue

**Resolution:** Devil's advocate role yes, mandatory quota no. Use: "Your role is to identify weaknesses. Focus on unsupported claims, unstated assumptions, and underestimated risks. If the answer is strong, explain *why* it's strong and what would have to be true for it to be wrong."

### 5. Worker Heterogeneity: Phase 1 or Phase 2?

- **Workers + Judge:** Differentiate worker perspectives in Phase 1 (generalist, skeptic, edge-explorer)
- **Critic 2:** Differentiate in Phase 2 (critique) instead — Phase 1 perspective constraints narrow the search space, and more diverse Phase 1 output worsens judge context pressure

**Resolution:** Differentiate in **Phase 2 (critique)**, not Phase 1. Phase 1 workers should independently build the most complete answer they can. Critic roles:
- Critic 1: "Focus on factual accuracy — verify specific claims against the code"
- Critic 2: "Focus on completeness — what important aspects did the judge miss entirely?"
- Critic 3: "Play devil's advocate — find the strongest argument that the key conclusions are wrong"

### 6. Phase 5 Fact-Checker

- **Worker 2:** Proposed Chain-of-Verification Phase 5 — independent agent fact-checks final answer
- **Critic 1:** Not addressed
- **Critic 2:** Endorsed, but flagged the key question: what happens when it flags a claim?

**Resolution:** Add Phase 5 with **append-only output** — fact-checker flags are appended as a "Verification Notes" section, no further judge revision. The fact-checker gets a fresh context window (no debate history), which also addresses the context window pressure problem.

---

## Implementation Plan (Priority Order)

### Prompt-Only Changes (ship immediately)

| # | Change | Rationale |
|---|---|---|
| 1 | **Require source citations + uncertainty markers in all modes** | Highest-evidence technique. Add to all worker/judge prompts: code claims cite `file:line`, knowledge claims marked `[FROM KNOWLEDGE]`, uncertain claims marked `[UNCERTAIN: reason]` |
| 2 | **Differentiate critic perspectives in Phase 2** | Literature-supported heterogeneity, applied where it helps most without constraining Phase 1 search |
| 3 | **Softer devil's advocate for one critic** | Adversarial protocols beat cooperative (Khan et al.), without fabrication-incentivizing quotas |
| 4 | **Confidence & Caveats section in final output** | Prevents confident hallucination. Add to Phase 3 judge prompt. |
| 5 | **Anti-sycophancy instruction for all critics** | "You are evaluated on critique quality, not agreement. Do not soften valid criticisms." |
| 6 | **Confidence-tagged outline for research/design workers** | Gives judge verification targets without destroying reasoning chains |
| 7 | **Structured self-comparison for judge** | Judge begins with agree/disagree/unique analysis before synthesis (replaces external summary step) |

### Code Changes (implement next)

| # | Change | Rationale |
|---|---|---|
| 8 | **Add `--thorough` flag** | Modifies code-mode prompts for completeness-focused investigation |
| 9 | **Add Phase 5 fact-checker** | CoVe pattern, append-only output, fresh context window. Mode-specific: code mode re-reads files, research mode checks citations exist |
| 10 | **Worker output length limits + truncation safety** | Prevents silent context overflow. `MAX_WORKER_CHARS = 15_000` with truncation notice |
| 11 | **Worker completion status in judge prompt** | "3 workers dispatched, 2 responded, Worker 3 timed out" — lets judge reason about incomplete input |
| 12 | **Token budget directive for workers** | "Keep your answer under 3000 words. Prioritize precision over exhaustiveness." Protects judge context budget. |

### Investment (build for measurement)

| # | Change | Rationale |
|---|---|---|
| 13 | **Build Tier 1 benchmark** | 30 grep-verifiable questions about the MFP codebase. Fully automated scoring. Run weekly. |
| 14 | **Add rubric-based eval for research/design** | 5-10 dimensions scored 1-5 by independent Claude instance. Automated, repeatable, trackable. |
| 15 | **Quarterly human eval for Tier 3** | 10 design questions, 2 evaluators, blind A/B comparison. Low-frequency but ground-truth calibration. |

---

## What NOT to Do

1. **Don't add more debate rounds** — literature ceiling is 2-3 rounds; a Phase 5 fact-checker is better than a third debate round
2. **Don't add a structured summary intermediary** — contradicts Du et al. on reasoning chain sharing, introduces new hallucination surface
3. **Don't force atomic claim decomposition on research/design modes** — destroys causal reasoning chains
4. **Don't use mandatory critique quotas** — incentivizes fabricated criticism
5. **Don't differentiate worker perspectives in Phase 1** — constrains search space, worsens context pressure
6. **Don't build convergence-based early termination yet** — optimization for a system that doesn't yet measure accuracy
7. **Don't force consensus** — "workers disagreed on X" is a valid final answer

---

## Critic-Surfaced Issues Not in Original Proposals

These were raised by the critics and not addressed by either worker:

1. **Context window pressure** — With 3 workers producing deep answers, the Phase 1 judge prompt can hit 30K+ tokens before doing any work. Phase 3 is worse. This creates systematic bias: later claims get less verification.

2. **`collectWorkerMessages` truncation risk** — Worker messages collected with `limit: 50`, joined with `\n\n`, no length check. Exceptionally long output could exceed model context window silently.

3. **Worker timeout opacity** — If a worker times out, the judge doesn't know it existed. Can't reason about whether missing perspectives would have changed the answer.

4. **Monoculture mitigation via web grounding** — For research/design modes, requiring workers to use `WebSearch`/`WebFetch` for some claims introduces external information that breaks pure training-data monoculture. Current prompts don't mention web tools.

---

## Benchmark: Quick-Start Spec

Start with Tier 1 only (grep-verifiable facts). 30 questions, 4 conditions:

| Condition | Description |
|---|---|
| Single | 1 Claude Code instance, same prompt/timeout as Delphi worker |
| Self-consistency | 3 independent instances, majority vote |
| Delphi-current | Current 4-phase workflow |
| Delphi-improved | After prompt changes above |

**Metrics:** Precision (correct/total claims), hallucination rate (fabricated/total claims), completeness (correct claims / reference claims).

**Scoring:** Automated via independent Claude instance with file access but no access to the original answer (factored verification). Human spot-check 20% to validate.

**Cadence:** Weekly after prompt changes, monthly otherwise.

---

## Key Literature Referenced

| Paper | Key Finding | Relevance |
|---|---|---|
| Du et al. (2023, ICML 2024) | 3 agents, 2 rounds = +5-10% accuracy; debate corrects errors all agents initially got wrong | Validates core Delphi architecture |
| Khan et al. (2024, ICML Best Paper) | Debate +28 points vs baseline; truth has inherent persuasive advantage | Supports adversarial critic roles |
| Dhuliawala et al. (2023) | Chain-of-Verification: 50-77% hallucination reduction with factored verification | Supports Phase 5 fact-checker |
| Wang et al. (2022) | Self-consistency: +17.9 points on GSM8K via majority voting | Baseline Delphi must beat |
| Chan et al. (2023, ChatEval) | Identical role descriptions degrade multi-agent performance | Supports heterogeneous critic roles |
| Smit et al. (2024, ICML) | Multi-agent debate doesn't reliably beat self-consistency when poorly configured | Cautionary — prompt quality matters more than architecture |
| Zhang et al. (2025) | Model heterogeneity is the key unlock; persona variation is weak substitute | Monoculture is the hardest problem to solve |
| Liang et al. (2023) | Degeneration of Thought — self-reflection traps LLMs in wrong answers | Validates independent workers over iterative self-correction |
