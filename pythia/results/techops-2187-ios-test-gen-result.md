# TECHOPS-2187: AI-Generated Unit Tests for Legacy iOS — Pythia Briefing

## Bottom Line

The analysis produced a solid, phased plan for AI-generating unit tests across ~473 untested ObjC files (~154K lines). The key insight: **start with a single-class proof-of-concept (Phase 0) before scaling anything.** The single biggest blocker is programmatically adding test files to the `.xcodeproj` target — if bots can't do that, the whole approach needs human scaffolding.

---

## Verified Facts (22/32 claims confirmed)

- **1,270** `*Tests.swift` files + 95 singular `*Test.swift` files already exist
- **21** legacy ObjC test files, **2 confirmed naming conflicts** (ObjC ↔ Swift)
- Test bridging header exists: **241 lines, 220 imports** — most ObjC classes are already exposed
- `@testable import mfpDebug` is correct for the main test target (84% of all `@testable` imports)
- `BaseTestCase` and `BaseTestCaseWithSetCurrentUser` behavior verified exactly as described
- **31 mock files** across 4 subdirectories — reusable infrastructure is real
- `ServiceLocator.mock()/.unmock()` pattern used in **214 test files**
- Build command structure verified (workspace, scheme, test plan all exist)
- `.xcodeproj`-based target confirmed (26 references in `project.pbxproj`)

---

## Refuted Claims (4 — all minor)

| Claim | Actual | Impact |
|---|---|---|
| 1,269 `*Tests.swift` files | **1,270** | Negligible (off by 1) |
| 451 `.m` files | **473** (line count ~154K is close enough) | Slightly larger scope than estimated |
| Bridging header: 242 lines, "190+" imports | **241 lines, 220 imports** | Undersold — coverage is better than claimed |
| 2nd naming conflict: `MFPFoodTest.m` ↔ `FoodTests.swift` | Actually **`FoodTests.m` ↔ `FoodTests.swift`** | Wrong file named, but the conflict is real |

Nothing directionally wrong. The analysis is substantively accurate.

---

## Unverifiable Claims (6)

These require runtime data or external system access — treat as hypotheses, not facts:

- ~7 min/class compilation time (need actual xcodebuild runs)
- 6+ hour total estimate for 50 classes
- `-derivedDataPath` enabling concurrent builds
- CI timeout risk from adding 200+ tests
- Cost/token budget across 3 LLM vendors
- Mutation testing feasibility for this toolchain

---

## Key Recommendations from the Analysis

1. **Phase 0 is mandatory** — prove one class end-to-end before scaling. This validates: bridging header exposure, `@testable import`, `.xcodeproj` target membership, xcodebuild, and coverage reporting.

2. **Kill criteria exist** — if Phase 1 shows <20 untested classes in active code paths, close the ticket. Don't generate tests for dead code.

3. **Simplified prioritization** — drop the weighted formula. Filter to Tier A/B, sort by git commits (90 days), tiebreak by blast radius, override for AI agent work areas.

4. **Batch size: 5 classes**, with a calibration checkpoint after batch 1.

5. **ObjC escape hatch** — classes with C idioms that don't bridge to Swift get ObjC test files instead.

6. **Flaky gate** — run each batch 3x before merge. Any failure = flaky = no merge.

---

## Top 3 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `.xcodeproj` target membership — bots must add files programmatically | **Blocker** | Phase 0 will surface the right approach |
| Tests mirror implementation rather than testing behavior | **High** | Judge rubric + sampled mutation testing (unverified) |
| Long-term ownership — teams won't maintain tests they didn't write | **High** | Organizational, not technical. Enforce via CODEOWNERS + required reviewers |

---

Ready for questions — I have the full analysis, verification data, corrected prompts, and FlowSpec workflow context.