---
name: Virtual Chris / Orchestrator Agent
description: Chris's idea to build a "virtual me" — an orchestrator agent that knows Chris well enough to make decisions on his behalf and direct other sub-agents
type: project
---

# Virtual Chris — Orchestrator Agent Concept

## The Idea
Chris wants to build a "Virtual Chris Shreve" — an AI orchestrator agent that:
- Is deeply informed about who Chris is, his preferences, and his priorities
- Can make decisions on his behalf without asking him for every detail
- Directs specialized sub-agents (coding bots, research bots, build bots, etc.)

## Architecture (3 Layers)

### Layer 1: The "Virtual Chris" Profile
A rich, structured document capturing:
- Chris's priorities and current projects
- How he likes things done (preferences, style)
- What he'd approve/reject without asking
- His technical context (iOS dev, tools, etc.)

**Seed material already exists**: the shared memory files in `docs/memory/` (in the Foreman repo)

### Layer 2: The Orchestrator Agent (the "Virtual Chris" brain)
A Claude instance that:
- Loads the Virtual Chris profile as its system prompt
- Receives tasks (from Slack, another bot, a trigger, etc.)
- Decides what to do and which sub-agent to hand off to
- Knows when to ask Chris vs. act independently

### Layer 3: Sub-agents (already partially built)
Specialized bots the orchestrator directs:
- **Coding agent**: Foreman / Claude Code (already exists)
- **Research agent**: TBD
- **Build/deploy agent**: TBD (see `/cc build` idea)

## Status
- **Status**: Early concept — moving slowly, thinking it through
- **Next step**: Fleshing out the Virtual Chris profile, then designing the orchestrator's decision logic
