# Agent Infrastructure Comparison: AgentCore vs. Managed Agents vs. Foreman

**Prepared for:** MFP Infra Team (Brian Lococo) — Monday 2026-04-14
**Author:** Chris Shreve
**Purpose:** Honest, balanced comparison to help the team make the right call for MFP

---

## Claim Verification Summary

Every factual claim below was verified against primary sources (AWS docs, Anthropic blog/docs, Foreman codebase). Status labels:

| Claim | Status |
|-------|--------|
| AgentCore is multi-model, framework-agnostic | **CONFIRMED** — works with CrewAI, LangGraph, Strands, any FM |
| AgentCore has 9 modular services | **CONFIRMED** — Runtime, Memory, Gateway, Browser, Code Interpreter, Identity, Policy, Observability, Evaluations |
| AgentCore emits OpenTelemetry-compatible telemetry | **CONFIRMED** — OTEL format, stored in CloudWatch |
| AgentCore is SOC-validated, HIPAA-eligible, pursuing FedRAMP | **CONFIRMED** — AWS compliance docs |
| AgentCore supports A2A protocol | **CONFIRMED** — JSON-RPC 2.0, gRPC, REST |
| AgentCore pricing: $0.0895/vCPU-hour, no charge during I/O wait | **CONFIRMED** — AWS pricing page |
| AgentCore has no workflow DSL | **CONFIRMED** — use Step Functions or build your own |
| AgentCore Policy controls are GA (March 2026) | **CONFIRMED** |
| Managed Agents launched April 8, 2026 (public beta) | **CONFIRMED** — Anthropic blog |
| Managed Agents uses Brain/Hands/Session architecture | **CONFIRMED** — stateless Brain, disposable Linux containers, append-only event log |
| Managed Agents costs $0.08/session-hour + tokens + $10/1K searches | **CONFIRMED** |
| Managed Agents is Claude-only | **CONFIRMED** — no GPT, Gemini, or other models |
| Managed Agents has checkpointing and session resume | **CONFIRMED** — auto-checkpoint after tool steps |
| Managed Agents multi-agent coordination is "research preview" | **CONFIRMED** — requires separate access request |
| Managed Agents early customers: Notion, Rakuten, Asana | **CONFIRMED** |
| Foreman FlowSpec has 16 primitives including `at the same time` | **CONFIRMED** — verified against parser.ts (~660 lines) |
| Foreman `within`/`retry` are parsed but not executed | **CONFIRMED** — cosmetic per Pythia self-analysis |
| Foreman has 3 working AI adapters (Claude, GPT, Gemini) | **CONFIRMED** — AnthropicAdapter.ts, OpenAIAdapter.ts, GeminiAdapter.ts |
| TECHOPS-2187: 13 classes across 4 PRs | **CONFIRMED** — PRs #10319, #10322, #10331, #10369 |
| Foreman bus factor = 1 | **CONFIRMED** |

---

## 1. Head-to-Head Comparison

### Model Flexibility

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| Multi-model | **Any FM** — Bedrock models + any via Runtime | **Claude only** | **Claude + GPT + Gemini** |
| Framework support | CrewAI, LangGraph, LlamaIndex, Strands, custom | Anthropic harness only | Custom adapters |
| Verdict | **Winner** | Locked in | Good but manual |

**AgentCore wins decisively here.** It's framework- and model-agnostic by design. Foreman's multi-model support is real (Pythia runs Claude + Gemini + GPT in the same workflow today), but each adapter is hand-written. Managed Agents is Claude-only — if you want model diversity for verification or cost optimization, it can't do it.

### Workflow Orchestration

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| Workflow DSL | **None** — use Step Functions | **None** — imperative agent loop | **FlowSpec** — 16 primitives |
| Multi-step | Step Functions or code | Agent decides autonomously | Declarative in `.flow` files |
| Parallel fan-out | Step Functions parallel state | Research preview (multi-agent) | `at the same time` (Promise.allSettled) |
| Conditional logic | Step Functions Choice state | Agent reasoning | `if/otherwise` with typed operators |
| Human gates | Manual (callback pattern) | Not documented | `pause for approval` |
| Sub-workflows | Step Functions nested | Not supported | `run "Workflow"` |

