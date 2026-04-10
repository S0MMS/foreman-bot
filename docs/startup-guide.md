# Foreman 2.0 — Startup Guide

Use this after a Mac reboot or when any service is unexpectedly down.

---

## Full Stack Overview

| Service | Port | How it runs | Auto-starts? |
|---|---|---|---|
| **Foreman** (Node.js backend) | 3001 | launchd (`com.foreman.bot.plist`) | ✅ Yes |
| **Foreman UI** (Vite dev server) | 5173 | Manual | ❌ No |
| **Redpanda** (Kafka broker) | 19092 | `docker compose up` | ❌ No |
| **Redpanda Console** | 8080 | `docker compose up` | ❌ No |
| **PostgreSQL** | 5432 | `docker compose up` | ❌ No |
| **Mattermost** | 8065 | `docker compose up` | ❌ No |
| **Temporal** | 7233 | `temporal server start-dev` (Homebrew) | ❌ No |

**After a Mac reboot, only Foreman auto-restarts.** Everything else needs to be started manually.

---

## Startup Order

### Step 1 — Docker Desktop
Open from Applications or Spotlight (`Cmd+Space` → "Docker"). Wait for the whale icon in the menu bar to stop animating before proceeding.

> **Tip:** To make Docker auto-start on login: Docker Desktop → Settings → General → "Start Docker Desktop when you sign in"

### Step 2 — Redpanda + PostgreSQL + Mattermost
```bash
cd /Users/chris.shreve/claude-slack-bridge
docker compose up -d
```

Verify:
```bash
docker ps
```
You should see `foreman-redpanda`, `foreman-postgres`, and `foreman-mattermost` all with status `Up`.

### Step 3 — Temporal
```bash
temporal server start-dev
```
Keep this terminal open (or run it in the background). Temporal does not persist state between runs in dev mode.

### Step 4 — Foreman (usually already running)
Foreman is managed by launchd and should already be up. Verify:
```bash
curl http://localhost:3001/health
```
Expected: `{"status":"ok","dispatches":0}`

If it's not running:
```bash
launchctl load ~/Library/LaunchAgents/com.foreman.bot.plist
```

### Step 5 — Foreman UI (optional, only if using the React UI)
```bash
cd /Users/chris.shreve/claude-slack-bridge
npm run ui
```
Open `http://localhost:5173` in your browser.

---

## Quick Health Check

Run all at once to verify everything is up:
```bash
curl -s http://localhost:3001/health && echo " ← Foreman"
curl -s http://localhost:8065/api/v4/system/ping | grep -o '"status":"[^"]*"' && echo " ← Mattermost"
curl -s http://localhost:8080 > /dev/null && echo "OK ← Redpanda Console"
curl -s http://localhost:7233 > /dev/null && echo "OK ← Temporal"
docker ps --format "{{.Names}} {{.Status}}" | grep foreman
```

---

## If Something Won't Start

### Docker won't connect
```
Cannot connect to the Docker daemon at unix:///Users/chris.shreve/.docker/run/docker.sock
```
Docker Desktop is not running. Open it from Applications first, wait for the whale to stop animating.

### Foreman is unresponsive (hung tool call)
Edit `~/.foreman/sessions.json` and set `sessionId: null` for the affected channel, or use `/cc new` in that Slack channel.

### Port 3001 already in use
```bash
launchctl unload ~/Library/LaunchAgents/com.foreman.bot.plist
lsof -ti :3001 | xargs kill -9
launchctl load ~/Library/LaunchAgents/com.foreman.bot.plist
```

### Full emergency recovery
See `project_foreman_2.md` → Emergency Recovery section.

---

## Stopping Everything

```bash
# Stop Docker services (Redpanda, Postgres, Mattermost)
cd /Users/chris.shreve/claude-slack-bridge
docker compose down

# Stop Foreman
launchctl unload ~/Library/LaunchAgents/com.foreman.bot.plist

# Stop Temporal — Ctrl+C in the terminal running it
```
