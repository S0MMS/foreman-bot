# MFP Rewrite — v1
**Created:** 2026-03-25
**Mode:** `--research --deep`
**Changes from previous:** Initial version

---

## Setup

- **Workers:** `#WORKER_1`, `#WORKER_2`, `#WORKER_3`
- **Judge:** run the command from the judge channel

## Prompt

```
/cc delphi --research --deep "I am rewriting the entire MyFitnessPal iOS and Android apps from scratch using 100% AI bots. The two non-negotiable constraints are: (1) native — Swift for iOS, Kotlin for Android, and (2) maximum simplicity — the codebase must be as simple as possible so that AI bots can develop features efficiently and correctly.

I am not asking you to solve this problem. I am asking you to identify the RIGHT QUESTIONS I should be asking.

Background:
- MFP is a large, mature fitness and nutrition tracking app with millions of users
- This is a 100% greenfield app. There is zero existing code. Not a single line will be carried over.
- Every line of code will be written by an AI bot. Human developers play an optional guidance and review role only — they do not write code.
- The goal is an architecture and codebase that AI can develop features in efficiently, correctly, and in parallel
- 'Simplicity' means: predictable patterns, clear module boundaries, minimal magic, easy for an AI to read and confidently modify any part of the codebase without breaking something elsewhere
- The backend is staying — this is a client rewrite only
- A sync replacement is already in progress (PowerSync + Apollo Client on iOS)

What are the most important questions I should be asking? Consider:

1. ARCHITECTURE — What architectural decisions have the biggest impact on AI's ability to develop features efficiently? What makes a codebase 'AI-friendly' vs 'AI-hostile'? Is there prior research or industry experience on this?

2. SCOPING — How do you decide what to include in the rewrite vs what to cut? What is the 20% of features that covers 80% of real user value? What questions help you make those calls?

3. AI WORKFLOW — What does the development process actually look like when AI bots are the primary developers? What questions do you need to answer about feature specs, code review, testing, and quality gates before you start?

4. PARALLELISM — MFP has a large engineering team. How do you structure the codebase and the work so that many AI bots can develop features in parallel without stepping on each other?

5. NATIVE COMPLEXITY — Native Swift and Kotlin have real complexity (lifecycle, memory management, platform APIs). What questions should I be asking about where that complexity lives and how to keep it out of feature code?

6. RISKS — What are the highest-risk assumptions baked into this plan? What questions would surface those risks early?

For each question you identify, explain WHY it is the right question to be asking at this stage — what decision it unlocks or what risk it surfaces."
```
