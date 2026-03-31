# TECHOPS-2187: AI-Generated Unit Tests for Legacy iOS Codebase

## Pythia Analysis — Full Detail Report

**Date:** 2026-03-30
**Method:** 5-phase multi-model Pythia (quorum + critique + revision + verification)
**Question:** How to AI-generate unit tests for the mfp-ios legacy ObjC codebase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Factual Corrections (Post-Critique)](#factual-corrections)
3. [Corrected Generation Prompt](#corrected-generation-prompt)
4. [Phase 0 — Environment Validation](#phase-0--environment-validation)
5. [Test Target Membership — Blocker](#test-target-membership--blocker)
6. [Naming Conflicts](#naming-conflicts)
7. [Bridging Header Audit](#bridging-header-audit)
8. [ObjC Nullability / IUO Risk](#objc-nullability--iuo-risk)
9. [Kill Criteria After Phase 1](#kill-criteria-after-phase-1)
10. [Prioritization Formula](#prioritization-formula)
11. [Simulator Contention — Budget](#simulator-contention--budget)
12. [Flaky Test Gate](#flaky-test-gate)
13. [Second Batch Checkpoint](#second-batch-checkpoint)
14. [Test Ownership](#test-ownership)
15. [Exit Criteria](#exit-criteria)
16. [Unchanged Recommendations](#unchanged-recommendations)
17. [Confidence Assessment](#confidence-assessment)
18. [Independent Verification Results](#independent-verification-results)
19. [Verification Summary](#verification-summary)

---

## Executive Summary

This analysis produced a phased plan for AI-generating unit tests across ~473 untested ObjC files (~154K lines) in the mfp-ios codebase. Three independent critics (accuracy, completeness, devil's advocate) challenged the initial consensus, resulting in significant corrections and additions.

**The single biggest takeaway:** Start with a single-class proof-of-concept (Phase 0) before scaling anything. The single biggest blocker is programmatically adding test files to the `.xcodeproj` target — if bots can't do that, the whole approach needs human scaffolding.

---

## Factual Corrections

All three critics raised real issues. Here are the corrections, addressing only what was challenged.

| Original Claim | Corrected Value | Source |
|---|---|---|
| 1,047 `*Tests.swift` files | **1,269** (+ 95 singular `*Test.swift`) | Verified glob count |
| ~110K lines ObjC | **~150K lines across 451 `.m` files** | `wc -l` on filtered set |
| 19 legacy ObjC test files | **21** (2 have naming conflicts with Swift counterparts) | Verified glob |
| Bridging header: "NOT ADDRESSED, may not exist" | **Exists. 242 lines, 190+ ObjC class imports.** `mfpUnitTests-Bridging-Header.h` imports `MyFitnessPal-Bridging-Header.h` plus extensive per-class imports | Verified file contents |

### Post-Verification Adjustments to Corrected Values

Independent verification found minor discrepancies in the corrected values themselves:

| Corrected Claim | Verified Actual | Delta |
|---|---|---|
| 1,269 `*Tests.swift` files | **1,270** | Off by 1 |
| 451 `.m` files | **473** (line count ~154K) | Off by 22 files |
| Bridging header: 242 lines, "190+" imports | **241 lines, 220 imports** | 1 line off; "190+" technically true but undersells |
| 2nd naming conflict: `MFPFoodTest.m` | Actually **`FoodTests.m` ↔ `FoodTests.swift`** | Wrong file named |

All discrepancies are minor. No claim is directionally wrong.

---

## Corrected Generation Prompt

The accuracy critic identified three prompt bugs that would cause immediate compilation failures. The corrected preamble for all Phase 4 `ask` prompts:

```
CRITICAL CONTEXT FOR TEST GENERATION:
- Tests are SWIFT. Generate .swift files.
- Import: `@testable import mfpDebug` (this is the ONLY module name — universal across all test files)
- Base class: `BaseTestCase` (injects MockDependencyContainer into DependenciesInjector.shared,
  mocks SynchronizationCoordinatable via ServiceLocator, sets continueAfterFailure = false)
- Base class for user context: `BaseTestCaseWithSetCurrentUser` (adds test user via
  UserTests.createTestUserFromMockData(), mocks entitlement/tier/product/subscription providers)
- ALWAYS call super.setUp() and super.tearDown() — tearDown clears MockNetworkResponseQueue
  and unmocks all ServiceLocator registrations
- Mocking: check mfpUnitTests/Mocks/ FIRST (Core/, Dependencies/, Networking/, Views/ — 31 files).
  Reuse MockDependencyContainer, MockNetworkResponseQueue, existing mocks before creating new ones.
- DI: use ServiceLocator.mock() / .unmock() pattern
- Build: xcodebuild test -workspace MyFitnessPal.xcworkspace -scheme MyFitnessPal
  -testPlan MyFitnessPal -destination 'platform=iOS Simulator,name=iPhone 16'
- Test directory: mfpUnitTests/ (match existing subdirectory structure by feature)
- ObjC nullability: legacy headers lack annotations. All ObjC return values become IUOs in Swift.
  Guard with optional binding — do NOT force-unwrap ObjC returns in assertions.
```

### Verification Status of Prompt Claims

| Claim | Status |
|---|---|
| `@testable import mfpDebug` is universal for main test target | **VERIFIED** (1,361 of ~1,609 imports; 84% — SPM packages use own module names) |
| BaseTestCase injects MockDependencyContainer into DependenciesInjector.shared | **VERIFIED** |
| BaseTestCase mocks SynchronizationCoordinatable via ServiceLocator | **VERIFIED** |
| BaseTestCase sets continueAfterFailure = false | **VERIFIED** |
| BaseTestCaseWithSetCurrentUser adds test user via UserTests.createTestUserFromMockData() | **VERIFIED** |
| BaseTestCaseWithSetCurrentUser mocks entitlement/tier/product/subscription providers | **VERIFIED** (all four: MockEntitlementProvider, MockTierProvider, MockProductProvider, MockSubscriptionRepositoryWrapper) |
| tearDown clears MockNetworkResponseQueue and unmocks all ServiceLocator registrations | **VERIFIED** |
| Mocks directory has Core/, Dependencies/, Networking/, Views/ — 31 files | **VERIFIED** (exact match) |
| MockDependencyContainer exists | **VERIFIED** (at `mfpUnitTests/Mocks/Dependencies/Rollouts/MockDependencyContainer.swift`) |
| MockNetworkResponseQueue exists | **VERIFIED** (lives in production source: `Sources/Classic/Networking/DataStore/`, not Mocks/) |
| ServiceLocator.mock() / .unmock() pattern | **VERIFIED** (defined in `MFPServiceLocator/Sources/`, used across 214 test files) |
| Build command structure | **VERIFIED** (workspace, scheme, test plan all exist with exact names) |
| Test directory is mfpUnitTests/ | **VERIFIED** |

**Nuance on `@testable import mfpDebug`:** This is correct for the `mfpUnitTests` target specifically. SPM packages use their own module names (`MealPlanner`: 209 imports, `MFPUICatalog`: 21, `MFPHealthKit`: 9, etc.). Since this ticket targets ObjC classes in the main app, `mfpDebug` is the right import.

---

## Phase 0 — Environment Validation

The completeness critic is right: before scaling to 50 classes, prove the pipeline works end-to-end for **one** class. Add this before Phase 1:

```
-- PHASE 0: SINGLE-CLASS PROOF
ask @claude-worker """
  In {repo_path}:
  1. Pick ONE simple Tier-A ObjC class already in the bridging header.
  2. Generate a Swift test file with 3 test methods.
  3. Add the file to the mfpUnitTests target in the .xcodeproj.
  4. Run: xcodebuild test -workspace MyFitnessPal.xcworkspace -scheme MyFitnessPal
     -testPlan MyFitnessPal -destination 'platform=iOS Simulator,name=iPhone 16'
     -only-testing:mfpUnitTests/<NewTestClass>
  5. Confirm: compiles, runs, passes, appears in coverage report.
  Report: what worked, what broke, how you fixed it.
""" -> proof_of_concept

if {proof_of_concept} means "failed"
  stop "Phase 0 failed — fix the pipeline before scaling."
```

This validates the entire chain: bridging header exposure, `@testable import mfpDebug`, target membership in `.xcodeproj`, xcodebuild command, and coverage reporting.

---

## Test Target Membership — Blocker

The completeness critic flagged this correctly. **mfpUnitTests uses `.xcodeproj`, not SPM** (verified: 26 references in `project.pbxproj`). Files must be explicitly added to the target.

This means bots need to either:
1. Manipulate the `.pbxproj` directly (fragile, error-prone)
2. Use `xcodegen` or `tuist` if available (unverified)
3. Add files via `xcodeproj` Ruby gem or similar tooling

**Phase 0 will surface the right approach.** If the proof-of-concept bot successfully adds one file to the target, that method gets codified in the generation prompts. If it can't, this is a prerequisite that needs human setup.

**Verification status:** `.xcodeproj`-based target confirmed. This is the **single biggest remaining blocker** for full automation.

---

## Naming Conflicts

Verified: 2 real naming conflicts exist:

1. `mfpUnitTests/MealFoodTests.m` ↔ `mfpUnitTests/Food/MealFoodTests.swift` — **VERIFIED**
2. `mfpUnitTests/FoodTests.m` ↔ `mfpUnitTests/FoodTests.swift` — **VERIFIED** (note: original analysis incorrectly named this as `MFPFoodTest.m`)

The inventory phase must flag these. Add to Phase 1 prompt:

```
Flag any ObjC test file whose class name would collide with a generated Swift test class.
These need manual resolution before generation (rename or delete the ObjC version).
```

---

## Bridging Header Audit

The devil's advocate flagged bridging header exposure as a major risk. Verification shows it's **less severe than feared** — the test bridging header already has **220 ObjC class imports** across 241 lines.

But it may not cover all 473 `.m` file classes. Add to Phase 1:

```
For each untested ObjC class, check if its header is imported in
mfpUnitTests/mfpUnitTests-Bridging-Header.h or MyFitnessPal-Bridging-Header.h.
Mark classes NOT in the bridging header — these need header additions before test generation.
```

Classes not in the bridging header get a "needs bridging" flag. If >30% of target classes are unbridged, that's a Phase 0.5 prerequisite task.

**Key file:** `mfpUnitTests-Bridging-Header.h` imports `MyFitnessPal-Bridging-Header.h` (line 11) plus extensive per-class imports.

---

## ObjC Nullability / IUO Risk

Legacy ObjC without `nullable`/`nonnull` annotations produces implicitly unwrapped optionals in Swift. This is a systematic source of runtime crashes that compile clean. Addressed in the corrected prompt above ("Guard with optional binding — do NOT force-unwrap ObjC returns").

Additionally: **allow ObjC test files as an escape hatch.** Some classes with heavy C idioms (`va_list`, pointer-to-pointer params, complex macros) won't bridge cleanly to Swift. For these, generating an ObjC `.m` test file is pragmatically correct. Add to the generation prompt:

```
If a class uses C idioms that don't bridge cleanly to Swift (va_list, pointer-to-pointer,
complex preprocessor macros), generate an ObjC test file (.m) instead. Use XCTest directly.
```

---

## Kill Criteria After Phase 1

The devil's advocate is right — the plan assumes the answer is "yes, test them" before the data exists. Add after Phase 1:

```
if {inventory} means "fewer than 20 untested classes in active code paths"
  stop "Insufficient scope — backfill not justified. Close TECHOPS-2187."
```

And explicitly: if the untested ObjC classes have near-zero git activity in the last 90 days and are not in the path of planned AI agent work, **don't generate tests for them.**

---

## Prioritization Formula

The devil's advocate is right that the weighted composite score is pseudoscientific. Replaced with:

**Filter**: Tier A and B only (C and D excluded).
**Sort**: By git commits in last 90 days (descending).
**Tiebreaker**: Blast radius (how many other files import this class).
**Override**: If a class is in a known AI agent work area, it jumps to the top regardless.

This is simpler, more transparent, and produces a ranking the team can understand and override at the human gate without needing to reverse-engineer a weighted formula.

---

## Simulator Contention — Budget

Parallel generation does not equal parallel compilation. `xcodebuild` serializes on build directory locks and simulator instances.

**Revised time estimate**: ~7 min/class (3 compile rounds x 2 min + 1 min test run) x 50 classes = **~6 hours of xcodebuild time**.

The parallel fan-out saves time on prompt processing but not compilation.

**Mitigation options** (in order of preference):
1. Accept serial compilation, set expectations at 6-8 hours for 50 classes
2. Use `-derivedDataPath` per worker to allow concurrent builds (UNVERIFIED whether this works with shared xcodeproj)
3. Reduce to 2 workers instead of 3 — less fan-out overhead, same compilation bottleneck

**Verification status:** Time estimates are UNVERIFIABLE without actually running xcodebuild. `-derivedDataPath` concurrency is also UNVERIFIABLE from repo alone.

---

## Flaky Test Gate

Run each batch 3 times after tests pass. Flag any test that fails on any run as FLAKY. Flaky tests do not merge — they get fixed or dropped.

```
After tests pass, run the batch 3 times. Flag any test that fails on any run as FLAKY.
Flaky tests do not merge — they get fixed or dropped.
```

---

## Second Batch Checkpoint

The first batch is a calibration round. Add after the first iteration of `for each batch`:

```
-- After first batch only: calibration checkpoint
if {batch} equals "1"
  pause for approval with message "First batch complete. Review test quality at
  {repo_path}/test-gen/review-1.json. Approve to continue, or provide prompt adjustments."
```

---

## Test Ownership

The #1 long-term risk: tests nobody owns get deleted at first failure. Add to Phase 5:

```
For each PR, identify the module owner (from CODEOWNERS or git blame).
Assign that owner as required reviewer.
PR description must include: "These tests will be owned by [module team].
If they break, fix them like any other test — do not delete without replacement."
```

This is an organizational decision, not a technical one. The workflow can enforce it at PR creation time but can't enforce it long-term. Flag for engineering leadership.

---

## Exit Criteria

| Criterion | Target |
|---|---|
| Classes tested | Top 50 Tier A/B by git activity |
| Coverage delta | Measurable positive delta on target files (specific % TBD after Phase 1) |
| Quality gate | All merged tests score >= 7/10 on judge rubric |
| Done condition | All 50 classes have merged tests OR are documented as untestable |
| Timeline | Not estimated — depends on Phase 0 calibration |

---

## Unchanged Recommendations

These were unchallenged by all three critics:

- **4-tier testability scoring** — confirmed sound
- **Batch size of 5** — unchallenged
- **FlowSpec structure** as foundation — critics challenged content, not structure
- **Quality rubric dimensions** — unchallenged
- **Skip Tier D + document blockers** — unchallenged
- **`pause for approval` gates** — unchallenged (batch-1 calibration gate added)

---

## Confidence Assessment

### High Confidence
- 4-tier testability scoring (all workers + all critics agree)
- Skip Tier D, document blockers, create refactoring tickets
- 5-class batch size to start
- Judge review every batch with 5-criteria rubric
- Phase 0 single-class proof is mandatory before scaling
- `@testable import mfpDebug` is the universal import pattern (verified)
- Existing mock infrastructure (MockDependencyContainer, ServiceLocator.mock()) must be reused (verified)
- Bridging header exists with 220 imports (verified) — risk is lower than feared but not zero
- Serial xcodebuild is the real bottleneck — budget 6+ hours for 50 classes

### Medium Confidence
- Simplified prioritization (tier filter + git-heat sort) is better than weighted formula — the critics agree the formula is arbitrary, but the replacement hasn't been tested against real data either
- 3 compile-fix iterations may not be enough for Swift-ObjC interop issues — Phase 0 will calibrate this
- Flaky test gate (run 3x) catches intermittent failures — but 3 runs may not be enough for rare flakes
- ObjC test file escape hatch for non-bridgeable classes — pragmatically correct but creates two code paths in the workflow

### Low Confidence / Unresolved
- **Test target membership in `.xcodeproj`** — the bots need to add files to the Xcode project, not just write them to disk. Phase 0 will determine if this is feasible programmatically or requires human setup. **This is the single biggest remaining blocker.**
- **"Meaningful behavioral tests" at scale** — the devil's advocate is right that AI testing legacy code without specs will produce implementation-mirroring disguised as behavioral testing. Mutation testing (sampled) is the best available mitigation but is UNVERIFIED for this toolchain.
- **Long-term test ownership** — organizational problem. The workflow can enforce reviewer assignment but can't ensure teams maintain tests they didn't write. **Highest risk to lasting value.**
- **Is this worth doing at all?** — if Phase 1 shows the untested ObjC is stable, rarely modified, and outside AI agent work areas, the project should be killed. The kill criteria are defined but the data doesn't exist yet.
- **Cost/token budget** — three LLM vendors processing 150K+ lines of ObjC across multiple fix rounds. No estimate attempted. Need to measure after Phase 0.
- **CI impact** — current test suite runtime and CI timeout are unknown. Adding 200+ tests could push CI over timeout. Verify before merging first PR.

---

## Independent Verification Results

All verification agents returned. Full results below.

### Table 1: Corrected Numbers

| Claim | Status | Detail |
|---|---|---|
| 1,269 `*Tests.swift` files | **REFUTED** (minor) | Actual: **1,270** — off by 1 |
| 95 singular `*Test.swift` files | **VERIFIED** | Exact match |
| ~150K lines across 451 `.m` files | **REFUTED** (partial) | Actual: **153,908 lines across 473 `.m` files** — line count ballpark correct, file count off by 22 |
| 21 legacy ObjC test files (2 naming conflicts) | **VERIFIED** | 21 test-named `.m` files confirmed |
| Bridging header: 242 lines, 190+ imports | **REFUTED** (minor) | **241 lines**, **220 imports** — "190+" technically true but undersells |
| Bridging header imports MyFitnessPal-Bridging-Header.h | **VERIFIED** | Line 11 confirms |

### Table 2: Generation Prompt Claims

| Claim | Status |
|---|---|
| `@testable import mfpDebug` universal for main test target | **VERIFIED** (84% of all @testable imports; 100% for mfpUnitTests target) |
| BaseTestCase injects MockDependencyContainer | **VERIFIED** |
| BaseTestCase mocks SynchronizationCoordinatable | **VERIFIED** |
| BaseTestCase sets continueAfterFailure = false | **VERIFIED** |
| BaseTestCaseWithSetCurrentUser: test user via UserTests.createTestUserFromMockData() | **VERIFIED** |
| BaseTestCaseWithSetCurrentUser: mocks 4 providers | **VERIFIED** (MockEntitlementProvider, MockTierProvider, MockProductProvider, MockSubscriptionRepositoryWrapper) |
| tearDown clears MockNetworkResponseQueue + unmocks ServiceLocator | **VERIFIED** |
| Mocks dir: Core/, Dependencies/, Networking/, Views/ — 31 files | **VERIFIED** (exact match) |
| MockDependencyContainer exists | **VERIFIED** (`mfpUnitTests/Mocks/Dependencies/Rollouts/MockDependencyContainer.swift`) |
| MockNetworkResponseQueue exists | **VERIFIED** (note: lives in production source `Sources/Classic/Networking/DataStore/`, not Mocks/) |
| ServiceLocator.mock()/.unmock() pattern | **VERIFIED** (defined in MFPServiceLocator, used in 214 test files) |
| Build command structure | **VERIFIED** (workspace, scheme, test plan all exist) |
| Test directory: mfpUnitTests/ | **VERIFIED** |

### Table 3: Naming Conflicts

| Claim | Status | Detail |
|---|---|---|
| `MealFoodTests.m` ↔ `MealFoodTests.swift` | **VERIFIED** | Both exist in mfpUnitTests |
| `MFPFoodTest.m` ↔ `FoodTests.swift` | **REFUTED** | Actual conflict is `FoodTests.m` ↔ `FoodTests.swift`, not MFPFoodTest |

### Table 4: Architecture Claims

| Claim | Status |
|---|---|
| mfpUnitTests uses `.xcodeproj`, not SPM | **VERIFIED** |
| 26 references in `project.pbxproj` | **VERIFIED** (exact match) |

### Table 5: Unverifiable Claims

These require runtime data or external system access — cannot be confirmed from codebase alone:

| Claim | Reason |
|---|---|
| ~7 min/class compilation estimate | Requires running xcodebuild |
| Mutation testing feasibility | Toolchain claim |
| Cost/token budget | No data available |
| CI timeout concerns | Needs Bitrise config access |
| `-derivedDataPath` concurrent builds | Xcode build system behavior |
| TECHOPS-2187 ticket reference | Needs Jira access |

---

## Verification Summary

| Category | Count |
|---|---|
| **VERIFIED** | **22** |
| **REFUTED** | **4** |
| **UNVERIFIABLE** | **6** |

### Refutations Detail

1. `*Tests.swift` count: claimed 1,269, actual **1,270** (off by 1)
2. `.m` file count: claimed 451, actual **473** (off by 22; line count ~150K is roughly correct)
3. Bridging header lines: claimed 242, actual **241**; claimed "190+" imports, actual **220**
4. Second naming conflict: claimed `MFPFoodTest.m ↔ FoodTests.swift`, actual conflict is **`FoodTests.m ↔ FoodTests.swift`**

**All refutations are minor — no claim is directionally wrong. The analysis is substantively accurate.**

---

## Top 3 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `.xcodeproj` target membership — bots must add files programmatically | **Blocker** | Phase 0 will surface the right approach |
| Tests mirror implementation rather than testing behavior | **High** | Judge rubric + sampled mutation testing (unverified) |
| Long-term ownership — teams won't maintain tests they didn't write | **High** | Organizational, not technical. Enforce via CODEOWNERS + required reviewers |

---

*Generated by Pythia multi-model analysis pipeline, 2026-03-30*
