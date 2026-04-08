---
name: setSessionId fix for non-Anthropic adapters
description: Fix for Gemini/OpenAI adapters losing session memory — sessionId returned by start()/resume() was never saved back to SessionState
type: project
---

## Problem
Non-Anthropic adapters (Gemini, OpenAI) had no session memory. `state.sessionId` was always null, so every message called `start()` instead of `resumeSession()`. For Gemini, `start()` clears history with `this.histories.set(channelId, [])` — so every message started fresh.

## Root Cause
`startSession()` and `resumeSession()` in `claude.ts` return `{ result, sessionId }`, but in `slack.ts` the `sessionId` was never saved back to `SessionState`.

## Fix
In `src/slack.ts`:

**1. Add import:**
```ts
import {
  setSessionId,   // ← add this
  ...
} from "./session.js";
```

**2. In `processChannelMessage` — after the if/else start/resume block:**
```ts
  } else {
    result = await startSession(channel, text, state.cwd, name, onApprovalNeeded, onProgress, imagePaths, mcpServer, app);
  }
  if (result.sessionId) setSessionId(channel, result.sessionId);  // ← add this line
```

**3. In `runCanvasPrompt` (inside the canvas handler) — same pattern:**
```ts
      } else {
        result = await startSession(channel, prompt, state.cwd, name, onApprovalNeeded, onProgress, undefined, canvasMcp, app);
      }
      if (result.sessionId) setSessionId(channel, result.sessionId);  // ← add this line
```

## Notes
- `setSessionId` already existed in `session.ts` at line ~111
- Fix is just 2 lines added + 1 import
- After rollback, re-apply this fix cautiously: it may break `/cc model` switching because resumed sessions may ignore the new model. Consider calling `clearSession(channel)` (which resets sessionId to null) when `/cc model` is invoked.
- **CAUTION**: Once sessionId is saved for Anthropic adapter, `resumeSession()` locks the model. If user does `/cc model new-model`, the session ID should be cleared so next message calls `start()` with the new model.