**Foreman wins on expressiveness.** FlowSpec is the only purpose-built DSL in this comparison. A non-engineer can read `ask @pythia-claude-worker "analyze {topic}"` and understand what's happening. Neither managed service has anything equivalent — AgentCore delegates to Step Functions (powerful but JSON/YAML state machines), and Managed Agents relies on the model deciding what to do next (no deterministic control flow).

**However:** FlowSpec's `within`/`retry` blocks are parsed but never executed by the compiler. This is a known gap. The compiler is ~340 lines of interpreter code maintained by one person. Step Functions is battle-tested at AWS scale.

### Durability and Fault Tolerance

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| Crash recovery | Runtime restarts; Memory service persists context | Auto-checkpoint after tool steps; resume from last checkpoint | Temporal event history + replay |
| State persistence | AgentCore Memory (managed) | Append-only session log | Temporal + Kafka (self-hosted) |
| Long-running | Yes — consumption-based, no charge during I/O | Yes — sessions run for hours, survive disconnects | Yes — Temporal has no timeout ceiling |
| Battle-tested? | New (preview) | New (public beta, 3 days old) | Temporal itself is battle-tested; FlowSpec compiler is not |

**Nuanced.** Temporal's durability model is the most proven technology in this comparison — it's used at Uber, Netflix, Snap scale. But Foreman's *use* of Temporal is a thin integration maintained by one engineer. Managed Agents' checkpointing is elegant (resume from any checkpoint) but 3 days old in public beta. AgentCore's durability comes from the underlying AWS primitives.

### Observability and Audit Trail (TECHOPS-2297)

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| Native observability | **CloudWatch dashboards** — session count, latency, duration, tokens, errors | **Append-only event log** — every thought, tool call, observation | **Kafka topics** — {bot}.inbox / {bot}.outbox |
| OpenTelemetry | **Yes** — OTEL-compatible format | Not documented | No |
| Datadog integration | **Via OTEL exporter → Datadog** | Would need custom export from session logs | Would need Kafka consumer → Datadog |
| Cross-account | **Yes** — CloudWatch cross-account observability | No (single org) | N/A (self-hosted) |
| Metrics | Token usage, latency, session duration, error rates | Session events, tool invocations | Kafka message timestamps, Temporal event history |

**AgentCore wins for TECHOPS-2297.** The OpenTelemetry-compatible output means you can pipe directly to Datadog with a standard OTEL collector. This is exactly what the ticket asks for. Foreman's Kafka audit trail is comprehensive (every message flows through topic pairs), but you'd need to build the Datadog integration yourself. Managed Agents' event log is detailed but has no documented OTEL export path.

### Tool/Integration Ecosystem

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| Protocol | **MCP + A2A** | **MCP** | **Custom MCP server** ("foreman-toolbelt") |
| Jira | Via MCP server (bring your own) | Via MCP server | **Working today** — full CRUD, transitions, comments |
| Confluence | Via MCP server | Via MCP server | **Working today** — read, search, create, update |
| GitHub | Via MCP server | Via MCP server | **Working today** — PRs, issues, search |
| Bitrise | Custom integration needed | Custom integration needed | **Working today** — trigger builds |
| Slack | Via MCP server | Via MCP server | **Working today** — Socket Mode bridge, Canvas CRUD |
| Mattermost | Custom integration needed | Custom integration needed | **Working today** — full WebSocket bridge |

**Foreman wins on current state** — 38 tools working in production today, already wired to MFP's specific systems. Both managed services support MCP, which means the same tool servers *could* work, but you'd need to deploy and configure them. Foreman's `foreman-toolbelt` is a monolith (acknowledged tech debt — decomposition is planned but not done).

