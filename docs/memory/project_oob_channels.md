---
name: Out-of-Box Channel Layout
description: The 5 Mattermost categories + DMs that every new Foreman dev gets on first startup. Defines the onboarding experience.
type: project
---

# Out-of-Box Channel Layout

The default Mattermost setup for new Foreman users. The bootstrap script creates all of these automatically.

**Why:** Foreman's target audience includes PMs and POs, not just engineers. The out-of-box experience must be immediately usable — organized categories, clear naming, progressive complexity from tutorial to advanced.

**How to apply:** Use this as the spec when updating `scripts/bootstrap.sh`, `bots.yaml`, and `config/channel-registry.yaml`. Every channel listed here should exist after bootstrap. Nothing more, nothing less.

---

## Categories + Channels

### FLOWSPEC TUTORIAL
Learning sandbox for FlowSpec workflows. The engineer helps you write flows; the bots are used by `flowspec-tutorial.flow`.
- `flowspec-engineer` (specialist — helps write .flow files)
- `flowbot-01`
- `flowbot-02`
- `flowbot-03`

### TECHOPS-2187
Real-world workspace example. Multi-model workers + judge + report channel.
- `claude-worker`
- `gemini-worker`
- `gpt-worker`
- `claude-judge`
- `techops-2187` (report/coordination channel)

### PYTHIA
Multi-model research pipeline. The most advanced FlowSpec showcase.
- `pythia-claude-worker`
- `pythia-gemini-worker`
- `pythia-gpt-worker`
- `pythia-claude-judge`
- `pythia-gemini-verifier`
- `pythia-collator`

### MODELS
Raw model access. One channel per model, auto-configured with the right provider. Short names that match what people actually call the models.
- `claude` (Anthropic Claude Opus)
- `gemini` (Google Gemini)
- `gpt` (OpenAI GPT)

### GENERAL
Everyday Claude bots for brainstorming, coding, rubber-ducking, ad-hoc work.
- `thought-pad`
- `alice`
- `bob`
- `charlie`

## Direct Messages
- `architect` (system admin — reboots, config, tools). This is the foreman bot's DM — no extra setup needed.

---

## Design Principles

1. **What you see is what you type** — channel display names match slugs exactly (lowercase-hyphenated). No ambiguity when referencing in `.flow` files.
2. **Progressive complexity** — Tutorial -> Real workspace -> Advanced pipeline -> Raw models -> Daily use.
3. **One foreman bot, many personas** — single Mattermost bot account serves all channels with different personas via `bots.yaml`.
4. **Categories map to use cases, not technology** — a PM sees "Tutorial", "Models", "General" and knows where to go.

---

## Channel Count Summary
- 4 tutorial + 5 techops + 6 pythia + 3 models + 4 general = **22 channels**
- 1 DM (architect — foreman bot's DM, created automatically)
