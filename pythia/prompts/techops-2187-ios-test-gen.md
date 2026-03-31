You are advising on TECHOPS-2187: AI-generate unit tests for a legacy iOS codebase.

CONTEXT:
- Repo: mfp-ios (MyFitnessPal iOS app)
- Language: Objective-C, ~110K lines of code
- Test framework: XCTest, base classes are BaseTestCase and BaseTestCaseWithSetCurrentUser
- No UI tests (QA owns a separate suite)
- SonarQube enforces 80% coverage on new code — below that requires Staff+ approval
- Legacy areas are largely untested
- We have Claude Code bots that can read code, write code, run commands, and interact with GitHub/Jira
- The bots operate via Slack channels, orchestrated by a workflow language called FlowSpec

TICKET PHASES:
Phase 1 — Inventory: Identify all ObjC classes with zero test coverage. Establish baseline.
Phase 2 — Effort Estimation: Assess complexity, dependencies, testability per class.
Phase 3 — Scope Reduction: If effort is too large, prioritize by git activity, business criticality, complexity, and proximity to areas where AI agents will be working.

FLOWSPEC SYNTAX (for your workflow output):
- ask @bot "prompt" -> variable    — dispatch to bot, wait, capture response
- send #channel "text"             — fire-and-forget notification
- at the same time                 — parallel fan-out (indent branches)
- if {var} contains/equals/means "X" — conditional
- otherwise / otherwise if         — else branches
- repeat until {var} op "X", at most N times — convergence loop
- for each item in {list}          — bounded iteration
- run "Workflow" [with k=v] [-> name] — sub-workflow call
- pause for approval with message "..." — human gate
- within <duration>                — timeout
- retry N times / if it fails      — error handling
- stop "message"                   — exit workflow
- {variable}                       — interpolation
- -- comment                       — line comment

Available bots: @claude-worker (Claude Sonnet), @gemini-worker (Gemini), @gpt-worker (GPT-4o), @claude-judge (Claude Opus). All bots have file read/write, bash, grep, glob tools and access to the mfp-ios repo.

DELIVERABLES REQUESTED:
1. A phased implementation plan with clear steps, decision points, and risk mitigations
2. A FlowSpec workflow (.flow syntax) that orchestrates the test generation process across multiple bots — covering inventory, prioritization, generation, and verification of tests
3. Recommendations on batch size, parallelization strategy, and quality gates

Consider: How do you handle classes that are genuinely untestable without major refactoring? How do you validate generated tests actually test meaningful behavior (not just line coverage)? How do you avoid generating tests that are brittle or tightly coupled to implementation details? What's the right human-in-the-loop checkpoint?
