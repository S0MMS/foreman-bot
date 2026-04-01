# What Kind of System Is Pythia?

> A conceptual document capturing the discussion about how to classify and name Pythia.
> Hand this to any bot to continue this conversation.

---

## The Question

Pythia is a multi-model, multi-phase AI workflow. The question is: what do you *call* a system like this? Is there an established name for it in the field?

---

## What Pythia Actually Does

Pythia is a 5-phase workflow designed to maximize answer quality and defeat specific LLM failure modes:

1. **Independent Exploration** — 3 models (Claude, Gemini, GPT) answer in parallel with identical prompts. No cross-contamination.
2. **Synthesis + Verification** — A judge model synthesizes all three responses and checks for contradictions.
3. **Heterogeneous Critique** — Models critique *each other's* outputs across different roles (factual accuracy, completeness, devil's advocate).
4. **Targeted Revision** — Judge patches the synthesis surgically. No full regeneration.
5. **Independent Fact-Check** — Gemini in a *fresh session* (zero prior context) annotates claims as VERIFIED / UNVERIFIABLE / REFUTED.

**The three failure modes it targets:**
| Failure Mode | Mechanism |
|---|---|
| Incompleteness | Multi-model diversity in Phase 1 |
| Hallucination | Source citations + factored verification in Phases 1, 2, 5 |
| Overconfidence | Adversarial cross-model critique in Phase 3 |

---

## The Naming Problem

The field has several terms that *partially* fit but none that fully capture what Pythia is:

**"LLM Ensemble"** — implies voting or averaging outputs, like traditional ML ensembles. Pythia doesn't vote — it deliberates.

**"Pipeline"** — implies linear flow. Pythia has parallel phases, adversarial critique, and surgical revision. Not just a pipeline.

**"Multi-agent system"** — too broad. Could mean anything, including agents working against each other or on unrelated tasks.

**"Mixture of Agents (MoA)"** — a TogetherAI paper (2024) coined this term. It describes multiple LLMs generating responses that an aggregator model synthesizes. Maps to Pythia's phases 1-2. But MoA typically does this in one pass — it doesn't have heterogeneous critique, targeted revision, or a context-isolated fact-checker. Also: "Mixture of Agents" is too vague — it could literally describe any collection of agents, including ones working against each other.

**"LLM-as-judge / Constitutional AI"** — the critique/revision pattern in phases 3-4 has roots here, but this framing is about alignment, not verification.

**"Orchestration"** — describes coordination, says nothing about *why* or toward what goal.

---

## Where We Landed

The most accurate plain-English description is:

> **"A multi-model verification pipeline"** whose goal is **"LLM cross-examination"**

Or more precisely:

> **"A multi-round Mixture of Agents pipeline with cross-model critique and context-isolated verification"**

The second is technically precise. The first is more evocative and communicates the *intent*.

---

## What Makes Pythia Distinct From Published Approaches

The **fresh-session fact-check** (Phase 5) is the key differentiator. Most published multi-model approaches don't isolate the final verifier from prior context. Pythia does this deliberately — a model that has seen the entire debate is contaminated by it. Gemini starts fresh with zero debate history, which is the only way to defeat overconfidence.

The **targeted revision** (Phase 4) is the second differentiator. Rather than regenerating the full synthesis when critique is received, Pythia patches only the parts that substantive critique targeted. This prevents "problem drift" — the well-documented phenomenon where full regeneration introduces new errors while fixing old ones.

---

## The Open Question

The field is moving fast enough that whoever ships the best version of this pattern probably gets to name it. "Multi-model verification pipeline" is descriptive but not memorable. "LLM cross-examination" is evocative but not precise.

**Possible framings worth exploring:**
- *Deliberative multi-model reasoning* — captures the back-and-forth nature
- *Adversarial consensus* — multiple models try to break each other's answers, goal is a result none could produce alone
- *Cross-examination pipeline* — legal metaphor, implies structured challenge and defense

None of these have been claimed yet. Pythia could be the reference implementation that defines the term.

---

## References
- Pythia workflow: `flows/pythia.flow`
- Pythia reference doc: `docs/pythia/pythia-reference.md`
- Confluence page: `127964217426`
- MoA paper: TogetherAI, 2024 — "Mixture-of-Agents Enhances Large Language Model Capabilities"
