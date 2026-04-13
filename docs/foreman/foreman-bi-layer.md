# Foreman BI Layer — Implementation Brief

## What This Is

A business intelligence layer that provides unified observability across the entire Foreman stack — Temporal workflows, Kafka messages, and bot activity — without building a custom dashboard UI from scratch.

Instead of a custom frontend, we pipe structured data from Temporal + Kafka into Postgres tables, then point an existing BI tool (Grafana, Metabase, or Datadog) at it. The result is a fleet dashboard, workflow drill-down, cost analysis, and per-bot metrics with zero frontend code.

---

## Why This Matters

The Foreman stack already has two powerful audit layers:

- **Temporal** records every workflow execution — every step, input, output, retry, and timestamp
- **Kafka** records every message sent to and from every bot via `{bot}.inbox` / `{bot}.outbox` topics

The problem: these two systems don't talk to each other and have separate UIs (`localhost:8233` for Temporal, `localhost:8080` for Redpanda Console). Debugging a failing workflow means jumping between two browser tabs and cross-referencing timestamps by hand.

The BI layer solves this by joining both systems via **correlation ID** into a single queryable data store.

---

## The Data Model

Three Postgres tables capture everything:

### `workflows`
| Column | Type | Description |
|---|---|---|
| `id` | string | Temporal workflow execution ID |
| `name` | string | Workflow type name (e.g. `pythia-v`, `techops-2187`) |
| `start_time` | timestamp | When the workflow started |
| `end_time` | timestamp | When it completed (null if still running) |
| `status` | string | `running`, `completed`, `failed`, `timed_out` |
| `total_cost_usd` | decimal | Sum of all bot token costs |
| `correlation_id` | string | Links to Kafka messages |

### `workflow_steps`
| Column | Type | Description |
|---|---|---|
| `workflow_id` | string | FK to `workflows` |
| `step_number` | int | Order within workflow |
| `bot_name` | string | Which bot handled this step |
| `input_prompt` | text | What was sent to the bot |
| `output_response` | text | What the bot returned |
| `turns` | int | Number of turns to complete (`Done in N turns`) |
| `tokens_in` | int | Input token count (`3 in`) |
| `tokens_out` | int | Output token count (`113 out`) |
| `cost_usd` | decimal | Cost for this step (`$0.3939`) |
| `duration_ms` | int | How long it took (`10s`) |
| `status` | string | `completed`, `failed`, `retried` |

> **Stats footer connection:** Every column above maps directly to the stats footer already displayed in the Foreman UI and Slack: `Done in 4 turns | $0.3939 | 3 in / 113 out | 10s`. Foreman already calculates all of this per response — persisting it to Postgres is just a matter of writing the row at the same time the footer is rendered. Over time this enables: cost per bot, cost per workflow type, token efficiency trends, average response time per bot, and total spend over any time range.

### `bot_messages`
| Column | Type | Description |
|---|---|---|
| `correlation_id` | string | Links to `workflows` |
| `bot_name` | string | Which bot |
| `direction` | string | `in` (inbox) or `out` (outbox) |
| `payload` | jsonb | Full message body |
| `timestamp` | timestamp | When the message was produced |
| `kafka_topic` | string | e.g. `betty.inbox` |
| `kafka_offset` | bigint | Exact offset in the topic |

---

## What You Can Query

Once the data is in Postgres:

```sql
-- Most expensive workflows this week
SELECT name, SUM(total_cost_usd) as cost, COUNT(*) as runs
FROM workflows
WHERE start_time > NOW() - INTERVAL '7 days'
GROUP BY name ORDER BY cost DESC;

-- Failure rate by bot
SELECT bot_name,
  COUNT(*) FILTER (WHERE status = 'failed') as failures,
  COUNT(*) as total
FROM workflow_steps GROUP BY bot_name;

-- What did bot X respond with on July 8th at 8:15PM?
SELECT output_response FROM workflow_steps
WHERE bot_name = 'claude-worker'
  AND start_time BETWEEN '2026-07-08 20:14:00' AND '2026-07-08 20:16:00';

-- Full trace for a specific workflow
SELECT ws.step_number, ws.bot_name, ws.input_prompt, ws.output_response, ws.duration_ms
FROM workflow_steps ws
JOIN workflows w ON ws.workflow_id = w.id
WHERE w.name = 'pythia-v' AND w.start_time::date = '2026-07-08'
ORDER BY ws.step_number;
```

