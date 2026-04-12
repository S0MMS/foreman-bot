# Managed Agent Platforms — Comparison & Business Case Notes

*Last updated: 2026-04-09*

---

## The Three Options

When evaluating managed agent infrastructure, there are now three contenders:

1. **AWS AgentCore** — managed agent deployment on AWS infrastructure
2. **Anthropic Claude Managed Agents** — managed agent runtime from Anthropic (launched April 8, 2026)
3. **Foreman/FlowSpec/Temporal/Kafka** — custom-built stack, self-hosted

---

## Claude Managed Agents — Overview

Launched April 8, 2026 (public beta). Anthropic's answer to "who runs your agent infrastructure?"

### Core Architecture — "Brain vs. Hands"

Three components:

- **The Brain** — Claude model + controller logic. Stateless container, spins up on demand.
- **The Hands** — Sandboxed ephemeral execution environment (bash, Python REPL). Zero access to long-lived credentials. Communicates with Brain via MCP only — tokens never enter the sandbox.
- **The Session** — Persistent append-only event log (external memory). Every thought, tool call, and observation recorded. A new Brain container can reconstruct full context at any point.

This solves the same durability problem Temporal solves in the Foreman stack — stateful long-running work across stateless compute.

### Key Capabilities

| Feature | Details |
|---|---|
| Long-running sessions | Agents run for hours; progress saved across disconnections |
| Sandboxed execution | Bash, Python REPL in isolated environments |
| Scoped permissions | Credentials never touch the sandbox |
| Checkpointing | Resume from any point in the session log |
| Multi-agent coordination | Research preview |
| Agent Skills | Reusable instruction modules — pre-built for Word, Excel, PowerPoint, PDF; custom Skills supported |
| MCP tool layer | All tool calls go through MCP |
| Audit trail | Full session event log — every prompt, tool call, and response recorded |

### Pricing
- Standard Claude API token pricing
- **+$0.08/session-hour** for active runtime
- **+$10/1,000 web searches**

### Early Customers
Notion, Rakuten, Asana.

---

## Head-to-Head Comparison

| Dimension | AWS AgentCore | Claude Managed Agents | Foreman/FlowSpec |
|---|---|---|---|
| **Vendor** | AWS | Anthropic | You |
| **Model flexibility** | Bedrock (multi-model) | Claude only | Any model ✅ |
| **Workflow DSL** | None | None (Skills only) | FlowSpec ✅ |
| **Audit trail** | CloudWatch | Session event log ✅ | Temporal history + Kafka topics ✅✅ |
| **Workflow durability** | DIY | Built-in (checkpointing) | Temporal ✅ |
| **Custom tool integrations** | Lambda | MCP | Already built (Jira, Slack, Mattermost, Bitrise) ✅ |
| **Vendor lock-in** | AWS | Anthropic + Claude | None ✅ |
| **Ops burden** | None ✅ | None ✅ | You own it |
| **Compliance certs** | SOC2, HIPAA, FedRAMP ✅ | TBD (new) | None |
| **Maturity** | Medium (newer) | New (April 2026) | Temporal/Kafka battle-hardened |
| **Cost at small scale** | Per-invocation adds up | Per-invocation adds up | Cheap (self-hosted) |
| **Cost at large scale** | Predictable but significant | Predictable but significant | Infra + eng maintenance |
| **Time to value** | Fast for standard patterns | Fast for standard patterns | Already built |

---

## Key Differentiators

