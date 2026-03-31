# Pythia Workflow — Overview & Design Rationale

**Created:** 2026-03-28
**Location:** `/Users/chris.shreve/claude-slack-bridge/flows/pythia.flow`
**Canvas:** Canvas 2 (in the working Slack channel)

---

## What is Pythia?

Pythia is a 5-phase, multi-model LLM workflow designed to maximize the correctness, insight, and accuracy of LLM-produced answers while minimizing hallucinations and errors. It is written in FlowSpec and executed via the Foreman Slack bridge.

The name comes from the priestess who delivered prophecies at the Oracle of Delphi — a direct evolution from the earlier "Delphi" multi-agent process.

---

## Invocation

```
/cc run canvas "Pythia" question="How does diary sync work?"
/cc run canvas "Pythia" question="What are the tradeoffs of X vs Y?" mode="research"
/cc run pythia.flow "Pythia" question="..." mode="code"
```

The `mode` input defaults to `"code"`. Other options: `"research"`, `"design"`.

---

## Architecture: 5 Phases

### Phase 1 — Independent Exploration (Diversity)
Three workers from **different models** answer the question in parallel with **identical prompts**. Each must cite sources (`file:line`, `[FROM KNOWLEDGE]`, or `[UNCERTAIN: reason]`) and tag sections with HIGH/MEDIUM/LOW confidence.

- `@claude-worker` (Claude) -> answer1
- `@gemini-worker` (Gemini) -> answer2
- `@gpt-worker` (GPT) -> answer3

**Why identical prompts?** The Delphi performance research found that giving workers differentiated roles (e.g., "skeptic", "edge-explorer") in Phase 1 narrows their search space. Three unconstrained explorations maximize the probability that at least one worker finds each important fact. Heterogeneity is applied in Phase 3 instead.

### Phase 2 — Synthesis + Verification (Structured Verification)
A dedicated **judge** (`@claude-judge`) receives all three worker answers with full reasoning chains (not summaries — Du et al. found reasoning chains outperform summaries). The judge must:

1. List areas where all workers **agree**
2. List areas where workers **disagree** (with each position)
3. List claims made by **only one** worker
4. Verify each claim using tools, labeling them CONFIRMED, REFUTED, or UNVERIFIED
5. Write synthesis using only CONFIRMED claims
6. Flag UNVERIFIED claims explicitly as uncertain

**Why self-structure instead of an external summary step?** The research found that an intermediary summary step introduces a new hallucination surface and loses reasoning chains. Having the judge self-produce the structured comparison as its first act gets the same analytical benefit without information loss.

### Phase 3 — Heterogeneous Critique (Adversarial Pressure)
Three critics review the judge's synthesis in parallel, each with a **different role** and from a **different model** than the one that produced the synthesis:

| Bot | Model | Role |
|---|---|---|
| `@claude-worker` | Claude | **Factual Accuracy** — verify specific claims against code/sources |
| `@gemini-worker` | Gemini | **Completeness** — what did the judge miss entirely? |
| `@gpt-worker` | GPT | **Devil's Advocate** — find the strongest argument the conclusions are wrong |

**Why heterogeneity here?** This is where differentiated roles pay off. Each critic targets a different failure mode (hallucination, incompleteness, overconfidence). Cross-model critique means each model is less likely to be sycophantic toward output produced by a different model's reasoning.

**Why no mandatory critique quotas?** The research found that "MUST find 3 problems" incentivizes fabricated criticism. The devil's advocate uses softer framing: explain why it's wrong, or if it's strong, explain what would have to be true for it to fail.

### Phase 4 — Targeted Revision (Not Full Regeneration)
`@claude-judge` patches the synthesis based on the three critiques. The prompt says: "Address ONLY the substantive issues raised. Do not rewrite sections that weren't challenged." This prevents problem drift (Becker et al. 2025).

**Why not another full debate round?** The literature shows diminishing returns beyond 2-3 rounds, with increasing risk of problem drift.

### Phase 5 — Independent Fact-Check (Chain of Verification)
`@gemini-verifier` — a **dedicated bot on its own channel**, separate from `@gemini-worker` — verifies every factual claim in the revised answer. Output is **append-only** — the fact-checker annotates but does not revise the answer.

For each claim:
- `VERIFIED: [claim] — [evidence]`
- `UNVERIFIABLE: [claim] — [what you looked for]`
- `REFUTED: [claim] — [what's actually true]`

**Why a separate bot?** Context isolation comes from identity, not session resets. `@gemini-verifier` has its own channel with no shared history from Phases 1 or 3 — the fact-checker genuinely has zero debate context. The earlier `(new session)` approach was deprecated because it leaked infrastructure concerns into the DSL (see flowspec.md §6c).