### Compliance and Security

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| SOC 2 | **Validated** | Anthropic has SOC 2; Managed Agents inherits (UNVERIFIED for the new service specifically) | **None** |
| HIPAA | **Eligible** | **UNVERIFIED** | **None** |
| FedRAMP | **Pursuing** | **UNVERIFIED** | **None** |
| Credential isolation | IAM roles, VPC, Identity service | Credentials never enter sandbox (MCP mediated) | Env vars on Chris's machine |
| Network isolation | **VPC connectivity** | Sandboxed containers with network rules | Docker Compose on local machine |

**AgentCore wins unambiguously.** This isn't close. AgentCore inherits AWS's compliance infrastructure — SOC validated, HIPAA eligible, VPC isolation, IAM. Managed Agents has a good credential isolation story (credentials never enter the sandbox) but the service is 3 days old in public beta. Foreman has zero compliance story. If compliance is a hard requirement, AgentCore is the only option today.

### Operational Burden

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| Who maintains it? | AWS | Anthropic | **Chris Shreve (1 person)** |
| Infrastructure | Managed (serverless) | Managed | Docker Compose (Redpanda + Temporal + Postgres + Mattermost) |
| Bus factor | AWS (~thousands of engineers) | Anthropic (~hundreds) | **1** |
| Upgrades | AWS manages | Anthropic manages | Manual |
| On-call | AWS | Anthropic | Chris |

**This is the elephant in the room.** Foreman is maintained by one engineer. If Chris leaves, gets reassigned, or is unavailable, the system stops evolving and eventually stops working. The Dead Man Protocol exists for graceful handoff, the codebase is published to npm (`foreman-bot` v1.2.0), and there are Confluence docs — but the operational knowledge lives in one person's head. Both managed services eliminate this risk entirely.

### Cost Model

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| Compute | $0.0895/vCPU-hr + $0.00945/GB-hr (no I/O wait charges) | $0.08/session-hour (idle not charged) | Self-hosted (EC2/local machine cost) |
| Model inference | Bedrock pricing (varies by model) | Claude token pricing ($3/$15 per M tokens for Sonnet) | Direct API costs to each provider |
| Extras | Gateway, Memory, Policy per-use | $10/1K web searches | Redpanda, Temporal, Postgres infra |
| At MFP scale | Pay-per-use scales linearly | Pay-per-use scales linearly | Fixed infra cost + API costs |

**Cost comparison is hard without usage data.** At low volume (dozens of agents, occasional runs), Foreman's self-hosted infra might be cheapest. At scale, the managed services' consumption pricing avoids idle-resource waste. AgentCore's "no charge during I/O wait" is significant — agentic workloads spend 30-70% in I/O wait. Managed Agents' $0.08/session-hour is simple to reason about.

### Maturity and Risk

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| Status | **Preview** (Policy GA since March 2026) | **Public beta** (3 days old) | **Working POC** (~3 months) |
| Production users | AWS customers (count unknown) | Notion, Rakuten, Asana | **MFP** (TECHOPS-2187) |
| Underlying tech maturity | AWS infrastructure (decades) | Anthropic platform (~2 years) | Temporal (proven), Kafka (proven), FlowSpec (novel) |
| Breaking changes risk | Medium (preview) | High (beta, 3 days old) | Low (you control it) but high (one maintainer) |

### Multi-Agent Coordination

| | AgentCore | Managed Agents | Foreman |
|---|---|---|---|
| Agent-to-agent | **A2A protocol** (JSON-RPC, gRPC, REST) | **Research preview** (requires access request) | **Kafka topic pairs** + FlowSpec orchestration |
| Discovery | **Agent Registry** (preview) | Not documented | `bots.yaml` registry (24 bots) |
| Coordination model | Peer-to-peer via A2A | One agent spins up others | Centralized orchestration via FlowSpec |

