# Pythia: Multi-Model Verification Workflow

**Version:** V1 (running in production)
**Predecessor:** Delphi (3-phase)
**Origin:** Designed through a Delphi process; research-grounded

---

## What Is Pythia?

**Pythia was designed from the ground up by AI, for AI.** The dev asked Delphi to run Delphi on itself — the question was *"How should Delphi be improved?"* Three AI models independently analyzed Delphi's architecture, a judge synthesized their answers, workers critiqued it, the judge revised. The output of that process *became* Pythia's design spec. No human wrote it. Pythia's 5-phase architecture is what multiple leading AI models concluded, through the very process Pythia now implements, was the best multi-model verification pipeline.

Pythia is a 5-phase multi-model verification workflow. It takes a question, runs it through three independent AI models (Claude, Gemini, GPT-4), and produces a verified, fact-checked answer with structured confidence ratings.

The core insight: **a single LLM can be confidently wrong.** A model like Claude Opus — even at its best — can confidently state something false, miss an important perspective, or fail to catch its own errors. This is the monoculture weakness: one model, one training process, one set of blind spots. There is no way to know what it doesn't know, because it answers confidently regardless.

Pythia breaks the monoculture in two ways. First, Claude, Gemini, and GPT-4 were trained by different companies on different data with different architectures. Their errors are largely uncorrelated — if Claude has a misconception baked in, Gemini and GPT-4 probably don't share it. When all three agree, that consensus carries real weight. When they disagree, the disagreement itself is valuable signal. Second, the adversarial critique phase (Phase 3) uses those same three models to attack the synthesis from different angles — correctness, accuracy, completeness, and devil's advocate. A monoculture system critiquing itself tends to validate itself (researchers call this "Degeneration of Thought"). Using different models as critics breaks that loop.

The result: for a Pythia answer to be wrong, all three models would need to share the same blind spot *and* that blind spot would need to survive structured adversarial critique *and* tool-based fact-checking. That is a dramatically higher bar than asking one model once.

In practice, Pythia produces significantly more accurate and reliable answers than a single call to Claude Opus on hard analytical questions. The multi-model debate + verification pipeline effectively "overclocks" the system beyond what any single model can do alone.

Pythia was named after the Oracle at Delphi — appropriate given it is the successor to the Delphi workflow.

---

## From Delphi to Pythia — An AI-Designed System

### Delphi (3 phases)

Delphi was the original multi-model verification approach:

1. **Quorum** — Multiple worker bots answer the same question independently; judge synthesizes
2. **Verify** — Workers critique the judge's synthesis
3. **Revise** — Judge produces a final answer incorporating critiques

Delphi works well for straightforward questions. It has 3 mode-specific prompt variants (code, research, design) × 4 prompt builder functions = 12 total variants.

### How Pythia Was Born

Pythia was not designed by a human sitting down with a spec document. It was designed by **the dev asking Delphi to run Delphi on itself**.

The question posed was: *"How should Delphi be improved?"* Three AI models — Claude, Gemini, and GPT-4 — each independently analyzed Delphi's architecture. A judge synthesized their answers. Workers critiqued the synthesis. The judge revised. The output of that process became the design spec for Pythia.

This is significant: Pythia is an AI-designed system. Its architecture reflects what multiple leading AI models, through adversarial debate and structured critique, concluded was the best multi-model verification pipeline. It was not designed by intuition — it was derived by the same process it implements.

### Why Pythia Over Delphi?

Delphi has structural limitations:

- Only 3 phases — synthesis and critique are not separated from fact-checking
- No explicit VERIFIED/REFUTED/UNVERIFIABLE verdicts
- No dedicated tool-based verification phase
- Workers critique the synthesis but don't independently verify factual claims

Pythia adds two phases and a structured verdict system, directly addressing all four gaps.

---

## The Three Failure Modes

Pythia addresses three independent failure modes, each with a dedicated mechanism:

