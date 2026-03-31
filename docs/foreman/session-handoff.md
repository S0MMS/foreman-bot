# Foreman Session Handoff

*Use this doc to resume context in a fresh Claude Console session if Foreman goes down.*

---

## What Foreman Is

Foreman is a Claude Code instance running locally on a Mac, controllable via Slack. The bridge codebase lives at `/Users/chris.shreve/claude-slack-bridge`. Each Slack channel gets its own independent bot session.

---

## What We Were Working On

Creating and maintaining 3 AI onboarding documents about Foreman, FlowSpec, and Pythia — both as local markdown files and as Confluence pages in the MFP ENG space under "AI Infrastructure Research."

---

## The 3 Documents

### Local Files
| File | Purpose |
|------|---------|
| `/Users/chris.shreve/claude-slack-bridge/docs/ai-onboarding.md` | Summary doc for new AI agents |
| `/Users/chris.shreve/claude-slack-bridge/docs/flowspec-reference.md` | Full FlowSpec language spec |
| `/Users/chris.shreve/claude-slack-bridge/docs/pythia-reference.md` | Full Pythia design + research |

### Confluence Pages (MFP ENG space)
| Page | ID | URL |
|------|----|-----|
| Foreman, FlowSpec & Pythia — AI Onboarding Summary | `127963955247` | https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127963955247 |
| FlowSpec Language Reference | `127964381198` | https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127964381198 |
| Pythia: Multi-Model Verification Workflow | `127964217426` | https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127964217426 |

Parent page (AI Infrastructure Research): https://myfitnesspal.atlassian.net/wiki/spaces/ENG/pages/127963332110

---

## Key Editorial Decisions (Already Applied)

1. **AI-designed origin is the first thing said** for both FlowSpec and Pythia — before any description of what they do. The phrase is: *"[X] was designed from the ground up by AI, for AI."*
2. **"Chris" replaced with "the dev"** in narrative descriptions (e.g. "The dev posed a question to Delphi..."). The only remaining "Chris Shreve" is in the Authors header of `flowspec-reference.md` — this was intentionally left.
3. **No HTML, no macros** — Confluence pages are posted as raw markdown via the `ConfluenceUpdatePage` MCP tool.
4. **Pythia origin story**: The dev asked Delphi to run Delphi on itself. The output became Pythia's design spec. This is emphasized in all three docs.
5. **FlowSpec origin story**: 3-round Delphi process, 6 AI agents, the output IS the language.

---

## Current State

All 3 local `.md` files and all 3 Confluence pages are in sync as of this session. The `.txt` files in the same directory are stale (not kept in sync) — ignore them.

---

## Tools Available

- **Confluence**: `ConfluenceUpdatePage`, `ConfluenceReadPage`, `ConfluenceSearch` (MCP tools via foreman-toolbelt)
- **Update flow**: Edit the `.md` file locally → push to Confluence by passing the raw markdown string as the `body` param to `ConfluenceUpdatePage`
- **No HTML**: Do not wrap content in HTML tags or noformat macros — pass raw markdown only

---

## Pending / Next Steps

- Nothing urgent outstanding on the docs
- The `.txt` files (`ai-onboarding.txt`, `flowspec-reference.txt`, `pythia-reference.txt`) are stale and could be deleted — they were an intermediate step that's no longer needed
- `flowspec-reference.md` line 5 still says "Chris Shreve" in the Authors header — this was intentionally left per user instruction

---

## Other Active Context

- A Foreman bot was trying to read `https://sites.google.com/myfitnesspal.com/portal/ai-maturity` but can't due to SSO. The user can see it in their browser. Resolution options discussed: copy-paste into Slack, save to a canvas, or save as a local file.
- `/cc bots add` command was fixed earlier in this session to resolve channel names to IDs (used to store literal channel names, now looks up real channel IDs via `conversations.list`)
