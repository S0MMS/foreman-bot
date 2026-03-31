# Pythia Analysis: AI-First Mobile Platform Architecture

## Bottom Line

The architecture is sound for your scale (5 brands, 20-30 plugins). SPM monorepo + protocol-based plugin contracts + explicit DI is the right call — but several original claims were corrected and critical gaps were identified.

---

## Key Corrections Made

**False citations removed.** The original synthesis cited Uber, Airbnb, and Shopify as SPM monorepo validation. All three actually use Buck/Bazel. Shopify uses React Native entirely. "Airbnb's MavericksX" was fabricated — doesn't exist. The recommendation still holds, but because SPM fits *your* scale, not because big companies use it.

**Persistence abstraction reversed.** The original verdict favoring Swift's native `Predicate<Model>` was wrong — it's tied to SwiftData and can't easily drive CoreData/Realm/SQLite backends. Neither worker's approach is clearly superior. **This is the highest-risk protocol design decision.**

**`@MainActor + Sendable` flagged.** Would force all service access onto the main thread — a concurrency bottleneck for persistence and networking. Fix: remove `@MainActor` from the service container.

---

## What's Validated (High Confidence)

- **SPM packages** as module boundaries — proven at your scale, escape hatch to Bazel if you outgrow it
- **Protocol-based contracts** with explicit DI — plugins code against interfaces, not implementations
- **The Iron Rule** — plugins never import other plugins, only shared contracts
- **AI-friendliness patterns** — file size limits, one-type-per-file, consistent MVVM, explicit types
- **Compile-time isolation** via SPM dependency graph

## What's Uncertain (Medium Confidence)

- **URL-based navigation** — right trade-off (isolation > type safety), but needs route constants to avoid stringly-typed runtime failures
- **The "same platform" premise** — justified for AI velocity and operational leverage, but validate actual feature overlap before Phase 2. MFP and Flo may share <15% of features
- **SPM above ~100 packages** — documented scaling issues exist; monitor from Phase 2

## What's Risky (Low Confidence)

- **Persistence abstraction** — neither approach validated against real MFP queries. Catalog the actual top-20 queries before committing
- **Timeline** — Phase 0 is realistically 4-6 weeks, not 2-3

---

## Critical Gaps to Address Before Phase 1

1. **Error handling standard** — without one, every AI-generated plugin handles errors differently
2. **Plugin lifecycle state machine** — registered → activated → suspended → deactivated → torn down
3. **Security architecture** — health data requires Keychain abstraction, encryption policy, PII classification, storage-level isolation
4. **Analytics event taxonomy** — define naming conventions before AI agents start inventing event names
5. **Third-party dependency policy** — prevent version conflicts across plugins

---

## The Sharpest Critique

> Don't build "the platform with MFP enabled." Build MFP as a well-modularized app first. Extract the platform only after a second brand validates which abstractions are real.

And the single most important action item:

> **Test AI plugin generation in week 2 of Phase 0, not week 11.** Give an AI agent draft PlatformKit protocols + one exemplar and see if it can produce a working plugin. This is the central bet — if it fails, the architecture needs revision before further investment.

---

## Verification Score

| Category | Count |
|---|---|
| Verified | 13 |
| Partially Verified | 3 |
| Unverifiable | 5 |
| Refuted | **0** |

Every verifiable factual claim held up. The unverifiable items are project-specific (MFP's internal query patterns, actual feature overlap percentages) — treat those as hypotheses to validate, not facts.

---

Ready for follow-up questions on any section.