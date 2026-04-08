---
name: Dead Man Protocol
description: The mandatory protocol Foreman follows before modifying its own source code and rebooting. If Foreman is down and you don't know why, start here.
type: feedback
---

# The Dead Man Protocol

The Dead Man is Foreman's self-modification safety protocol. Named after the Dead Man's Switch concept — before any dangerous operation, a safe state is written. If the operation fails, recovery starts from that safe state.

**Why:** Foreman can modify its own source code, rebuild, and reboot itself. This is powerful but dangerous. Without this protocol, a bad change can take Foreman completely offline with no recovery path for the next Claude instance.

**How to apply:** Follow every step, in order, every time. No shortcuts. No autonomous reboots.

---

## The Protocol — All 7 Steps Required

### Step 1 — Pre-flight announcement
Before touching any code, state out loud to the user:
- What files will be changed and why
- The current last-known-good git commit: `git log --oneline -3`

### Step 2 — Make changes + build
- Make the code changes
- Run `npm run build`
- If build fails: fix it. **Do NOT proceed to Step 2.5.**
- Confirm clean build to user explicitly

### Step 2.5 — Runtime smoke test (NON-NEGOTIABLE)
After a clean build, do a 5-second smoke test:
```bash
node dist/index.js &
sleep 5
curl -s http://localhost:3001/health
kill %1
```
- Confirm "Foreman is running" appears in stdout
- If it crashes: fix it. **Do NOT proceed to Step 3.**
- `tsc` passing does not mean the process starts — Express 5 route syntax, ESM/CJS issues, and similar errors are runtime-only

### Step 3 — Dead Man snapshot (NON-NEGOTIABLE)
Update `docs/memory/project_foreman_2.md` (in the repo root) with:
- Status: `⚠️ REBOOTING — if Foreman is down, read this`
- Which files were changed
- The last-known-good commit hash
- Exact rollback commands (copy-paste ready)

This step is what makes recovery possible. If it's skipped, the next Claude instance is blind.

### Step 4 — Write session handoff note
Write a summary of the current conversation to `docs/session-handoff.md` (in the repo root):
- What we were working on
- Where we left off
- Any decisions made or context that won't survive the reboot
- Any open questions or next steps

This is what the next Claude instance will read to pick up where we left off.

### Step 5 — Explicit user approval
Ask the user: *"Build is clean, Dead Man is updated, handoff note written. Ready to reboot — shall I proceed?"*

**Never call SelfReboot without the user saying yes. Never. Not even once.**

### Step 6 — Reboot
Call SelfReboot. Wait for the ✅ confirmation message.

Note: Do NOT clear the sessionId before rebooting. A clean SelfReboot exits gracefully (not mid-tool-call), so the session resumes correctly. The handoff note (Step 4) covers context if resume fails. Clearing sessionId is a recovery action, not a pre-reboot action.

### Step 7 — Post-reboot verification
- Test health: `curl http://localhost:3001/health`
- Test the specific functionality that changed
- Update memory: status = `✅ HEALTHY` or `🔴 BROKEN — see recovery steps`
- Report results to user

---

## Recovery Protocol (for a fresh Claude session)

If Foreman is down and unresponsive:

```bash
# 0. If launchd-managed, STOP the supervisor first to avoid racing it
launchctl unload ~/Library/LaunchAgents/com.foreman.bot.plist

# 1. Kill any process still holding port 3001
lsof -ti :3001 | xargs kill -9

# 2. Read the Dead Man snapshot
cat /Users/chris.shreve/claude-slack-bridge/docs/memory/project_foreman_2.md

# 3. Find the last-known-good commit in the snapshot
cd /Users/chris.shreve/claude-slack-bridge
git log --oneline -5

# 4. Revert the broken files
git checkout <last-good-commit> -- <file1> <file2>

# 5. Rebuild and smoke test
npm run build
node dist/index.js   # confirm "Foreman is running" then Ctrl-C

# 6. Re-enable launchd supervision
launchctl load ~/Library/LaunchAgents/com.foreman.bot.plist
```

**If Foreman starts but is unresponsive in Slack (shows hung tool call):**
- Likely a stale sessionId. Edit `~/.foreman/sessions.json` and set `sessionId: null` for the affected channel.
- Or send `/cc new` from that Slack channel.

---

## What This Is Based On

This protocol combines:
- **Blue/Green Deployment** — build and verify before switching
- **Dead Man's Switch** — write safe state before the operation, not after
- **Runbook-driven ops** — if you can't write the recovery steps first, you're not ready to make the change
- **Bootstrapping safety** — always keep a known-good prior version available until the new one is verified
