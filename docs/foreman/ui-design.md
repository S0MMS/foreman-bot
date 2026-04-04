---
title: Foreman UI — Design Document
status: in progress
date: 2026-04-03
---

# Foreman UI Design

A local web app that is a **complete replacement for Slack** when at your Mac.
No Slack required. Runs at `localhost:5173` when `npm run ui` is active.

**Primary principle: Slack-free.** Every feature must work without Slack. If it requires Slack, it doesn't belong in the UI.

---

## Core Concept

The UI is a full replacement transport layer, not a mirror of Slack.

- Messages typed in the UI go directly to the agent/bot
- Slack remains available as a parallel transport (phone use)
- Same bot identity and system prompt — separate conversation histories
- Tool approvals (Approve/Deny) happen inline in the UI chat — no Slack needed

---

## Layout

```
┌──────────────┬──────────────────────────────────────────────┐
│ THE ROSTER   │ [ Chat ] [ Canvas 1: Auth Flow ] [ + ]        │
│              ├──────────────────────────────────────────────┤
│ ARCHITECT    │                                               │
│  ● Foreman   │   You: Can you build the project?             │
│              │                                               │
│ TECHOPS-2187 │   Claude: Sure, running the build now.        │
│  ○ Betty     │                                               │
│  ○ Clive     │   ┌─ 🔧 Bash ──────────────────────────┐    │
│              │   │  npm run build      [Approve] [Deny] │    │
│ PYTHIA       │   └──────────────────────────────────────┘    │
│  ○ Gemini    │                                               │
│  ○ GPT       │   ✅ Bash: Build succeeded in 3.2s            │
│              │                                               │
│ GENERAL      │   Claude: Build succeeded! Here's what...     │
│  ○ Test Dbl  │                                               │
│              │   ●●● (streaming indicator)                   │
│              ├──────────────────────────────────────────────┤
│              │  [input box]                         [Send]   │
└──────────────┴──────────────────────────────────────────────┘
```

---

## The Roster (Left Nav)

The Roster is the persistent left panel. It organizes all agents into a navigable tree.

### Structure

```
ARCHITECT             ← hardcoded, always pinned at top, never in a group
  ● Foreman           ← this is the full Claude Code agent (me)

TECHOPS-2187          ← collapsible group (from bots.yaml roster: field)
  ○ Betty
  ○ Clive

PYTHIA                ← collapsible group
  ○ Gemini Worker
  ○ GPT Worker

GENERAL               ← default group for bots without a roster: field
  ○ Test Double
```

### Rules
- **Architect** is hardcoded at the top. It is NOT in bots.yaml. It is always alone. It is always visible. It is the entry point for talking to the full Claude Code agent with tools.
- Every other bot belongs to exactly one group.
- Group membership is defined by a `roster:` field in `bots.yaml` using a slash-delimited path.
- Bots without a `roster:` field fall into `GENERAL` automatically.
- Groups are collapsible.

### Recursive Architecture (CRITICAL — do not change this)

The data model and renderer are **recursively defined**. No code should ever assume a fixed nesting depth.

**Data model** — every node is the same shape:
```js
{
  id: "techops",
  label: "TECHOPS-2187",
  children: [
    { id: "betty", label: "Betty", type: "bot" },       // leaf node
    { id: "batch-1", label: "Batch 1", children: [...] } // nested folder
  ]
}
```

**Renderer** — recursive React component:
```jsx
function RosterNode({ node, depth }) {
  if (node.type === 'bot') return <BotItem node={node} depth={depth} />
  return <FolderItem node={node} depth={depth}>
    {node.children.map(child =>
      <RosterNode key={child.id} node={child} depth={depth + 1} />
    )}
  </FolderItem>
}
```

`depth` controls indentation. No maximum depth. Adding deeper nesting requires zero code changes — only data changes.

**bots.yaml config** — `roster:` is a slash-delimited path:
```yaml
betty:
  roster: "TECHOPS-2187"           # one level (folder)

betty:
  roster: "TECHOPS-2187/Batch-1"   # two levels (folder/subfolder)

betty:
  roster: "Q2/TECHOPS/Batch-1"     # three levels — zero code changes needed
```

Tonight's implementation uses one level. The architecture supports infinite depth.

---

## Chat Tab

- Full scrollable conversation history (configurable max, e.g. last 200 messages)
- Real-time streaming — Claude's response appears token-by-token as it's generated
- Tool calls appear **inline** in the chat stream, exactly where they occurred
- **Tool approval** is inline — conversation pauses mid-stream for Approve/Deny click
- After approval/denial, streaming resumes
- Tool call states: pending (yellow) → approved (green) → denied (red) → complete

### Tool Call Rendering

```
┌─ 🔧 Bash ──────────────────────────────────┐
│  npm run build                              │
│                        [Approve]  [Deny]    │
└─────────────────────────────────────────────┘
```

After approval + execution:

```
┌─ ✅ Bash ──────────────────────────────────┐
│  npm run build                              │
│  > Build succeeded in 3.2s                 │
└─────────────────────────────────────────────┘
```