**Why Foreman/FlowSpec is hard to replace:**
- FlowSpec has no equivalent in either managed service — no declarative multi-bot workflow DSL exists in AgentCore or Claude Managed Agents
- Already integrated with your specific tools (Jira, Confluence, Bitrise, Slack, Mattermost) — you'd rebuild all of this on either platform
- Temporal is more mature and battle-tested than anything AgentCore or Managed Agents offers for workflow orchestration
- **Kafka is a living audit trail** — every message sent to and from every bot flows through Kafka topics (`{bot}.inbox` / `{bot}.outbox`). This gives you a complete, real-time, replayable record of every prompt and response across every bot in every workflow. Combined with Temporal's event history (which captures every workflow step with inputs/outputs), the audit coverage is end-to-end with no gaps. Neither AgentCore nor Managed Agents provides this level of cross-agent observability out of the box.
- **Precise point-in-time querying** — the combination of Temporal + Kafka + correlation IDs makes it possible to answer exact questions like: *"This workflow that started on Wednesday July 8th 2026 at 8:15PM — what was the exact response from bot X at step 3?"* Temporal locates the workflow execution by timestamp and gives you the step; Kafka's offset-by-timestamp seek gives you the exact message from that bot's outbox at that moment. The correlation ID ties both systems together. This is not a log grep — it's a precise, structured query across the full workflow history.

### Workflow-Level vs. Agent-Level Observability