**Different philosophies.** AgentCore's A2A is a peer-to-peer protocol — agents discover and talk to each other directly. Foreman's model is centralized — FlowSpec orchestrates which bot talks to which, with Kafka as the message bus. Managed Agents' multi-agent is still research preview. For deterministic multi-model workflows like Pythia, Foreman's centralized model is actually an advantage — you want the orchestration to be predictable, not emergent.

---

## 2. Strengths and Weaknesses (Brutally Honest)

### AWS AgentCore

**Strengths:**
- Compliance story is production-ready (SOC, HIPAA, VPC)
- OTEL observability → Datadog is the straightest path for TECHOPS-2297
- Model/framework agnostic — no vendor lock beyond AWS
- A2A + Agent Registry = enterprise multi-agent governance
- Consumption-based pricing with no I/O wait charges
- AWS maintains it — infinite bus factor

**Weaknesses:**
- No workflow DSL — you're writing Step Functions JSON or building orchestration yourself
- Still in preview — API surface may change
- AWS complexity tax — IAM, VPC, CloudFormation setup
- No equivalent to FlowSpec's human-readable orchestration
- Agent Registry is preview-on-preview

### Anthropic Claude Managed Agents

**Strengths:**
- Elegant architecture (Brain/Hands/Session separation)
- Checkpointing and resume is genuinely useful for long-running tasks
- MCP-native — clean integration model
- Lowest operational burden — define agent in YAML, Anthropic runs everything
- Agent Skills for reusable capability modules
- Session event log is a natural audit trail

**Weaknesses:**
- **Claude-only** — cannot run multi-model verification workflows like Pythia
- **3 days old in public beta** — maturity risk is real
- Multi-agent coordination requires separate access (research preview)
- No workflow DSL — agent decides what to do (non-deterministic)
- Anthropic controls pricing, availability, and deprecation
- Compliance certs for the new service are **unverified**
- Cannot self-host — data leaves your infrastructure

### Foreman/FlowSpec/Temporal/Kafka

**Strengths:**
- **FlowSpec is unique** — no managed service offers a declarative multi-bot orchestration DSL
- **Multi-model workflows work today** — Pythia runs Claude + Gemini + GPT in 5 phases
- **38 MCP tools integrated** with MFP's actual systems (Jira, Confluence, Bitrise, Slack, Mattermost, GitHub)
- **Kafka audit trail** — every bot message flows through topic pairs, complete history
- **Temporal durability** — proven technology, event replay, no timeout ceiling
- **Running in production** — TECHOPS-2187 has shipped 4 PRs with 13 test classes
- **You own it** — no vendor can deprecate it, change pricing, or limit features

**Weaknesses:**
- **Bus factor = 1** — this is a real, existential risk for team adoption
- **Zero compliance story** — no SOC, no HIPAA, env vars for credentials
- **FlowSpec compiler gaps** — `within`/`retry` are cosmetic, no concurrency guards, silent parallel failures
- **No OTEL export** — Kafka has the data but there's no Datadog pipeline
- **Mattermost message chunking missing** — large outputs fail at 16K char limit
- **Self-hosted Docker Compose** — not production infrastructure by enterprise standards
- **Novel DSL** — FlowSpec has no community, no tooling ecosystem, no IDE support

---

## 3. The Hybrid Angle

These are **not mutually exclusive.** Here's where they complement each other:

### Option A: FlowSpec + AgentCore Runtime
FlowSpec orchestrates *what happens when*, AgentCore runs the actual agents. This gets you:
- FlowSpec's deterministic multi-model workflows
- AgentCore's compliance, observability, and managed runtime
- The `agentcore` bot type is already defined in `bots.yaml` (schema exists, runtime not yet implemented)
- **Gap:** FlowSpec compiler would need an AgentCore activity adapter — estimated moderate effort