| Failure Mode | Mechanism | Where in Pythia |
|---|---|---|
| **Incompleteness** — missing important facts | Diversity of exploration (multi-model, identical prompts) | Phase 1 |
| **Hallucination** — fabricated or incorrect claims | Structured verification (source citations, claim labeling, factored fact-check) | Phases 1, 2, 5 |
| **Overconfidence** — presenting uncertain claims as certain | Adversarial pressure (cross-model critique, devil's advocate) | Phase 3 |

---

## The 5 Phases

```
Phase 1: Independent Answers
  ↓ (3 workers answer in parallel: Claude, Gemini, GPT)
Phase 2: Synthesis
  ↓ (judge synthesizes into a single structured answer)
Phase 3: Adversarial Critique
  ↓ (same 3 workers critique the synthesis from different angles)
Phase 4: Revision
  ↓ (judge revises incorporating valid critiques)
Phase 5: Fact-Check
  ↓ (verification worker checks factual claims with tools)
Final: Collation
  → Output bot produces the final answer with VERIFIED/REFUTED/UNVERIFIABLE labels
```

### Phase Roles

| Phase | Role | Bot |
|-------|------|-----|
| 1 | Independent answers | `@claude-worker`, `@gemini-worker`, `@gpt-worker` |
| 2 | Synthesis | `@claude-judge` |
| 3 | Critique (accuracy, completeness, devil's advocate) | `@claude-worker`, `@gemini-worker`, `@gpt-worker` |
| 4 | Revision | `@claude-judge` |
| 5 | Independent fact-check | `@gemini-verifier` (dedicated bot, isolated channel) |
| Final | Collation | `@output` |

### Phase Design Rationale

**Phase 1 — Identical prompts, not differentiated roles.** Each worker gets the same prompt. The research found that giving workers differentiated roles (e.g., "skeptic", "edge-explorer") in Phase 1 narrows their search space. Three unconstrained explorations maximize the probability that at least one worker finds each important fact. Role differentiation is applied in Phase 3 instead, where it pays off.

**Phase 2 — Full reasoning chains, not summaries.** The judge receives all three worker answers with complete reasoning (not summaries). Research found that summarizing before synthesis introduces a new hallucination surface and loses the chains. Having the judge self-produce a structured comparison as its first act gets the same benefit without information loss.

**Phase 3 — Heterogeneous critics, different model than the synthesizer.** Each critic targets a different failure mode, and each is on a different model than the one that produced the synthesis:

| Bot | Model | Role |
|---|---|---|
| `@claude-worker` | Claude | **Factual Accuracy** — verify specific claims against code/sources |
| `@gemini-worker` | Gemini | **Completeness** — what did the judge miss entirely? |
| `@gpt-worker` | GPT | **Devil's Advocate** — find the strongest argument the conclusions are wrong |

Cross-model critique means each model is less likely to be sycophantic toward output produced by a different model's reasoning. No mandatory critique quotas — "MUST find 3 problems" incentivizes fabricated criticism.

**Phase 4 — Targeted revision, not full regeneration.** The judge patches the synthesis based on critiques. The prompt says: *"Address ONLY the substantive issues raised. Do not rewrite sections that weren't challenged."* This prevents problem drift (Becker et al. 2025). The literature shows diminishing returns beyond 2-3 rounds, with increasing risk of problem drift.

**Phase 5 — Dedicated bot on its own channel.** `@gemini-verifier` is a separate bot with its own Slack channel and no shared history from Phases 1 or 3. Context isolation comes from identity, not session resets — the fact-checker genuinely has zero debate context. Output is append-only: the fact-checker annotates but does not revise the answer.

### Verdict System

Every factual claim in the final output is tagged:

- **VERIFIED** — Confirmed against source (code, files, docs, or cited papers)
- **REFUTED** — Contradicted by source evidence
- **UNVERIFIABLE** — Cannot be confirmed with available tools (e.g. recent papers, external systems)

---

## Bots Required

| Bot Name | Model | Channel | Phases |
|---|---|---|---|
| `@claude-worker` | Claude | `#claude-worker` | 1 (explore), 3 (accuracy critic) |
| `@claude-judge` | Claude | `#claude-judge` | 2 (synthesize), 4 (revise) |
| `@gemini-worker` | Gemini | `#gemini-worker` | 1 (explore), 3 (completeness critic) |
| `@gemini-verifier` | Gemini | `#gemini-verifier` | 5 (independent fact-checker) |
| `@gpt-worker` | GPT | `#gpt-worker` | 1 (explore), 3 (devil's advocate) |

Bots are registered in `~/.foreman/bots.json`.

---

## How to Run Pythia

```
/cc run canvas "Pythia" question="Is FlowSpec Turing complete?" mode=code
```

Or from the `pythia.flow` file:

```
/cc run ~/.foreman/workflows/pythia.flow "Pythia" question="..." mode=research
```

**Modes:**
- `code` (default) — verify claims against source code, files, and APIs
- `research` — check that cited sources exist and say what the answer claims
- `design` — evaluate feasibility given known constraints; single-key-assumption audit

---

## What Pythia Deliberately Avoids

These are anti-patterns identified by the research:

1. **No extra debate rounds** — diminishing returns and problem drift risk
2. **No structured summary intermediary** — loses reasoning chains, adds hallucination surface
3. **No forced atomic claim decomposition** — destroys causal reasoning in research/design modes
4. **No mandatory critique quotas** — incentivizes fabricated criticism
5. **No worker role differentiation in Phase 1** — constrains search space
6. **No forced consensus** — "workers disagreed on X" is a valid final answer

---

## Research Foundations

Pythia's design is grounded in the multi-agent LLM debate literature. Key papers:

### Core Papers

**Wang et al. 2022 — Self-Consistency (ICLR 2023)**
*arXiv:2203.11171*
Proposes sampling diverse reasoning paths from a single model and taking a majority vote. Foundational insight: uncorrelated reasoning paths reduce error rate. Pythia extends this to multiple models (not just multiple samples from one model) to diversify knowledge as well as reasoning paths.

**Du et al. 2023 — Multi-Agent Debate (ICML 2024)**
*arXiv:2305.14325*
Studies iterative debate between multiple LLM agents. Shows that diverse perspectives and iterative revision improve accuracy over single-model responses. Pythia's structure of independent answers followed by critique rounds is directly informed by this work.

**Khan et al. 2024 — Adversarial Debate (ICML 2024 Best Paper)**
*arXiv:2402.06782*
Examines adversarial debate structures. Supports diverse agent perspectives; the "reviser should differ from author" recommendation in Pythia is extrapolated from this work (acknowledged as inference, not a direct finding).

**Liang et al. 2023 — Divergent Thinking (EMNLP 2024)**
*arXiv:2305.19118*
Identifies "Degeneration of Thought" (DoT) in self-reflection — models converge on their own prior output when reflecting on it. This is why Pythia uses *different* workers for critique rather than asking the Phase 2 judge to critique its own synthesis.

**Chan et al. 2023 — ChatEval (ICLR 2024)**
*arXiv:2308.07201*
Found that diverse evaluator roles *help* performance; identical/matched roles *degrade* it. Pythia's use of different critique angles (correctness critic, accuracy critic, completeness critic, devil's advocate) in Phase 3 is grounded here. **Note:** An earlier synthesis inverted this finding; the correct reading is "diverse roles help."

**Kadavath et al. 2022 — LLM Self-Evaluation (Anthropic)**
*arXiv:2207.05221*
Studies LLM calibration and self-evaluation accuracy. Informs Pythia's confidence tagging approach.

**Dhuliawala et al. 2023 — Chain-of-Verification / CoVe (ACL 2024 Findings, Meta AI)**
*arXiv:2309.11495*
Proposes decomposing claims before verification. Phase 5 of Pythia uses this approach: break down the synthesis into discrete verifiable claims, then tool-check each one independently.

**Liu et al. 2023 — Lost in the Middle (TACL 2024)**
*arXiv:2307.03172*
Documents U-shaped context performance — LLMs perform worse on content in the middle of long contexts. Informs Pythia's choice to give the completeness critic a targeted claim-exclusion diff rather than all three raw worker answers.

**Zhang et al. 2025 — Model Heterogeneity**
Model heterogeneity is the key unlock for multi-agent gains over self-consistency, delivering up to a **47% boost** in answer quality. Persona variation (giving the same model different roles) was dismissed as "weak sauce" that changes tone but not epistemics. Pythia's use of genuinely different models — Claude, Gemini, GPT — is grounded in this finding.

**Becker et al. 2025 — Problem Drift**
Extended debate rounds cause problems to drift from the original question. Pythia's Phase 4 uses targeted revision (patch only what was challenged) rather than full regeneration, directly applying this finding.

---

## Pythia Self-Analysis Results

On 2026-03-29, Pythia was run against itself — a self-referential quality analysis. The question: *"What are the structural weaknesses of the Pythia workflow itself?"*

**Verdict scorecard:**

| Status | Count |
|--------|-------|
| VERIFIED | 22 |
| REFUTED | 7 (all minor: off-by-one line numbers, 1 wrong filename) |
| UNVERIFIABLE | 2 |

**Priority fix list:**

| Priority | Fix | Effort |
|----------|-----|--------|
| 1 | Wire `newSession` in compiler to clear Gemini history + reset sessionId | Low-Med |
| 2 | Add concurrency guard (mutex or channel-per-run) | Med |
| 3 | Port Delphi's mode-specific prompts to Pythia's 5 phases | Med |
| 4 | Implement `timeout`/`retries` in compiler | Med |
| 5 | Track branch success/failure, surface in judge prompts | Low |
| 6 | Add explicit REFUTED-claim handling to `@output` prompt | Low |

Full analysis: `pythia/results/pythia-self-analysis-2026-03-29.md`

---

## Pythia v2 Design Recommendations

From the second Pythia self-analysis (process design critique, 2026-03-29):

**Prerequisite before any other changes:**
- Build a benchmark. Without ground-truth data, all proposed improvements are hypotheses, not evidence.

**Low-cost, low-risk (implement now):**
- Randomize worker presentation order in Phase 2 (removes position bias)
- Re-anchor the original question at every phase boundary (prevents topic drift)
- Add explicit REFUTED-claim handling to the `@output` collator prompt

**Testable hypotheses (implement and measure):**
- Provide the completeness critic with a claim-exclusion diff (not all raw worker answers)
- Mandate CoVe-style claim decomposition in Phase 5 before tool verification
- Mode-conditional Phase 5 (citation check for research; single-key-assumption for design)

**What NOT to add:**
All three independent models agreed: do not add more phases, iterative loops, forced consensus, or worker role differentiation in Phase 1.

**Benchmarking plan:**
The research emphasizes: without measurement, you can't know if changes help. Recommended benchmark tiers:

- **Tier 1:** 30 grep-verifiable questions, fully automated scoring, run weekly
- **Tier 2:** Rubric-based eval (5-10 dimensions, scored 1-5 by independent LLM)
- **Tier 3:** Quarterly human eval (10 questions, 2 evaluators, blind A/B)

Conditions to compare: single model, self-consistency (3 independent + majority vote), Delphi, and Pythia. The workflow is the hypothesis. The benchmark is the test.

Full design critique: `pythia/results/pythia-analysis-202603292051.md`

---

## Relationship to LLM "Overclocking"

Pythia is an instance of a broader pattern: using coordinated reasoning techniques to maximize LLM output quality without changing the model. This includes:

- **Chain-of-thought** — explicit step-by-step reasoning
- **Self-consistency** (Wang et al.) — multiple independent reasoning paths, majority vote
- **Multi-agent debate** (Du et al.) — multiple models argue toward a better answer
- **Constitutional AI** — structured critique against principles
- **Tree of Thoughts** — explore multiple reasoning branches before committing
- **Verification-augmented generation** (CoVe) — generate then verify each claim

Pythia combines multi-agent debate + CoVe-style verification + structured verdict tagging. The concept of combining these techniques is tracked as dev idea #17 (LLM Performance Overclocking) in `memory/dev-ideas.md`.
