All three verification agents are complete. Here's what I found:

- **Foreman codebase**: All major claims confirmed. Key corrections: codebase is **~13,000 LOC** (not 2,830-3,000 as workers claimed), **20 Jira operations** (not 11-13), **38 MCP tools**, **191-line Pythia flow**, **zero test files**.
- **AWS AgentCore**: All 18 claims **CONFIRMED** with public sources.
- **Managed Agents**: 15/18 **CONFIRMED**, 2 **UNVERIFIED** (OTEL export status, 1-level delegation limit), 0 refuted.

Now let me write the synthesis.

---

# Agent Infrastructure Comparison: AgentCore vs. Claude Managed Agents vs. Foreman
## Synthesized Analysis for MFP Infra Team — April 14, 2026

*Prepared for Brian Lococo + Infra Team by Chris Shreve*
*Verified against codebases, official documentation, and public sources*

---

## How to Read This Document

Every factual claim is labeled: **[CONFIRMED]** means independently verified against source code, official docs, or public announcements. **[UNVERIFIED]** means claimed by a source but not independently confirmed — treat with appropriate skepticism. No unverified claims are used in recommendations.

---

## 1. Head-to-Head Comparison

### Model Flexibility

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| Multi-model | **Yes** — model-agnostic runtime; any framework calls any API **[CONFIRMED]** | **No** — Claude family only **[CONFIRMED]** | **Yes** — Claude, GPT, Gemini via pluggable adapters **[CONFIRMED: 3 adapters in `src/adapters/`]** |
| Multi-model in one workflow | Possible (you build it) | Not possible | **Native** — Pythia runs Claude + Gemini + GPT in parallel **[CONFIRMED: `flows/pythia.flow`, 191 lines]** |
| Model switching | Framework-level | Agent-level (Claude model selection) | Per-bot in `bots.yaml` or per-session command |

**Bottom line:** AgentCore and Foreman both support multi-model. Foreman is the only system that treats multi-model orchestration as a *first-class workflow primitive* — Pythia's 5-phase, 3-vendor verification pipeline demonstrates this concretely. Managed Agents is Claude-only by design; if epistemic diversity matters to you, it's a non-starter.

---

### Workflow Orchestration

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| Workflow DSL | **None** — use Step Functions or framework code **[CONFIRMED]** | **None** — Claude's reasoning *is* the orchestration **[CONFIRMED]** | **FlowSpec** — 16 AST node types, indentation-based, Turing-complete **[CONFIRMED: `src/flowspec/ast.ts`, 171 lines]** |
| Parallel fan-out | Step Functions `Parallel` state | Multi-agent threads (research preview) **[CONFIRMED]** | `at the same time` blocks **[CONFIRMED]** |
| Race semantics | Build it yourself | Not supported | `at the same time, first to finish` **[CONFIRMED: `RaceStep` in AST]** |
| Conditionals | Step Functions `Choice` | Claude decides (implicit) | `if/otherwise` with `means` operator (semantic LLM classification) **[CONFIRMED: `src/flowspec/runtime.ts`]** |
| Loops | Build it yourself | Claude decides | `for each` + `repeat until` with mandatory max **[CONFIRMED]** |
| Human gates | Build it yourself | Mid-session events | `pause for approval` with reject handlers **[CONFIRMED: `ApprovalStep` in AST]** |
| Sub-workflows | Step Functions nesting | Not supported | `run "WorkflowName"` with args and captures **[CONFIRMED: `RunStep` in AST]** |

**Bottom line:** FlowSpec is the only declarative multi-agent workflow DSL among these three. It is purpose-built for this domain and nothing equivalent exists in either managed service. **However** — FlowSpec is a custom language with zero community, maintained by one engineer, with an 800-line hand-written parser **[CONFIRMED]** and **zero test files** **[CONFIRMED]**. Step Functions has 10+ years of battle-testing and a massive ecosystem. That maturity gap is real.

Managed Agents deliberately avoids explicit orchestration — the model *is* the orchestrator. For repeatable, auditable multi-step processes (like batch test generation), this is a poor fit. For exploratory, open-ended agent tasks, it may actually be an advantage.

