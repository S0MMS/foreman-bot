# Session Handoff — 2026-04-07 (reboot 27 — bump reaction delay to 1000ms)

## What We Changed
Bumped the pre-reaction delay from 500ms to 1000ms for extra safety margin. 500ms confirmed the race condition theory — 🤔 appeared for the first time. 1000ms gives the browser more headroom.

## Files Changed
| File | Change |
|---|---|
| `src/mattermost.ts` | `setTimeout(resolve, 500)` → `setTimeout(resolve, 1000)` |

## Full Reaction Flow (current)
1. Message received
2. 1000ms pause (browser sets up reaction listener)
3. 🤔 added to user's message
4. Claude processing (long — 🤔 visible whole time)
5. `onBeforePost`: typing indicator + 1s pause + ✅ added
6. Response posted

## What Was Accomplished This Session
- SelfReboot DM detection fixed (Mattermost channel IDs don't start with "D")
- Reboot notification working (posts to channel after restart)
- Typing indicator now fires AFTER processing, not before
- 🤔 reaction race condition found and fixed
- All 3 UI improvements working

## Next Steps
1. Verify 🤔 still appears with 1s delay
2. Wire Kafka routing for non-Architect bots
3. Port remaining /cc commands to Foreman 2.0
