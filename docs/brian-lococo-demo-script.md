# Brian Lococo Meeting — AgentCore Observability POC
**Date:** April 13, 2026 | **Goal:** Make Brian successful with AgentCore observability

---

## 1. Open: The Problem (2 min)

Agents are going to production (TECHOPS-2295–2298). Once they're there, leadership will ask:

- "How much did that cost?"
- "Why did it fail?"
- "Where is this workflow right now?"

**Agent-level telemetry (TECHOPS-2297) answers the first question. The other two require workflow-level observability.** That's the gap.

---

## 2. The Six Gaps (5 min)

Walk through these — each one is a question nobody can answer today:

| Gap | The Question |
|---|---|
| **Workflow state** | "Where is this multi-agent workflow, and is it making progress?" |
| **Cross-agent tracing** | "Show me everything that happened for this one request, across every agent." |
| **Failure isolation** | "It failed at step 4. Can we resume from step 4 instead of restarting?" |
| **Cost attribution** | "How much does an AI-assisted code review cost? Is it worth it?" |
| **Handoff quality** | "Agent B failed — was it because Agent A gave it bad input?" |
| **Backpressure** | "We have 12 agents queued and throughput is 3/min. When do we hit the wall?" |

**Key point for Brian:** These aren't hypothetical. The four TECHOPS tickets already describe a system where agents take Slack input, access GitHub, and run deployment pipelines. That's a multi-agent workflow system. Designing for this now is 10x cheaper than retrofitting later.

---

## 3. The Data Model (5 min)

Three tables solve it. Vendor-agnostic — works for AgentCore, Foreman, or anything else.

**`workflows`** — one row per workflow execution
- id, name, start/end time, status, total_cost_usd, correlation_id

**`workflow_steps`** — one row per agent invocation within a workflow
- bot_name, input prompt, output response, tokens_in, tokens_out, cost_usd, duration_ms, status

**`bot_messages`** — raw message log (Kafka or any message bus)
- correlation_id (the join key), bot_name, direction, payload, timestamp

**The correlation_id is the magic.** It links a business request -> workflow -> individual agent steps -> raw messages. One ID traces everything.

---

## 4. What You Can Query (3 min)

Once data is in Postgres/Datadog, these become one-liners:

- **Most expensive workflows this week** — `GROUP BY name ORDER BY cost DESC`
- **Failure rate by agent** — `COUNT(*) FILTER (WHERE status = 'failed')`
- **Full trace for a specific run** — `JOIN workflow_steps ON workflow_id`
- **What did agent X say at 8:15 PM?** — exact replay, not log grepping

---

## 5. Live Demo: Foreman (5 min)

Show a working multi-bot interaction (Council or Delphi flow):

1. Send a prompt that hits multiple bots
2. Point out the stats footer on each response: turns, cost, tokens in/out, duration
3. Show that every field in the stats footer maps 1:1 to a column in `workflow_steps`
4. **Key message:** "We already calculate all of this per response. Persisting it to Postgres is just writing the row at the same time the footer renders."

---

## 6. The Datadog Connection (2 min)

- MFP already uses Datadog — no new tooling to justify
- TECHOPS-2305 (FiveTran -> Datadog) is already setting up the pipeline
- The sync job can ship metrics via DogStatsD alongside the Postgres path
- Brian can piggyback on existing Datadog infra

---

## 7. Close: Next Steps for Brian

Offer these as concrete takeaways:

1. **Expand TECHOPS-2297** to include workflow-level observability (or create a companion ticket)
2. **Add correlation_id to AgentCore agent invocations now** — it's one field, costs nothing, and makes everything else possible later
3. **Reuse the three-table data model** — it's vendor-agnostic and ready to go
4. **The Foreman BI layer doc** (`docs/foreman/foreman-bi-layer.md`) has the full implementation plan, SQL queries, and sync job design — Brian can reference it directly

---

## Tone Reminders

- This is about Brian's success, not Foreman's features
- Position yourself as "I've already solved this — here's what I learned"
- Let Brian own the AgentCore implementation; offer the patterns, not the code
- If Brian asks "can we just use Foreman?" — that's a win, but let him get there