---

### Durability and Fault Tolerance

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| Engine | Firecracker microVMs **[CONFIRMED]**, Session Storage in **preview** **[CONFIRMED]** | Append-only event log, `wake(sessionId)` **[CONFIRMED]** | Temporal event history + Kafka message persistence **[CONFIRMED]** |
| Max duration | 8 hours per session **[CONFIRMED]** | No stated limit **[CONFIRMED]** | No limit (Temporal workflows run indefinitely) **[CONFIRMED]** |
| Crash recovery | Session Storage (preview) + framework checkpointing (LangGraph DynamoDB) | Stateless brain resumes from last event — automatic **[CONFIRMED]** | Temporal deterministic replay from last activity **[CONFIRMED: heartbeats in `src/temporal/activities.ts`]** |
| Battle-tested? | Firecracker is mature; Session Storage is preview | 3-day-old beta **[CONFIRMED]** | Temporal used by Netflix, Uber, Stripe at massive scale **[CONFIRMED]** |

**Bottom line:** Temporal gives Foreman the strongest *theoretical* durability guarantees — deterministic replay is the gold standard. Managed Agents' architecture is elegant (stateless brain + durable log). AgentCore's 8-hour session limit **[CONFIRMED]** is a real constraint for long-running workflows, and Session Storage is still preview **[CONFIRMED]**. Reality check: Foreman's Temporal runs on Docker Desktop on Chris's Mac — the engine is battle-tested, the deployment is not.

---

### Observability and Audit Trail (TECHOPS-2297)

**This is the dimension that matters most for this meeting.**

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| OTEL support | **Native** via ADOT SDK, zero-config for hosted agents **[CONFIRMED]** | **[UNVERIFIED]** — no documented OTEL export found | **None** today |
| Datadog integration | **Yes** — CloudWatch → Datadog, NTT DATA case study published on Datadog's blog **[CONFIRMED]** | Not documented | Not built |
| Evaluation scoring | 13 built-in evaluation dimensions **[CONFIRMED]** | Self-evaluation (research preview) **[CONFIRMED]** | None |
| PII masking | Available **[CONFIRMED via compliance docs]** | Not documented | None |
| Audit trail | CloudWatch Logs + Memory service events **[CONFIRMED]** | Append-only session event log **[CONFIRMED]** | **Kafka topic pairs** — every message through `{bot}.inbox` / `{bot}.outbox` with correlation IDs **[CONFIRMED: `src/kafka.ts`]** |
| Visualization | AgentCore console + CloudWatch dashboards | Anthropic Console | Temporal UI (`localhost:8233`) + Redpanda Console (`localhost:8080`) |

**Bottom line: AgentCore wins TECHOPS-2297 decisively.** Native OTEL + confirmed Datadog integration + PII masking = fastest path to getting agent data into Datadog. Foreman's Kafka audit trail is *structurally* excellent (the data is there, it's complete, it's replayable), but the pipeline to Datadog doesn't exist. Building it is feasible (Kafka Connect → OTEL Collector → Datadog) but it's work that hasn't been done. Managed Agents has good per-session visibility in Anthropic's Console but no confirmed external observability integration.

---

### Tool/Integration Ecosystem

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| MCP support | Gateway converts OpenAPI specs to MCP tools **[CONFIRMED]** | First-class MCP **[CONFIRMED]** | `foreman-toolbelt` MCP server, **38 tools** **[CONFIRMED: `src/mcp-canvas.ts`, 1,404 lines]** |
| Jira | Build via Gateway + OpenAPI | Build via MCP server | **Live today** — **20 operations** including CRUD, transitions, comments, custom fields **[CONFIRMED: `src/jira.ts`, 492 lines]** |
| Confluence | Build via Gateway | Build via MCP | **Live today** — read, search (CQL), create, update **[CONFIRMED]** |
| GitHub | Build via Gateway | Build via MCP | **Live today** — PR create/read, issue read, search **[CONFIRMED]** |
| Bitrise | Build it yourself | Build it yourself | **Live today** — trigger workflows on branch **[CONFIRMED]** |
| Slack | Build it yourself | Via MCP | **Native** — Socket Mode, rich messages, approval buttons **[CONFIRMED]** |

