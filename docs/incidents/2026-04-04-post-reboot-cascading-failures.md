# Incident Report: Cascading Failures After Dead Man Protocol Reboot

**Date:** 2026-04-04
**Severity:** P0 — Complete outage followed by partial outage
**Duration:** ~2 hours (multiple issues discovered and fixed sequentially)
**Triggered by:** Architect self-reboot via Dead Man Protocol after adding `/cc` session commands to the UI

## Summary

The Foreman Architect attempted a self-reboot after adding UI session control commands (`/cc session`, `/cc model`, `/cc name`, `/cc auto-approve`, `/cc new`). The reboot triggered a cascade of three distinct failures, each masking the next. The Dead Man Protocol snapshot was written correctly and proved essential for diagnosis.

---

## Failure 1: Express 5 Wildcard Route Crash (P0 — process won't start)

### Root Cause

The Architect added a `DELETE /api/roster/folders/*` route in `src/ui-api.ts`. Express 5 uses `path-to-regexp` v8, which no longer supports bare `*` wildcards — they require a name (e.g. `*folderPath`).

### Error

```
PathError [TypeError]: Missing parameter name at index 21: /api/roster/folders/*
    at registerUiRoutes (dist/ui-api.js:38:15)
```

### Impact

Fatal crash on startup. Launchd's `KeepAlive: true` respawned Foreman repeatedly, creating a crash loop visible in `~/.foreman/foreman.out.log` (dozens of `[session] Loaded 64 channel session(s)` lines with no "Foreman is running" following).

### Fix

Changed the route from bare `*` to Express 5's named wildcard syntax:

```typescript
// BROKEN — Express 5 / path-to-regexp v8
app.delete('/api/roster/folders/*', (req, res) => {
  const folderPath = (req.params as any)[0] as string;

// FIXED — named wildcard, array join for nested paths
app.delete('/api/roster/folders/*folderPath', (req, res) => {
  const folderPath = (req.params.folderPath as unknown as string[]).join('/');
```

### Lesson

Express 5 changed the routing syntax from Express 4. Bare `*` wildcards must be named. TypeScript compiles either version — this is a runtime-only failure. The Architect should test route registration (not just build) before rebooting.

---

## Failure 2: Launchd Crash Loop vs. Manual Start Race (P1 — operator confusion)

### Root Cause

After killing the zombie Foreman process (PID 66896), launchd immediately respawned a new instance. Attempting to start Foreman manually while launchd was active caused `EADDRINUSE: address already in use :::3001`.

### Impact

Appeared as though the fix didn't work. Multiple failed manual starts.

### Fix

1. `launchctl unload ~/Library/LaunchAgents/com.foreman.bot.plist` — stop launchd from respawning
2. Kill any remaining process on port 3001
3. Test the fix with a manual start
4. `launchctl load` — re-enable launchd supervision

### Lesson

When debugging a launchd-managed process, always unload the plist first. Otherwise you're racing against the supervisor. The Dead Man Protocol should include a step to unload launchd before testing.

---

## Failure 3: Stale Slack Session After Reboot (P2 — Architect unresponsive in Slack)

### Root Cause

The Foreman DM channel (`D0AJPAJPX9D`) retained a `sessionId` from before the crash loop. After Foreman came back up, the next user message triggered `resumeSession()` with the stale session UUID. The Claude Agent SDK attempted to resume the old conversation, which was mid-tool-call (a Bash command). The session appeared "hung" — showing "Bash..." in Slack with no progress.

### Impact

Foreman appeared unresponsive in Slack. Other bots (betty, clive, etc.) worked fine because they use stateless Kafka consumers, not persistent sessions.

### Current Status

**Not yet fixed.** The stale session needs to be cleared. Options:
- `/cc new` in the DM channel from Slack
- Manually clear the `sessionId` for `D0AJPAJPX9D` in `~/.foreman/sessions.json`

### Lesson

The Dead Man Protocol's Step 7 (post-reboot verification) should include clearing the Architect's own Slack session before rebooting, or the reboot tool itself should auto-clear. A stale `sessionId` after a process restart will always try to resume a dead conversation.

**Recommended fix:** Add session cleanup to `SelfReboot` — before calling `process.exit(0)`, set `sessionId = null` for the requesting channel so the next message starts fresh.

---

## Timeline

| Time | Event |
|------|-------|
| ~21:30 | Architect finishes adding `/cc` session commands to UI |
| ~21:30 | Architect writes Dead Man snapshot + session handoff note |
| ~21:30 | Architect calls `SelfReboot` |
| ~21:30 | Foreman exits, launchd respawns → crash on `/api/roster/folders/*` route |
| ~21:30–21:52 | Crash loop: launchd keeps restarting, Foreman keeps dying (visible in logs) |
| ~21:50 | Chris reports Foreman is hung |
| 22:00 | Claude Code (external) diagnoses Express 5 wildcard route crash |
| 22:05 | Fix applied to `src/ui-api.ts`, build clean |
| 22:10 | Launchd unloaded, manual test confirms fix, launchd reloaded |
| 22:15 | Foreman is up — API healthy, Kafka consumers running, Temporal worker started |
| 22:20 | Chris reports Slack Architect still unresponsive ("Bash...") |
| 22:25 | Diagnosed as stale session resume — `D0AJPAJPX9D` has old `sessionId` |
| — | **Awaiting:** `/cc new` or manual session clear |

## Files Changed

| File | Change |
|------|--------|
| `src/ui-api.ts` | Fixed `DELETE /api/roster/folders/*` → `/*folderPath` (Express 5 named wildcard) |

## Dead Man Protocol Assessment

The protocol **worked as designed** — the snapshot at `~/.claude/projects/-Users-chris-shreve/memory/project_foreman_2.md` had the correct last-known-good commit (`f84646b`), the changed files list, and rollback commands. The session handoff at `docs/session-handoff.md` accurately described what was being worked on.

**Gaps identified:**
1. No pre-reboot route registration test (would have caught Failure 1)
2. No guidance on launchd interaction during recovery (caused confusion in Failure 2)
3. No session cleanup before reboot (caused Failure 3)

## Recommended Dead Man Protocol Updates

- **New Step 2.5:** After build, do a 5-second smoke test: start Foreman, confirm "Foreman is running" appears in stdout, then kill it. This catches runtime-only crashes that `tsc` misses.
- **Update Step 6:** Before calling `SelfReboot`, clear the requesting channel's `sessionId` so resume doesn't pick up a mid-tool-call conversation.
- **Add to Recovery section:** "If Foreman is launchd-managed, run `launchctl unload ~/Library/LaunchAgents/com.foreman.bot.plist` before debugging."
