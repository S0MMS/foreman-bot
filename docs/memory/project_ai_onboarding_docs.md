---
name: AI Onboarding Docs (FlowSpec + Pythia)
description: Status of the 3 AI onboarding docs — local files and Confluence pages, editorial rules, page IDs
type: project
---

Three AI onboarding documents created for the MFP ENG Confluence space under "AI Infrastructure Research."

**Why:** To help other AI agents (and humans) get up to speed on Foreman, FlowSpec, and Pythia.

**How to apply:** When editing these docs or pushing to Confluence, follow the editorial rules below exactly.

## Local Files
- `claude-slack-bridge/docs/foreman/ai-onboarding.md` — summary doc
- `claude-slack-bridge/docs/foreman/session-handoff.md` — full session context doc for resuming work
- `claude-slack-bridge/docs/flowspec/flowspec-reference.md` — FlowSpec AI onboarding / Confluence version
- `claude-slack-bridge/docs/flowspec/flowspec.md` — full engineering spec (not on Confluence)
- `claude-slack-bridge/docs/flowspec/flowspec-status.md` — implementation status
- `claude-slack-bridge/docs/flowspec/flowspec-fix-plan.md` — fix plan
- `claude-slack-bridge/docs/pythia/pythia-reference.md` — full Pythia design + research

## Confluence Page IDs
- AI Onboarding Summary: `127963955247`
- FlowSpec Language Reference: `127964381198`
- Pythia Workflow: `127964217426`
- Parent (AI Infrastructure Research): `127963332110`

## Editorial Rules (enforced)
1. Both FlowSpec and Pythia descriptions must open with: "**[X] was designed from the ground up by AI, for AI.**" — before any description of what they do.
2. Use "the dev" not "Chris" in narrative descriptions. Only exception: Authors header in flowspec-reference.md stays as "Chris Shreve."
3. Push to Confluence as raw markdown — no HTML, no noformat macros. Pass the `.md` file content directly as the `body` param to `ConfluenceUpdatePage`.
4. Docs are organized into subdirs: `docs/flowspec/`, `docs/pythia/`, `docs/foreman/`, `docs/s3demo/`.