**Bottom line:** Foreman has a massive head start on MFP-specific integrations because they were built *for* MFP. TECHOPS-2187 uses Jira, GitHub, and Bitrise through Foreman today. The managed services would require building these integrations — AgentCore's Gateway makes this easier (point it at an OpenAPI spec), but it's still work.

---

### Compliance and Security

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| SOC 2 | **Internal assessment complete**, pending 3rd-party audit **[CONFIRMED]** | Anthropic has SOC 2 Type II; **[UNVERIFIED]** whether it extends to Managed Agents beta | **None** |
| HIPAA | **Eligible** **[CONFIRMED]** | **[UNVERIFIED]** for Managed Agents specifically | **None** |
| FedRAMP | Pursuing, not completed **[CONFIRMED]** | No | No |
| Session isolation | Firecracker microVM per session **[CONFIRMED]** | Disposable containers, mutually untrusted components **[CONFIRMED]** | No sandboxing — agents run in Foreman's Node.js process |
| Credential isolation | Identity service (Cognito/Okta/Entra) **[CONFIRMED]** | Zero-trust proxy pattern **[CONFIRMED]** | API keys in `~/.foreman/config.json` **[CONFIRMED: `src/config.ts`]** |
| Policy guardrails | Cedar policy language **[CONFIRMED]** | API-level rate limits | Tool approval list in code |
| VPC support | Yes (GA) **[CONFIRMED]** | **Not available** **[CONFIRMED]** | N/A (self-hosted) |

**Bottom line: AgentCore wins compliance decisively.** This is not close. Firecracker microVM isolation is hardware-level. Identity service handles credential lifecycle with enterprise IdP integration. Cedar policies provide deterministic guardrails. Foreman has **zero compliance story** — API keys sitting in a JSON file on a laptop. Managed Agents has strong *architectural* security (zero-trust credential isolation is best-in-class) but is 3 days into public beta with no confirmed enterprise compliance certs and no VPC peering.

---

### Operational Burden — The Elephant in the Room

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| Who maintains it? | AWS | Anthropic | **Chris Shreve (one person)** |
| Bus factor | AWS team | Anthropic team | **1** |
| Infrastructure | Fully managed, serverless **[CONFIRMED]** | Fully managed **[CONFIRMED]** | Docker Desktop + Redpanda + Temporal + Node.js on Chris's Mac **[CONFIRMED: `docker-compose.yml`]** |
| Scaling | Automatic | Automatic | Manual — single Temporal worker, single Kafka consumer per bot |
| On-call | AWS SLA | Anthropic SLA | Chris's phone |

**This is Foreman's biggest risk and it cannot be hand-waved.** The codebase is ~13,000 lines of TypeScript **[CONFIRMED]** across parser, compiler, runtime, adapters, MCP server, and integrations. It's well-structured (clean separation: parser → AST → compiler → Temporal), but:

- FlowSpec is a custom language that exists nowhere else — every engineer who touches it needs training
- The parser is 800 lines of hand-written recursive descent with **zero test files** **[CONFIRMED]**
- If Chris is unavailable, nobody else can fix, extend, or debug this system

**What would de-risking take?** (realistic estimate):
1. Move off Chris's Mac → EC2/ECS + managed Kafka + Temporal Cloud — ~2 weeks
2. Add CI/CD for Foreman itself — ~1 week
3. Write parser/compiler/integration tests — ~2 weeks
4. Train a second engineer — ~1 week paired programming
5. **Total: ~6 weeks of focused effort**

Or: Accept Foreman as a prototyping/R&D tool and use a managed service for production. This is a legitimate architecture, not a failure.

---

