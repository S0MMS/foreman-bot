# Recursive Pythia Architecture — Analysis Results

**Question:** Is recursive multi-model verification a sound architectural pattern for multi-stack AI code generation?

**Method:** 5-phase Pythia (3 independent explorations, judge synthesis, 3-angle critique, revision, independent fact-check)

**Date:** 2026-03-29

---

## Core Verdict

**The recursive architecture is sound.** Running 4 parallel sub-Pythias (one per stack) feeding into a Coordinator Pythia solves the two problems stated: context window limits and hallucination-at-scale. High confidence across all three independent analyses on this point.

---

## Key Design Decisions

### 1. Sub-Pythia Phase Depth: Vary by Stack

Phase depth should **not** be uniform. A typed, compiled codebase (Swift, Kotlin) gets less LLM verification and more compiler validation. A loosely-typed backend needs deeper analysis.

Recommended per-stack configuration:

```
ios:      { explore: 2, critique: 1, validate: "build" }
android:  { explore: 2, critique: 1, validate: "build" }
backend:  { explore: 3, critique: 2, validate: "typecheck" }
database: { explore: 2, critique: 1, validate: "schema-diff" }
```

### 2. Model Count per Sub-Pythia: Unresolved

The initial recommendation of 2 models (down from 3) was accepted by vote, not evidence, and contradicts the concern about blind-spot alignment. With 4 sub-Pythias x 2 models = 8 model slots across ~3 model families, some sub-Pythias inevitably share the same pair, reducing diversity.

**Recommendation:** Treat as a tuning parameter. Start with 2, measure divergence rates in a pilot.

### 3. Coordinator Does Fundamentally Different Work

Sub-Pythias analyze code. The Coordinator synthesizes verified analyses, resolves contradictions, and produces a cross-stack implementation contract. Different reasoning, different prompts.

### 4. Contradiction Handling

Classify contradictions between sub-Pythia outputs as:
- **Factual:** Query-back to source sub-Pythia for resolution
- **Assumption-based:** Flag for human decision
- **Genuine tension:** Present tradeoffs with structured context

Confidence should propagate as structured objects with dissent summaries, not bare scores:

```json
{
  "confidence": 0.6,
  "basis": "2/3 models agreed",
  "dissent": "Model C claims field is conditionally populated behind feature flag",
  "verification": "file_exists only — no runtime check"
}
```

### 5. Cross-Stack Context: Use Static Manifests

Use **static interface manifests** (OpenAPI specs, protobuf definitions, schema files) for cross-stack context rather than LLM-generated summaries. Avoids injecting unverified claims into the verification process. If no such manifests exist, generating them is a prerequisite and a valuable artifact in its own right.

### 6. Sub-Pythia Validation Should Include Execution Gates

A `swift build` or type-check that confirms compilation is worth more than three models agreeing code compiles. Where feasible, sub-Pythia validation should include lightweight build/type-check steps, not just file-existence checks.

---

## Refuted Claims

Two factual claims in the analysis were refuted during independent verification:

1. **`kotlinc` has no dry-run flag.** The analysis suggests "`swift build` or `kotlinc` dry-run" as a validation step — `swift build` works, but `kotlinc` does not support dry-run mode. A full compile or Kotlin's analysis API would be needed instead.

2. **Cost multiplier is 17-50x, not 30-50x.** Single-model call ~$0.30, recursive Pythia $5-15. The lower bound of the stated range is 17x ($5/$0.30), not 30x.

---

## Unverifiable Claims (Treat as Hypotheses)

| Claim | Status |
|---|---|
| Single strong model gets 90% of cross-stack features right | No empirical basis provided |
| Latency of 4-6 min wall time | Plausible but implementation-dependent |
| 30% human-intervention threshold as failure metric | Reasonable but arbitrary |
| $5-15 per feature analysis | Holds for moderate contexts; could exceed $15 with large contexts |

---

## Critical Gap: The Human Review Gate

The strongest criticism across all analyses: **the human gate is undesigned.** If most cross-stack features generate multiple "DECISION NEEDED" flags, the system becomes an expensive option-presenter rather than an automation system.

Design requirements (previously missing from the architecture):
- **Format:** Structured contract with clear sections — confirmed (no flags), needs-decision (with options/tradeoffs), conflicting (with source analyses quoted)
- **Human options:** Approve / Reject / Modify specific section / Send contradiction back to named sub-Pythia
- **Post-modification:** Human edits are final — re-validation would create an infinite loop
- **Success metric:** If >30% of features require heavy intervention (>3 decision flags), the architecture needs redesign

---

## Implementation Gap: Post-Contract Execution

The analysis acknowledged that "specialist agents implement against the contract" is hand-waved. Open questions that must be answered before the system is end-to-end:

- What happens when an implementation agent discovers the contract is wrong?
- Do implementation agents across stacks coordinate, or work independently?
- Is there post-implementation verification that checks code against contract?

---

## The Honest Limitation

The system occupies a **band of feature complexity**: complex enough to need multi-stack coordination, simple enough that stacks can be analyzed near-independently. Trivial changes don't need it; deeply entangled rewrites (auth overhauls, data model migrations) may exceed its sweet spot.

---

## Cost Estimates

| Component | LLM Calls | Sequential Latency |
|---|---|---|
| Sub-Pythia (per stack) | 4-5 | ~45-90s |
| 4 stacks in parallel | 16-20 total (parallel) | ~45-90s wall time |
| Coordinator (5-phase) | ~9 | ~2-3 min |
| Query-backs (est. 2 stacks) | ~6 | ~30-60s |
| **Total** | **~31-35** | **~4-6 min wall time** |

Estimated cost: **~$5-15 per feature analysis** at Opus-class pricing with moderate contexts.

---

## Confidence Summary

**High confidence:**
- Recursive architecture is sound for the stated problem
- Coordinator does fundamentally different reasoning than sub-Pythias
- Contradiction classification (factual / assumption / tension) with different resolution paths
- Output schema is the critical artifact
- All five recursive failure modes identified are real
- Execution gates (build/typecheck) should be included in sub-Pythia validation

**Medium confidence:**
- 3-phase sub-Pythia as default — but phase depth should be stack-proportional
- Query-back mechanism is valuable but adds complexity
- Cost/ROI is plausible but must be validated by pilot

**Uncertain:**
- Optimal model count per sub-Pythia (2 vs. 3) — no empirical basis
- Cross-stack summary injection approach — static manifests preferred over LLM-generated
- Confidence aggregation function — structured objects, exact formula TBD
- Whether the architecture's sweet spot is wide enough to justify investment

---

## Recommended Next Step

Run a **10-feature pilot** comparing recursive Pythia vs. single-model analysis on real feature requests. This validates ROI, characterizes the complexity sweet spot, and provides empirical data for the unresolved tuning parameters (model count, phase depth, cost).