**Why append-only?** Prevents one more round of potential corruption. The fact-checker's job is to flag, not to fix.

---

## Bots Required

| Bot Name | Model | Channel | Phases |
|---|---|---|---|
| `@claude-worker` | Claude | `#claude-worker` | 1 (explore), 3 (accuracy critic) |
| `@claude-judge` | Claude | `#claude-judge` | 2 (synthesize), 4 (revise) |
| `@gemini-worker` | Gemini | `#gemini-worker` | 1 (explore), 3 (completeness critic) |
| `@gemini-verifier` | Gemini | `#gemini-verifier` | 5 (independent fact-checker) |
| `@gpt-worker` | GPT | `#gpt-worker` | 1 (explore), 3 (devil's advocate) |

Output is sent to `#output` (currently `#pythia-results`).

Bots are registered in `~/.foreman/bots.json`.

---

## The Three Mechanisms

Pythia addresses three independent failure modes, each with a dedicated mechanism:

| Failure Mode | Mechanism | Where in Pythia |
|---|---|---|
| **Incompleteness** — missing important facts | Diversity of exploration (multi-model, identical prompts) | Phase 1 |
| **Hallucination** — fabricated or incorrect claims | Structured verification (source citations, claim labeling, factored fact-check) | Phases 1, 2, 5 |
| **Overconfidence** — presenting uncertain claims as certain | Adversarial pressure (cross-model critique, devil's advocate) | Phase 3 |

---

## Multi-Model Advantage

The original Delphi process used all-Claude workers. The research identified monoculture as the **#1 structural risk** — all workers share training data, reasoning patterns, and blind spots. Persona variation was dismissed as "weak sauce" that changes tone but not epistemics.

Pythia solves this by using Claude, Gemini, and GPT as genuinely different models with:
- Different training data
- Different reasoning patterns
- Different blind spots
- Reduced sycophancy when critiquing another model's output

Zhang et al. (2025) found model heterogeneity delivers up to a **47% boost** and is "the key unlock for multi-agent gains over self-consistency."

---

## Research Foundation

Pythia's design is grounded in findings from the Delphi Performance v1 assessment (`/Users/chris.shreve/claude-slack-bridge/delphi/results/delphi-performance-v1-2026-03-27.md`) and the following literature:

| Paper | Key Finding | How Pythia Uses It |
|---|---|---|
| Du et al. (2023, ICML 2024) | 3 agents, 2 rounds optimal; reasoning chains > summaries | Phase 1 (3 workers), Phase 2 (full chains to judge) |
| Khan et al. (2024, ICML Best Paper) | Adversarial debate +28 points; truth has inherent persuasive advantage | Phase 3 (devil's advocate role) |
| Dhuliawala et al. (2023) | Chain-of-Verification: 50-77% hallucination reduction | Phase 5 (factored verification, fresh session) |
| Chan et al. (2023, ChatEval) | Identical roles degrade multi-agent performance | Phase 3 (differentiated critic roles) |
| Zhang et al. (2025) | Model heterogeneity is the key unlock; persona variation is weak | Multi-model workers throughout |
| Wang et al. (2022) | Self-consistency: +17.9 points via majority voting | Baseline that Pythia must beat |
| Liang et al. (2023) | Degeneration of Thought — self-reflection traps LLMs | Phase 1 (independent workers, no iterative self-correction) |
| Becker et al. (2025) | Problem drift in extended debate rounds | Phase 4 (targeted revision only) |

---

## What Pythia Deliberately Avoids

These are anti-patterns identified by the research:

1. **No extra debate rounds** — diminishing returns, problem drift risk
2. **No structured summary intermediary** — loses reasoning chains, adds hallucination surface
3. **No forced atomic claim decomposition** — destroys causal reasoning in research/design modes
4. **No mandatory critique quotas** — incentivizes fabricated criticism
5. **No worker role differentiation in Phase 1** — constrains search space
6. **No forced consensus** — "workers disagreed on X" is a valid final answer

---

## Open Item: Benchmarking

The research emphasizes that without measurement, you can't know if changes help. The recommended benchmark:

- **Tier 1:** 30 grep-verifiable questions, fully automated scoring, run weekly
- **Tier 2:** Rubric-based eval (5-10 dimensions, scored 1-5 by independent LLM)
- **Tier 3:** Quarterly human eval (10 questions, 2 evaluators, blind A/B)

Conditions to compare: single model, self-consistency (3 independent + majority vote), Delphi-current, and Pythia.

The workflow is the hypothesis. The benchmark is the test.