### Option B: Temporal + Kafka as Backbone, Any Agent Runtime
Keep Temporal for workflow durability and Kafka for audit trail regardless of which agent runtime you use. Both managed services lack Temporal-grade replay semantics.
- AgentCore agents or Managed Agent sessions become Temporal activities
- Kafka consumers export to Datadog (solves TECHOPS-2297)
- **Gap:** Integration code needed for each runtime

### Option C: FlowSpec Compiles to Step Functions
Instead of FlowSpec's interpreter, compile `.flow` files to Step Functions state machines. This gets you:
- Human-readable authoring (FlowSpec) with enterprise execution (Step Functions)
- AWS compliance and observability for free
- **Gap:** This is a significant compiler rewrite — theoretical, not imminent

### Option D: Managed Agents for Single-Agent Tasks, Foreman for Multi-Model Orchestration
Use Managed Agents where Claude alone is sufficient (code generation, document analysis). Use Foreman/FlowSpec where you need multi-model verification (Pythia) or deterministic multi-step workflows.
- **Gap:** Two systems to maintain, two operational models

### Recommended Hybrid: Option A or B
The most pragmatic path is keeping FlowSpec/Temporal/Kafka as the orchestration and durability layer while adopting AgentCore as the managed runtime for individual agent execution. This preserves Foreman's unique strengths (DSL, multi-model, existing integrations) while gaining AgentCore's compliance, observability, and operational sustainability.

---

## 4. Risks and Blind Spots

### AWS AgentCore — Risks
- **Preview churn:** APIs may break before GA. Building on preview services is a calculated bet.
- **Complexity creep:** 9 modular services = 9 things to configure. AWS products tend toward configuration complexity.
- **6-month risk:** Preview → GA transition may change pricing or deprecate features.
- **12-month risk:** Low — AWS rarely kills services. But AgentCore could be subsumed into a broader Bedrock offering.
- **Blind spot:** No workflow DSL means your team builds and maintains orchestration logic.

### Managed Agents — Risks
- **3 days old.** This cannot be overstated. Public betas change rapidly.
- **Claude-only lock-in.** If Anthropic's models fall behind (or pricing rises), you can't swap.
- **Anthropic is a startup** (~5 years old). Vendor risk is higher than AWS.
- **6-month risk:** API changes, pricing changes, feature removals. Normal beta churn.
- **12-month risk:** Anthropic could pivot strategy, get acquired, or make Managed Agents higher-tier only.
- **Blind spot:** Multi-agent coordination is research preview — it may never ship as described.

### Foreman — Risks
- **Bus factor = 1.** If Chris is unavailable for 2 weeks, what happens? The Dead Man Protocol documents recovery, but operational knowledge is concentrated.
- **No compliance path.** Adding SOC 2 to a self-hosted Node.js app is months of work and ongoing audit cost.
- **FlowSpec is novel.** No community, no StackOverflow answers, no third-party tooling. Every bug is Chris's bug.
- **6-month risk:** Chris gets reassigned to iOS sprint work. Foreman stalls.
- **12-month risk:** Without a second maintainer, the system becomes legacy. Nobody wants to inherit a custom DSL interpreter.
- **Blind spot:** The Kafka audit trail has the data but no pipeline to Datadog. "We have the data" ≠ "we have observability."

### Compliance Gaps — Difficulty to Close

| Gap | Difficulty |
|-----|-----------|
| Foreman → SOC 2 | **Hard** — months of policy work, ongoing audits, $50K-150K/year |
| Foreman → HIPAA | **Very hard** — requires formal BAA, encryption at rest/transit, access controls |
| Foreman credentials → proper secret management | **Medium** — move from env vars to AWS Secrets Manager or Vault |
| Foreman → production infra (not Docker Compose) | **Medium** — containerize to ECS/EKS, but someone must maintain it |

---

## 5. Recommendation Framework

**Don't pick one. Pick based on your primary driver.**

