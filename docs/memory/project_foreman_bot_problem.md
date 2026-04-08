---
name: Foreman UI — Conversation Loss After Idle
description: Architect conversation disappears after ~1 hour idle — messages stored only in React state, lost on any page reload
type: project
---

# Bug: Conversation Loss After Idle

**Reported:** 2026-04-06 by Chris

**Symptom:** After leaving the Foreman UI idle for ~1 hour (meal, nap, etc.), the entire Architect conversation is gone when returning. Behaves as if a hard refresh happened without the user knowing.

**Why:** `messagesByBot` in `App.jsx` is in-memory React state. Any page reload wipes it. Likely cause: Vite dev server drops its HMR WebSocket after extended idle, triggering a full page reload instead of a hot update.

**How to apply:** This needs a persistence layer for conversation history — either `localStorage` for quick wins or backend persistence (write messages to disk/DB) for durability. Also investigate Vite HMR timeout behavior and whether the auto-reconnect logic inadvertently triggers state loss.

**Priority:** High — this loses work context and forces Chris to re-explain things.
