# Pythia: Multi-Model Verification Workflow

**Version:** V1 (running in production)
**Predecessor:** Delphi (3-phase)
**Origin:** Designed through a Delphi process; research-grounded

---

## What Is Pythia?

Pythia is a 5-phase multi-model verification workflow. It takes a question, runs it through three independent AI models (Claude, Gemini, GPT-4), and produces a verified, fact-checked answer with structured confidence ratings.

The core insight: **a single LLM can be confidently wrong.** Running the same question through multiple models with independent reasoning paths, then subjecting the synthesis to structured adversarial critique and tool-based fact-checking, dramatically reduces the error rate on complex analytical questions.

Pythia was named after the Oracle at Delphi — appropriate given it is the successor to the Delphi workflow.

---

## From Delphi to Pythia

### Delphi (3 phases)

Delphi was the original multi-model verification approach:

1. **Quorum** — Multiple worker bots answer the same question independently; judge synthesizes
2. **Verify** — Workers critique the judge's synthesis
3. **Revise** — Judge produces a final answer incorporating critiques

Delphi works well for straightforward questions. It has 3 mode-specific prompt variants (code, research, design) × 4 prompt builder functions = 12 total variants.

### Why Pythia?

Delphi has structural limitations:

- Only 3 phases — synthesis and critique are not separated from fact-checking
- No explicit VERIFIED/REFUTED/UNVERIFIABLE verdicts
- No dedicated tool-based verification phase
- Workers critique the synthesis but don't independently verify factual claims

Pythia adds two phases and a structured verdict system. It was designed through a Delphi session: we ran Delphi on the question "how should Delphi be improved?" and used the output to design Pythia.

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
| 3 | Critique (correctness, accuracy, completeness, devil's advocate) | `@claude-worker`, `@gemini-worker`, `@gpt-worker` |
| 4 | Revision | `@claude-judge` |
| 5 | Fact-check | `@claude-worker` (with tool access) |
| Final | Collation | `@output` |

### Verdict System

Every factual claim in the final output is tagged:

- **VERIFIED** — Confirmed against source (code, files, docs, or cited papers)
- **REFUTED** — Contradicted by source evidence
- **UNVERIFIABLE** — Cannot be confirmed with available tools (e.g. recent papers, external systems)

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

---

## Pythia Self-Analysis Results

On 2026-03-29, Pythia was run against itself — a self-referential quality analysis. The question: *"What are the structural weaknesses of the Pythia workflow itself?"*

**Verdict scorecard:**

| Status | Count |
|--------|-------|
| VERIFIED | 22 |
| REFUTED | 7 (all minor: off-by-one line numbers, 1 wrong filename) |
| UNVERIFIABLE | 2 |

**Four critical findings (all confirmed against source code):**

1. **Session contamination** — `(new session)` is parsed but ignored. Gemini maintains persistent history keyed by channel ID, so Phase 5 inherits full context from Phases 1 and 3. The isolation mechanism is a no-op.

2. **Dead compiler flags** — `timeout`, `retries`, `timeoutHandler`, and `newSession` are all parsed into the AST but never read by the compiler. `within` and `retry` clauses are currently cosmetic.

3. **Mode regression** — Pythia declares a `mode` input and sets a default (`code`), but `{mode}` appears in zero prompts. All phases use identical generic prompts regardless of mode — a functional regression from Delphi's 12 mode-specific variants.

4. **Unenforced single-tenancy** — No mutex or lock on bot channel dispatch. Two concurrent Pythia runs would race on Gemini's history map and interleave responses.

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