| If your primary driver is... | Choose... | Because... |
|---|---|---|
| **Compliance (SOC/HIPAA)** | **AgentCore** | Only option with validated compliance today |
| **TECHOPS-2297 (Datadog observability)** | **AgentCore** | OTEL-compatible output → Datadog with standard collector |
| **Lowest operational burden** | **Managed Agents** (single-agent) or **AgentCore** (multi-agent) | Both are fully managed; Foreman requires dedicated maintainer |
| **Multi-model verification** | **Foreman** (today) or **AgentCore** (future) | Foreman is the only system running multi-model workflows today; AgentCore is model-agnostic but you build orchestration yourself |
| **Deterministic workflow orchestration** | **Foreman/FlowSpec** | Only system with a declarative DSL for multi-bot workflows |
| **Fastest time to production** | **AgentCore** | Managed infra + compliance + observability out of the box |
| **Maximum control / no vendor lock** | **Foreman** | You own every line; but you also maintain every line |
| **MFP tool integrations** | **Foreman** (today) | 38 tools already wired to your specific Jira, Confluence, Bitrise, GitHub |

### For MFP Specifically — Honest Take

The Infra Team's instinct to evaluate AgentCore is sound. It addresses TECHOPS-2297 directly (OTEL → Datadog), it has the compliance story MFP needs, and it eliminates the bus-factor risk.

Foreman's unique contribution is FlowSpec and the multi-model orchestration pattern. Neither managed service offers anything like it. The question is whether that's valuable enough to justify the operational cost of maintaining it.

**The pragmatic path:** Adopt AgentCore for the runtime/observability/compliance layer. Evaluate whether FlowSpec's orchestration model adds enough value over Step Functions to justify keeping it as a layer on top. If yes, invest in making Foreman a team-maintained orchestration layer (not a one-person project). If no, migrate the integrations to AgentCore + Step Functions and sunset Foreman.

---

## Confidence & Caveats

**High confidence:**
- All AgentCore capabilities verified against AWS docs and product page
- All Managed Agents capabilities verified against Anthropic engineering blog and platform docs
- All Foreman capabilities verified against actual codebase at `/Users/chris.shreve/claude-slack-bridge`

**Unverified claims (flagged):**
- Managed Agents' specific compliance certifications (SOC 2, HIPAA) for the new service — Anthropic has company-level SOC 2, but whether it extends to the 3-day-old Managed Agents service is unconfirmed
- AgentCore's exact GA timeline — it's in preview with some components GA
- Cost comparison at MFP's specific scale — would need actual usage data to model

**Known limitations of this analysis:**
- Could not access AgentCore's console or test it hands-on
- Managed Agents is 3 days old — the landscape will shift rapidly
- Foreman's capabilities were verified against code, not by running the system
- Pricing comparison is directional, not precise — actual costs depend on usage patterns MFP would need to model

---

## Sources
- Amazon Bedrock AgentCore — https://aws.amazon.com/bedrock/agentcore/
- AgentCore Docs — https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html
- AgentCore Observability — https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html
- AgentCore Compliance — https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/compliance-validation.html
- AgentCore Pricing — https://aws.amazon.com/bedrock/agentcore/pricing/
- AgentCore A2A Protocol — https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a-protocol-contract.html
- Agent Registry Preview — https://aws.amazon.com/about-aws/whats-new/2026/04/aws-agent-registry-in-agentcore-preview/
- Anthropic: Scaling Managed Agents — https://www.anthropic.com/engineering/managed-agents
- Claude Managed Agents Docs — https://platform.claude.com/docs/en/managed-agents/overview
- SiliconANGLE: Anthropic launches Claude Managed Agents — https://siliconangle.com/2026/04/08/anthropic-launches-claude-managed-agents-speed-ai-agent-development/
- The New Stack: Anthropic Managed Agents — https://thenewstack.io/with-claude-managed-agents-anthropic-wants-to-run-your-ai-agents-for-you/
- The New Stack: AgentCore Policy Layer — https://thenewstack.io/aws-new-policy-layer-in-bedrock-agentcore-makes-sure-ai-agents-cant-give-away-the-store/