---

## Canvas Tabs

Each bot has its own canvas workspace — tabs across the top of the right panel.

### Canvas Types

| Type | Renders As |
|---|---|
| `markdown` | Formatted markdown — notes, summaries, docs |
| `mermaid` | Live rendered Mermaid diagram (SVG) |
| `flowspec` | Syntax-highlighted `.flow` file + Run button |
| `code` | Syntax-highlighted code block |
| `csv` | Sortable, filterable table |

### Canvas API (Foreman → UI)

Foreman controls canvases via REST:

```
POST   /api/canvas              → create new canvas tab
PUT    /api/canvas/:id          → update canvas content
DELETE /api/canvas/:id          → close canvas tab
GET    /api/canvas              → list all canvases for active bot
```

Canvas updates are pushed to the browser instantly via SSE — no refresh needed.

### Canvas Persistence

Canvases saved to `~/.foreman/canvases.json` keyed by bot name.
Tabs survive UI restarts and Foreman restarts.

### Scope

Canvases are **per bot** by default. Future: ability to share a canvas between bots.

---

## Real-time Architecture

```
Foreman (Express)
  ├── GET  /api/bots           → bot list from bots.yaml
  ├── GET  /api/stream/:topic  → SSE stream of Kafka topic messages
  ├── POST /api/produce        → publish message to {name}.inbox
  ├── POST /api/canvas         → create/update/delete canvas tabs
  └── WS   /api/chat/:botName  → bidirectional: send prompt, receive streamed tokens + tool events

Vite dev server (localhost:5173)
  └── proxies /api/* → Foreman Express port
```

Streaming tokens from Claude Agent SDK flow through a WebSocket to the browser.
Kafka topic tailing (inbox/outbox viewer) uses SSE.

---

## Workflow Launcher

- Left nav shows `.flow` files from `flows/` directory
- Click a workflow → modal appears with input fields (parsed from flowspec)
- Click Run → triggers Temporal workflow
- Output streams back into the Chat tab in real time

---

## Architect Chat — WebSocket Design

The Architect (Foreman/Claude Code) uses WebSocket, not SSE. This is required because tool approvals need true bidirectional communication — the server pauses mid-stream waiting for an approval signal from the browser.

```
Browser ◄──── WebSocket (ws) ────► Foreman Express server

Browser sends:
  { type: 'message', content: '...' }          ← user typed something
  { type: 'approve', toolId: '...', approved: true/false }  ← user clicked

Server sends:
  { type: 'token', content: '...' }            ← streaming text
  { type: 'tool_start', toolId, name, input }  ← tool being called
  { type: 'tool_approval', toolId, name, input } ← needs approval
  { type: 'tool_result', toolId, result }      ← tool completed
  { type: 'complete' }                         ← response done
  { type: 'error', message }                   ← something failed
```

Stream pauses when `tool_approval` is sent. Resumes when browser sends `approve`. Single connection handles everything — no session ID juggling.

Simple bots (betty, clive, etc.) continue to use SSE + POST. Architect uses WebSocket.

## Tech Stack

- **Vite** — dev server with HMR (instant component updates, no restart on code change)
- **React (plain JavaScript, no TypeScript)** — simpler, fewer moving parts, AI-maintained
- **Tailwind CSS** — utility classes only, no separate CSS files
- **Mermaid.js** — diagram rendering
- **marked** — markdown rendering
- **WebSocket (`ws` package)** — bidirectional channel for Architect chat + tool approvals
- **SSE** — server push for canvas updates and simple bot chat
- No shadcn/ui — plain Tailwind only

---

## Development Workflow

1. `npm run ui` — starts Vite dev server, opens `localhost:5173`
2. Give feedback via Slack
3. Foreman edits a React component
4. Vite HMR pushes the change to the browser **automatically** — no restart, no refresh
5. Verify in browser, repeat
6. Ctrl+C to stop the UI server (Foreman keeps running)

---

## Phase 3 Milestones

### ✅ Already done
- `ui/` scaffold: Vite + React + Tailwind (plain JS)
- Simple bot list in left nav
- Chat tab: send box + response display
- Canvas tab system: create/switch/close per-bot tabs
- Canvas rendering: markdown + mermaid
- SSE endpoint + `/api/bots`, `/api/chat`, `/api/canvas` routes

### 🔨 Tonight
- [ ] The Roster: recursive tree renderer (folders + bots)
- [ ] `roster:` field in bots.yaml (slash-delimited path)
- [ ] Architect pinned at top (hardcoded, not in bots.yaml)
- [ ] Collapsible folders in The Roster
- [ ] WebSocket endpoint for Architect chat
- [ ] Architect chat: streaming tokens via WebSocket
- [ ] Tool approval inline: Approve/Deny cards pause the stream

### Deferred
- Kafka topic stream view (inbox/outbox per bot)
- Workflow launcher modal
- Canvas type: flowspec + Run button
- Multi-level folder nesting UI (architecture already supports it)
