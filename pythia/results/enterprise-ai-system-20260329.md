# Pythia Analysis: Multi-Stack AI Coding System
**Date:** 2026-03-29
**Question:** How should AI agents be organized to automatically implement features across iOS (Swift), Android (Kotlin), backend, and database — from a single Product Owner request?

---

## The Question (Full)

> I am building an AI system where a Product Owner provides a feature description, and the system must automatically: (1) analyze the feature requirements, (2) analyze the existing codebase across 4 stacks (iOS, Android, backend services, database), (3) design the feature architecture across all affected stacks, (4) implement the feature on iOS and Android, and (5) make any required backend or database changes. The 4 stacks are separate codebases with separate repos. Given that this system needs to produce working code across all 4 stacks from a single feature request: what is the best way to configure, separate, and organize the AI agents to do this? Specifically: should there be one agent per stack? Should there be a coordinator agent? How should the agents share context about cross-stack dependencies (e.g. a new API endpoint the mobile apps need)? How should the system handle the ordering problem (database schema must exist before backend endpoints, endpoints must exist before mobile code calls them)? What are the failure modes and how do you prevent them? Consider real-world constraints: iOS is Swift/SwiftUI, Android is Kotlin, backend could be any language, database changes require migrations. The agents have access to the full filesystem, can read/write code, run builds, and run tests.

---

## Architecture Verdict: Coordinator + Stack Specialists

### Topology
- 1 **Coordinator agent** — reads relevant code across all stacks, generates a *shared contract artifact* (written to disk, not passed as messages), validates feasibility
- 4 **Stack specialist agents** — iOS, Android, Backend, DB — each reads only its own stack
- **Human review gate** at the contract stage (before implementation begins)

### Phase Ordering
```
DB schema → Backend endpoints → iOS + Android (parallel)
```
Strict sequential is the safe default. DB and Backend *can* run in parallel against a contract spec for simple cases, with post-migration validation.

### Context Sharing
Shared contract file on disk (new endpoints, schema changes, API shapes). Message passing doesn't scale across stacks.

---

## Confidence Levels

### High Confidence
- Coordinator + specialists is the right starting shape
- Build incrementally: coordinator + 1 agent first, not all 4 at once
- Temporal for orchestration
- Context isolation per agent — each agent reads only its stack
- Shared contract artifact on disk over message passing

### Medium Confidence (downgraded or new)
- Phase ordering can be relaxed for simple migrations (DB ∥ Backend against contract spec, with post-migration validation) — strict sequential is the safe default but not always necessary
- Domain-aware coordinator (reads relevant modules across stacks, not just summaries) likely produces better contracts than a summary-only coordinator
- Testing catches structural drift but not semantic/behavioral issues without human QA
- Idempotent retries are solvable but need explicit workspace-reset design

### Low Confidence (downgraded)
- ~~Coordinator reliably produces correct contracts autonomously~~ → requires human review gate at minimum, plus a feasibility pre-check phase where stack agents validate the contract before implementing
- ~~Atomic merge across repos~~ → merge is achievable; deployment ordering is a separate unsolved problem that should be explicitly out of scope
- Concurrent feature pipelines → significant additional engineering; MVP should be single-feature-at-a-time

### Genuinely Uncertain
- Optimal codebase indexing strategy for the coordinator — nobody solved this concretely
- Whether revision cycles converge or oscillate — a contract that keeps getting rejected could loop indefinitely
- Cost/token budget per feature — could easily be 500K+ tokens across all agents and phases; no one addressed model selection per role (Opus for coordinator, Sonnet for implementation?)

---

## Key Failure Modes

| Failure | Mitigation |
|---|---|
| Contract is wrong → all 4 agents build incompatible code | Human review gate at contract stage |
| Phase ordering violated → mobile code calls endpoints that don't exist yet | Enforce DB → Backend → Mobile ordering in orchestrator |
| Revision cycles don't converge | Explicit retry limits (2-3 max), then escalate to human |
| Concurrent features | MVP: single-feature-at-a-time; concurrent is significant added complexity |

---

## Model Selection Recommendation
- **Coordinator:** Opus (contract generation is the hardest, highest-stakes step)
- **Stack specialists:** Sonnet (implementation is more mechanical, lower stakes per decision)

---

## Infrastructure Notes (Verified Against Codebase)

| Claim | Status |
|---|---|
| Temporal installed via Homebrew | ✅ `/opt/homebrew/bin/temporal` |
| Worker auto-starts in `index.ts` | ✅ `src/index.ts:49` |
| `delete process.env.CLAUDECODE` env guard | ✅ `src/index.ts:26` |
| `delphiWorkflow` exists in Temporal | ✅ `src/temporal/workflows.ts:154` |
| `helloWorkflow` is the only workflow (memory claim) | ❌ STALE — `delphiWorkflow` and `flowspecTestWorkflow` also exist |

---

## Verification Summary

| Status | Count |
|---|---|
| VERIFIED | 12 |
| UNVERIFIABLE | 4 |
| REFUTED | 0 |

All architectural recommendations are confirmed as sound design patterns. The infrastructure claims (Temporal installed, worker auto-starts, env guard) are all confirmed against actual code and system state.

---

## Bottom Line

The skeleton is sound. The two hardest problems — **coordinator contract quality** and **cross-stack semantic correctness** — got the least concrete design in the analysis. Invest there first before wiring up agents. Any real implementation should have a human-in-the-loop at the contract stage, at minimum.