This is the core insight for the business case. Tools like Datadog (and AgentCore's CloudWatch integration) provide **agent-level** telemetry — they tell you that an individual agent is healthy, how many tokens it consumed, and what its error rate is. That's necessary but not sufficient for multi-agent systems.

What Temporal + Kafka adds is **workflow-level** observability:

| Question | Agent-level (Datadog/CloudWatch) | Workflow-level (Temporal + Kafka) |
|---|---|---|
| "Is this agent healthy?" | ✅ | ✅ |
| "Where is this workflow right now?" | ❌ | ✅ |
| "Why did step 4 fail?" | ❌ (you see the failure, not the cause) | ✅ (Kafka outbox shows what step 3 returned) |
| "Can I resume from the failure point?" | ❌ (restart from scratch) | ✅ (Temporal replay from step 4) |
| "What did bot X respond with on July 8th at 8:15PM?" | ❌ | ✅ (Kafka offset seek + Temporal event history) |
| "How much did this specific business outcome cost?" | ❌ (cost per agent, not per outcome) | ✅ (correlation ID ties all agent costs to one workflow) |

> **The key framing:** Datadog tells you your agents are healthy. Temporal + Kafka tells you your *workflows* are healthy — and lets you fix them without starting over.

### AI-Assisted Workflow Intelligence

This is the most powerful capability in the stack — and one that neither AgentCore nor Managed Agents can match.

Because the entire workflow history is structured, queryable, and machine-readable (not just a human audit log), an AI agent like the Foreman Architect can be pointed at it to **reason about the system itself**:

**Root cause analysis**
> "Workflow Foobar failed at step 4. I'll read the Kafka outbox for the step 3 bot... it returned malformed JSON. That's why step 4 threw a parse error. Fix: add output validation to Agent B's system prompt."

The Architect isn't guessing — it's reading the actual messages and reasoning about what went wrong.

**Workflow improvement**
> "Looking at the last 20 runs of Foobar — step 3 always takes 45 seconds and produces verbose output that step 4 only uses 10% of. Rewriting step 3's prompt to be more targeted would cut latency and token cost significantly."

**Self-healing**
> "This workflow is stuck. Step 2 is waiting for a response that never came. I'll resume it from step 2 by signaling the Temporal workflow directly."

The Architect already has the tools to do all of this — it can read Kafka topics, query Temporal, modify system prompts, and signal workflows. The message bus being fully inspectable makes the entire system **workable by external AI agents**, not just human operators.

> *The workflow history isn't just an audit log — it's training data for the system to improve itself. Every failed workflow is a case study. Every slow workflow is an optimization opportunity.*

### AgentCore's Closest Equivalent

To be fair, AWS has thought about this problem. But the honest answer is you'd have to build it yourself on top of AgentCore — nothing is native:

- **Amazon Q Developer** — AWS's AI assistant can query CloudWatch logs and X-Ray traces using natural language. In theory: *"Why did this workflow fail yesterday?"* and Q queries CloudWatch on your behalf. This is the closest analog — but it's querying text logs after the fact, not reasoning about a structured event history.
- **AWS X-Ray** — distributed tracing across Lambda functions/agents, giving you a timeline and service map. A meta-agent with X-Ray API access could reason about a trace — but you have to instrument everything yourself and explicitly propagate trace IDs across every agent boundary.
- **Bedrock Agent + CloudWatch tools** — you could build a supervisor agent in Bedrock that has CloudWatch Logs Insights and X-Ray APIs as tools. Functionally similar in concept — but weeks of engineering work, not something you get out of the box.

**The fundamental gap is architectural, not just a feature gap:**

| | AgentCore / CloudWatch | Foreman / Kafka |
|---|---|---|
| Storage model | Log sink — write once, query by text search | Message bus — append-only, offset-seekable by timestamp |
| Designed for | Human operators reading logs | Machine consumption and replay |
| Replay | ❌ Not a concept | ✅ First-class — seek to any offset |
| Structured payload | ❌ Text strings | ✅ Full JSON message bodies |
| Cross-agent correlation | Manual — you add trace IDs | Built-in — correlation ID on every message |
| AI queryable | Possible but you build it | Built-in — Kafka is already a machine-readable API |

> CloudWatch is a log drain. Kafka is a message bus. Logs are for humans to read. A message bus is designed for programs — including AI agents — to consume, replay, and reason about. That's not a gap you can close with tooling. It's an architectural difference.

**Why Claude Managed Agents beats AgentCore:**
- Brain/Hands/Session architecture is purpose-built for agents; AgentCore feels bolted onto existing AWS infrastructure
- Session event log is a cleaner audit story than CloudWatch patchwork
- If you're using Claude anyway, staying in the Anthropic ecosystem reduces friction

**Why either managed service wins on compliance:**
- AWS AgentCore: SOC2, HIPAA, FedRAMP already certified
- Claude Managed Agents: newer, certs TBD — but Anthropic will need these for enterprise
- Foreman: you'd have to certify your own infrastructure, which is expensive and slow

---

## The Non-Exclusive Angle

These aren't necessarily competing systems. A hybrid is viable:

- **Foreman/FlowSpec** handles workflow orchestration and tool routing (what it's good at)
- **Claude Managed Agents** or **AgentCore** handles individual agent runtimes (compute, sandboxing, scaling)
- Temporal + Kafka stay as the durable backbone

You'd get AWS/Anthropic compliance and scaling with your own workflow logic and integrations intact.

---

## Decision Framework

| Primary driver | Best choice |
|---|---|
| Compliance (HIPAA/SOC2) | AWS AgentCore (certs exist now) |
| Staying in Claude ecosystem | Claude Managed Agents |
| Model flexibility (non-Claude bots) | Foreman or AgentCore |
| Custom tool integrations already built | Foreman (don't rebuild) |
| No ops team to maintain infra | AgentCore or Managed Agents |
| Complex multi-bot workflow DSL | Foreman/FlowSpec (nothing else has this) |

---

## Sources

- [The New Stack — Anthropic wants to run your AI agents for you](https://thenewstack.io/with-claude-managed-agents-anthropic-wants-to-run-your-ai-agents-for-you/)
- [SiliconANGLE — Anthropic launches Claude Managed Agents](https://siliconangle.com/2026/04/08/anthropic-launches-claude-managed-agents-speed-ai-agent-development/)
- [Anthropic Engineering — Decoupling the Brain and the Hands](https://www.anthropic.com/engineering/managed-agents)
- [TechRadar — 10x faster agent building](https://www.techradar.com/pro/go-from-prototype-to-launch-in-days-rather-than-months-anthropic-reveals-claude-managed-agents-promises-to-make-agent-building-10x-faster)
- [Claude API Docs — Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [9to5Mac — Claude Cowork and Managed Agents](https://9to5mac.com/2026/04/09/anthropic-scales-up-with-enterprise-features-for-claude-cowork-and-managed-agents/)
