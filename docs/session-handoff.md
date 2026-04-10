# Session Handoff — 2026-04-10 (Temporal Dockerization)

## What we were working on
Dockerizing Temporal so `docker compose up` starts the full stack. This is Step 1 of making Foreman distributable to PMs/POs — no Homebrew dependencies, just clone + docker compose up.

## What was done this session
1. Created `docker/init-temporal-db.sql` — creates `temporal` + `temporal_visibility` databases in Postgres
2. Added `temporal` (temporalio/auto-setup) and `temporal-ui` services to `docker-compose.yml`
   - Blue/green test ports: Temporal gRPC on 7244, UI on 8244 (Homebrew still on 7233)
   - Fixed dynamic config issue: set `SKIP_DYNAMIC_CONFIG_UPDATE: "true"`
   - Fixed healthcheck: uses `tctl --address $(hostname -i):7233 cluster health`
3. Updated `src/temporal/client.ts` — uses `process.env.TEMPORAL_ADDRESS || 'localhost:7233'`
4. Updated `src/temporal/worker.ts` — explicit `NativeConnection` with same env var
5. Build passes. Smoke test passes (Foreman starts, connects to Docker Temporal on 7244).
6. Docker Temporal is running and healthy: `docker ps` shows `foreman-temporal (healthy)`
7. Manually created `temporal` and `temporal_visibility` databases in existing Postgres

## Where we left off
Added `TEMPORAL_ADDRESS=localhost:7244` to launchd plist and rebooting Foreman.
If Foreman comes back, run `/f run flows/flowspec-tutorial.flow` as acceptance test.

**Rollback if Foreman won't start:**
1. Remove the `TEMPORAL_ADDRESS` key+value from `~/Library/LaunchAgents/com.foreman.bot.plist`
2. `launchctl unload ~/Library/LaunchAgents/com.foreman.bot.plist`
3. `launchctl load ~/Library/LaunchAgents/com.foreman.bot.plist`

## Key design decisions
- Blue/green approach: Docker Temporal on alternate ports (7244/8244) alongside Homebrew (7233)
- `TEMPORAL_ADDRESS` env var — runtime config, no rebuild needed
- Shared Postgres with Mattermost (same container, separate databases)
- After acceptance test passes: switch Docker ports to 7233/8233, stop Homebrew Temporal

## Rollback if Foreman won't start
```bash
git checkout 5c453c9 -- src/temporal/client.ts src/temporal/worker.ts
npm run build
node dist/index.js   # no env var = falls back to Homebrew Temporal on 7233
```

## Next steps after reboot
1. Verify Foreman is healthy (health endpoint, bot responses)
2. Run `/f run flows/flowspec-tutorial.flow` — all 7 lessons must pass
3. If pass: switch Docker Temporal to port 7233, stop Homebrew Temporal
4. Commit all changes
5. Continue with distribution plan (bootstrap script, onboarding guide)
