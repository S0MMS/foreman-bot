# Plan: pythia-v.flow — File-backed Pythia for oversized responses

**Goal:** Get Pythia working out-of-the-box by writing oversized responses (synthesis, collator report) to disk instead of posting them to Mattermost channels that can't handle the size.

**Invocation:**
```
/f run flows/pythia-v.flow base_dir=workspaces/pythia/techops-2187 question_file=workspaces/pythia/techops-2187/prompt.md
```

---

## The Problem

`dispatchToBot` → `processChannelMessage` always posts the bot's full response back to its Mattermost channel. When Phase 2 (synthesis) or the final collator produces 20K+ chars, `postMessage` fails with a 400 error because Mattermost's max post size is 16,383 chars.

There's existing chunking logic (split at 15K chars) but it does a raw character split that breaks markdown formatting. Even if it worked, dumping 20K of text into a channel isn't useful.

## The Solution

The current `pythia.flow` already demonstrates the pattern:
1. `ask @pythia-collator """...""" -> detailed_report` — bot generates the huge response, captures it in a variable
2. `write {detailed_report} to {output_file}` — saves the full response to disk
3. `ask @pythia-collator "Now give a SHORT executive summary..."` — posts a short summary to the channel

**Key insight from code review:** The full response still gets posted to the bot's own working channel (e.g., `#pythia-claude-judge`). That's fine — it's a working channel, not where the user watches. The user sees the report channel, which only gets summaries.

For `pythia-v.flow`, we apply this same pattern to the two problematic intermediate steps.

## No Engine Changes Required

FlowSpec already supports everything we need:
- `ask @bot """...""" -> variable` — captures response into a variable
- `write {variable} to {path}` — writes a variable to a file on disk
- `ask @bot "summarize..."` — follow-up ask for a short summary
- `input base_dir` — parameterize the output directory

**Zero changes to AST, parser, or compiler.**

---

## What Changes from `pythia.flow`

### 1. New input: `base_dir` (replaces `output_file`)

```
workflow "Pythia Heavy"
  inputs: question, question_file, base_dir, mode (default "code")
```

The user passes a directory like `workspaces/pythia/techops-2187`. All output files go there.

### 2. Phase 2 — Synthesis (the first problematic step)

**Current (`pythia.flow`):**
```
ask @pythia-claude-judge """...""" -> synthesis
```
Response is captured into `{synthesis}` variable AND posted to the judge channel. If >16K, the channel post fails.

**New (`pythia-v.flow`):**
```
ask @pythia-claude-judge """...""" -> synthesis

write {synthesis} to {base_dir}/phase2-synthesis.md

ask @pythia-claude-judge """
  You just completed a synthesis of multi-model research.
  Provide a 3-5 paragraph summary of your key findings,
  areas of agreement/disagreement, and confidence levels.
  End with: "Full synthesis written to {base_dir}/phase2-synthesis.md"
""" -> synthesis_summary
```

The full synthesis is saved to disk. A short summary is posted to the channel. The `{synthesis}` variable still contains the full content for downstream steps (Phase 3 critiques).

### 3. Final Collator Report (the second problematic step)

**Current (`pythia.flow`):**
```
ask @pythia-collator """...""" -> detailed_report

if {output_file} is not empty
  write {detailed_report} to {output_file}

ask @pythia-collator "Now give a SHORT executive summary..."
```

**New (`pythia-v.flow`):**
```
ask @pythia-collator """...""" -> detailed_report

write {detailed_report} to {base_dir}/phase3-collator.md

ask @pythia-collator """
  You just produced a detailed report on: "{question}"
  Now give a SHORT executive summary — 3-5 paragraphs max.
  Hit the key findings, biggest risks, and top recommendations only.
  End with: "Full detailed report written to {base_dir}/phase3-collator.md"
""" -> summary
```

### 4. Everything else stays the same

Phase 1 (research workers), Phase 3 (critiques), Phase 4 (revision), Phase 5 (verification) — all post to channels normally. Their responses are within Mattermost's size limits.

---

## Directory Structure After a Run

```
workspaces/pythia/techops-2187/
  prompt.md                  ← user creates this (the research question)
  phase2-synthesis.md        ← written by Phase 2 (judge synthesis)
  phase3-collator.md         ← written by final collator (comprehensive report)
```

Organized by problem — each Pythia investigation gets its own subdirectory:
```
workspaces/pythia/
  techops-2187/
  multi-agent-comparison/
  mfp-sync-strategy/
```

---

## Implementation Steps

1. **Copy `flows/pythia.flow` → `flows/pythia-v.flow`**
2. **Change inputs:** replace `output_file` with `base_dir`
3. **Add write + summary after Phase 2** (synthesis step)
4. **Update collator section** to use `base_dir` paths
5. **Test:** Create a workspace dir, write a prompt.md, run the flow

## Estimated Scope

| What | Effort |
|---|---|
| Copy + modify flow file | ~30 min |
| Engine changes | **None** |
| New code | **None** |
| Testing | Run one Pythia query end-to-end |

This is purely a flow file change. No code modifications at all.