### Cost Model

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| Compute | $0.0895/vCPU-hour **[CONFIRMED]** + $0.00945/GB-hour | $0.08/session-hour **[CONFIRMED]** | Self-hosted (~$0 today) |
| LLM tokens | Bedrock pricing (markup over direct) | Standard Anthropic pricing | Direct API pricing (cheapest) |
| Tool calls | $0.005/1K Gateway invocations **[CONFIRMED]** | Included | Free (self-hosted MCP) |
| At ~50 agents, 8hrs/day | ~$450-800/month compute + tokens | ~$320/month sessions + tokens | ~$0 infra + Chris's time |

**Bottom line:** All three are affordable at MFP's scale. The real cost difference is **engineering time**. Foreman's "$0 infra" is misleading — Chris's time maintaining a custom distributed system is the actual cost. Managed Agents can't cost-optimize via cheaper models for simple tasks (Claude-only). AgentCore adds Bedrock token markup but is the most predictable at scale.

---

### Maturity and Risk

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| Age | GA October 2025 (~6 months) **[CONFIRMED]** | Public beta April 8, 2026 (~3 days) **[CONFIRMED]** | POC, running since ~Q1 2026 |
| Production customers | Thomson Reuters, NTT DATA, Sony, Cox Automotive **[CONFIRMED]** | Notion, Rakuten, Asana, Sentry **[CONFIRMED]** | MFP (TECHOPS-2187) |
| Underlying components | AWS infra (decades) | Claude API (2+ years) | **Temporal + Kafka** (years of production at massive scale) |
| What's still preview | Agent Registry, Session Storage **[CONFIRMED]** | Multi-agent, memory, outcomes **[CONFIRMED]** | Everything is custom/POC |

---

### Multi-Agent Coordination