These are **precise, structured queries** — not log grepping.

---

## The Sync Job

A small Node.js job (or Temporal workflow itself) that runs periodically and syncs data from both sources into Postgres.

### From Temporal
Use the Temporal SDK's `WorkflowService`:
```typescript
// List all recent workflow executions
const executions = await client.workflow.list({
  query: `StartTime > "${since}"`,
});

// For each execution, get full event history
const history = await client.workflow.getHandle(workflowId).fetchHistory();
```

### From Kafka
Use KafkaJS to consume from all bot inbox/outbox topics, writing each message to `bot_messages`. Use stored Kafka offsets to avoid re-processing:
```typescript
// Seek to last processed offset per topic
consumer.seek({ topic: 'betty.outbox', partition: 0, offset: lastOffset });
```

The **correlation ID** on every Kafka message is the join key between `bot_messages` and `workflow_steps`.

---

## Recommended BI Tool

| Tool | Recommendation |
|---|---|
| **Datadog** | ✅ Best for MFP — already in the stack, no new tooling to justify, natural extension of TECHOPS-2297 observability work |
| **Metabase** | ✅ Best for quick local setup — self-hosted, free, connects to Postgres, no-code dashboards |
| **Grafana** | ✅ Best for engineering dashboards — open source, beautiful, time-series focused |

For MFP, **Datadog is the strongest choice** since the infra team already uses it. The sync job can ship metrics directly to Datadog via StatsD/DogStatsD alongside the Postgres path.

---

## The "Analyze with Architect" Feature

This is the killer feature on top of the BI layer. Any workflow in the dashboard gets a lightweight action that sends its full context to the Architect:

**What it does:**
1. Takes a workflow ID
2. Fetches the full `workflow_steps` + `bot_messages` for that correlation ID
3. Opens an Architect chat session pre-loaded with the full context
4. Asks: *"Here is a complete workflow execution. What happened, did anything go wrong, and how could it be improved?"*

**What the Architect can do with it:**

- **Root cause analysis**: "Workflow failed at step 4. Bot B returned malformed JSON at step 3. Fix: add output validation to Bot B's system prompt."
- **Improvement suggestions**: "Step 3 always takes 45 seconds and produces verbose output that step 4 only uses 10% of. Rewrite step 3's prompt to be more targeted."
- **Self-healing**: "This workflow is stuck at step 2. I'll signal the Temporal workflow to resume from step 2 directly."

The Architect already has the tools to do all of this — it can read Kafka topics, query Temporal, modify system prompts, and signal workflows.

> *The workflow history isn't just an audit log — it's training data for the system to improve itself. Every failed workflow is a case study. Every slow workflow is an optimization opportunity.*

---

## Implementation Plan

### Step 1 — Schema
Create the three Postgres tables above. Postgres is already running in Docker (`localhost:5432`).

### Step 2 — Sync Job
Write `src/bi-sync.ts`:
- Reads from Temporal SDK (workflow list + event histories)
- Reads from Kafka (all bot inbox/outbox topics, offset-tracked)
- Upserts into Postgres tables
- Run on a cron (every 1-5 minutes) or as a Temporal workflow itself

### Step 3 — BI Tool
- **Metabase** (fastest to start): `docker compose` addition, point at Postgres, build dashboards in the UI
- **Datadog** (best for MFP): extend the sync job to also ship metrics via DogStatsD

### Step 4 — Analyze with Architect
Add a `/api/bi/analyze/:workflowId` endpoint in `src/ui-api.ts` that:
1. Fetches full workflow context from Postgres
2. Opens a WebSocket Architect session with it pre-loaded

---

## Files to Create/Modify

| File | Change |
|---|---|
| `src/bi-sync.ts` | New — Temporal + Kafka → Postgres sync job |
| `src/bi-schema.sql` | New — CREATE TABLE statements |
| `src/ui-api.ts` | Add `GET /api/bi/workflows`, `GET /api/bi/workflows/:id`, `POST /api/bi/analyze/:id` |
| `docker-compose.yml` | Add Metabase service (optional) |
| `src/index.ts` | Start bi-sync job on startup |

---

## Related Docs

- `docs/managed-agents-comparison.md` — business case framing, how this compares to AgentCore/Managed Agents
- `docs/memory/project_foreman_2.md` — Phase 6 task list entry
- `docs/session-handoff.md` — current session state