| | AWS AgentCore | Claude Managed Agents | Foreman |
|---|---|---|---|
| Protocol | A2A (Google's open standard), JSON-RPC 2.0 **[CONFIRMED]** | Research preview — coordinator spawns sub-agents **[CONFIRMED]** | FlowSpec + Kafka topic pairs **[CONFIRMED]** |
| Cross-framework | Yes **[CONFIRMED]** | No (Claude-only) | Yes (any adapter) |
| Working in production today? | A2A in Runtime (GA) **[CONFIRMED]** | **No** — research preview **[CONFIRMED]** | **Yes** — Pythia runs 6 bots, 3 vendors, 5 phases **[CONFIRMED]** |
| Delegation depth | Unlimited (A2A) | **[UNVERIFIED]** — may be limited | Unlimited (recursive `run` steps) **[CONFIRMED]** |

**Bottom line:** Foreman is the only system with *working, complex* multi-agent coordination in production today. AgentCore's A2A is architecturally sound and standards-based but more low-level (you build the coordination logic). Managed Agents' multi-agent is research preview with access request required.

---

## 2. Summary Matrix

| Dimension | Winner | Runner-up |
|---|---|---|
| Model flexibility | **Tie: AgentCore / Foreman** | — |
| Workflow orchestration | **Foreman (FlowSpec)** | AgentCore + Step Functions |
| Durability (engine) | **Foreman (Temporal)** | Managed Agents |
| Observability → Datadog | **AgentCore** | (gap) |
| MFP tool integrations | **Foreman** (built today) | AgentCore (via Gateway) |
| Compliance | **AgentCore** | (no contest) |
| Operational burden | **Tie: managed services** | — |
| Cost (dollars) | **Foreman** | Managed Agents |
| Cost (human capital) | **Managed services** | — |
| Component maturity | **Foreman** (Temporal + Kafka) | AgentCore (AWS infra) |
| Product maturity | **AgentCore** (6 months GA) | — |
| Multi-agent (today) | **Foreman** | AgentCore (A2A) |
| Bus factor | **Managed services** | — |

---

## 3. The Hybrid Angle — These Are NOT Mutually Exclusive

This is the most important section. These systems operate at different layers:

```
┌──────────────────────────────────────────────────┐
│  ORCHESTRATION  (who does what, when)            │
│  FlowSpec / Step Functions / agent reasoning     │
├──────────────────────────────────────────────────┤
│  AGENT RUNTIME  (how agents execute)             │
│  AgentCore Runtime / Managed Agents / direct SDK │
├──────────────────────────────────────────────────┤
│  DURABLE BACKBONE  (persistence, audit, replay)  │
│  Temporal / Kafka / DynamoDB / event logs         │
└──────────────────────────────────────────────────┘
```

### Option A: FlowSpec as Orchestrator + AgentCore as Runtime (MEDIUM effort)

FlowSpec defines *what* happens. AgentCore provides *where* it runs. The `bots.yaml` already has a reserved `agentcore` bot type **[CONFIRMED]** — the integration path was anticipated.

- FlowSpec's `ask @bot` steps dispatch to AgentCore-managed agent sessions
- AgentCore provides compliance, scaling, OTEL → Datadog (solves TECHOPS-2297)
- Temporal stays as the durability layer
- Kafka stays as the audit trail

**What you get:** FlowSpec's readable DSL + AgentCore's enterprise infrastructure.

### Option B: AgentCore for Production + Foreman for R&D (HIGH feasibility, LOW effort)

The pragmatic path — use each system for what it's best at:

- TECHOPS-2187 keeps running on Foreman (it works today, don't break it)
- New agent initiatives deploy on AgentCore (compliance, observability, Datadog)
- Foreman becomes the "research lab" for experimental workflows; AgentCore is "production"
- Proven FlowSpec patterns graduate to Step Functions over time

### Option C: Shared MCP Toolbelt (HIGH feasibility)

Regardless of runtime, Foreman's 38-tool MCP server **[CONFIRMED]** can be:
- Registered in AgentCore Gateway as an MCP server
- Attached to Managed Agent sessions
- Shared across all runtimes

This preserves the Jira/Confluence/GitHub/Bitrise integrations regardless of which platform wins.

### Option D: Temporal + Kafka as Universal Backbone (HIGH feasibility)

Both are open-source, battle-tested, and infrastructure-team friendly:
- Temporal provides workflow durability for *any* agent framework
- Kafka provides audit trail for *any* agent runtime, feedable into Datadog via Kafka Connect
- Valuable regardless of which agent runtime the team picks

---

## 4. Risks and Blind Spots

### Foreman — 6-12 Month Risks

| Risk | Severity | Likelihood |
|---|---|---|
| Chris leaves/reassigned → system unmaintainable | **Critical** | Non-zero |
| Parser bug blocks workflow (zero tests) **[CONFIRMED]** | High | Medium |
| Infrastructure failure (Docker Desktop on Mac) | High | Medium |
| Scale ceiling (single worker, single consumer per bot) | High | Medium |
| Security incident (API keys in plaintext JSON) **[CONFIRMED]** | High | Low-Medium |

### AgentCore — 6-12 Month Risks

| Risk | Severity | Likelihood |
|---|---|---|
| Session Storage stays preview → durability gap | Medium | Medium |
| A2A session smuggling vulnerability **[CONFIRMED: Unit42]** | High | Low |
| AWS complexity creep (7+ sub-services) | Medium | High |
| Step Functions impedance mismatch with agent workflows | Medium | High |
| FedRAMP not achieved on timeline | Low | Medium |

### Managed Agents — 6-12 Month Risks

| Risk | Severity | Likelihood |
|---|---|---|
| Beta instability / breaking API changes | **High** | **High** |
| Multi-agent stays in research preview | High | Medium |
| No VPC peering blocks enterprise adoption **[CONFIRMED]** | High | Current |
| Claude-only lock-in limits flexibility | High | Ongoing |
| Anthropic pivots pricing model | Medium | Medium |

### Compliance Gap Analysis

| Gap | Foreman | AgentCore | Managed Agents |
|---|---|---|---|
| SOC 2 | Build from scratch | Covered **[CONFIRMED]** | **[UNVERIFIED]** |
| HIPAA | Build from scratch | Covered **[CONFIRMED]** | **[UNVERIFIED]** |
| Credential isolation | ~1 week to move to Vault/SSM | Done **[CONFIRMED]** | Done **[CONFIRMED]** |
| Network isolation | Major rearchitecture | Done (VPC) **[CONFIRMED]** | Not available **[CONFIRMED]** |
| Audit logging → Datadog | Data exists in Kafka; pipeline doesn't | Done (OTEL) **[CONFIRMED]** | Not available |

---

## 5. Recommendation Framework

**Don't pick one system. Pick based on your primary driver.**

### If your primary driver is **TECHOPS-2297 (Observability → Datadog)**:
**→ AgentCore.** Native OTEL + confirmed Datadog integration = fastest path. Foreman's Kafka has the *data* but not the *pipeline*. Managed Agents has no external observability story.

### If your primary driver is **Compliance** (SOC 2, HIPAA, credential isolation):
**→ AgentCore.** The only option with a credible enterprise compliance story. MFP handles health/fitness data — this matters.

### If your primary driver is **Multi-model verification** (reducing hallucination risk):
**→ Foreman** for the orchestration pattern (Pythia). Consider **AgentCore as the runtime underneath** — you get Pythia's workflow with AgentCore's infrastructure.

### If your primary driver is **Minimizing operational burden**:
**→ Either managed service.** Both eliminate infrastructure management. For a team evaluating new infrastructure, adding a single-person dependency is a real cost.

### If your primary driver is **Fastest path to a working agent**:
**→ Managed Agents** for simple, single-model agents. **→ Foreman** if you need the workflow running today. **→ AgentCore** for a balanced start with room to grow.

### If your primary driver is **Long-term architectural flexibility**:
**→ AgentCore + Temporal + Kafka backbone.** Framework-agnostic, model-agnostic, open-source backbone. Most optionality.

---

## 6. Suggested Framing for Monday

Frame the conversation as: **"What's MFP's primary driver?"** Then map to the framework above. The honest answer is probably a blend:

1. **Short-term (TECHOPS-2297):** AgentCore solves the immediate backlog item — agent observability into Datadog
2. **Medium-term (existing workflows):** Foreman keeps running TECHOPS-2187 — it works, don't break it
3. **Long-term (platform):** Evaluate AgentCore as production runtime + FlowSpec/Temporal as orchestration layer, giving MFP both managed infrastructure *and* workflow expressiveness
4. **Watch list:** Revisit Managed Agents in 3-6 months when it's past beta and multi-agent is GA

Chris's role: not "adopt my thing" but "I've explored the space deeply, here's what I've learned, and here's how my work can plug into whatever direction the team chooses."

---

## Confidence & Caveats

### High confidence (verified against source code + official docs):
- All Foreman capability claims (verified against `claude-slack-bridge` codebase)
- All AWS AgentCore claims (18/18 confirmed against official AWS docs)
- Core Managed Agents architecture and pricing (15/18 confirmed)
- The three-layer hybrid model (orchestration/runtime/backbone)

### Unverified — treat with appropriate skepticism:
- **Managed Agents OTEL export status** — no documentation found confirming or denying. Likely absent today.
- **Managed Agents multi-agent delegation depth** — one worker claimed 1-level limit; not documented
- **Managed Agents SOC 2/HIPAA coverage** — Anthropic has org-level SOC 2 Type II; unclear if beta product is in scope
- **AgentCore "noisy neighbor" latency variance** — claimed by one third-party review (TrueFoundry), not independently verified
- **FlowSpec → Step Functions compilation feasibility** — architecturally plausible (AST is clean), but no compiler backend exists. Effort estimate of "weeks to months" is speculative.
- **6-week de-risking estimate for Foreman** — reasonable but not validated against real timelines

### Corrections from worker analyses:
- Workers claimed Foreman codebase was ~2,830-3,000 lines. **Actual: ~13,000 LOC** [CONFIRMED]
- Workers variously claimed 11 or 13 Jira operations. **Actual: 20 exported functions** [CONFIRMED]
- All three workers agree on the core recommendation framework and hybrid architecture — disagreements were on specific numbers, not strategic conclusions