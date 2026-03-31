We are porting FlowSpec — a workflow description language for orchestrating AI bots — from Temporal TypeScript to AWS. The target architecture is:

- Outer layer: AWS Step Functions (sequential steps, branching, parallel fan-out, loops)
- Inner layer: AWS AgentCore / Bedrock Agents (each `ask` step invokes an agent)

FlowSpec currently compiles to Temporal TypeScript. Each primitive maps 1:1:

| FlowSpec Primitive | Current (Temporal) | Target (AWS) |
|---|---|---|
| `ask @bot "prompt" -> var` | Activity: dispatchToBot | ? |
| `send #channel "text"` | Activity: postStatus | ? |
| `at the same time` (parallel) | Promise.all | Step Functions Parallel state |
| `race` (first wins) | Promise.race | ? |
| `for each item in {list}` | for loop + continueAsNew | Step Functions Map state |
| `repeat until {x} op "Y", at most N` | for loop with condition | ? |
| `if {x} contains/equals/means "Y"` | if statement | Step Functions Choice state |
| `run "Workflow" -> capture` | executeChild | Step Functions sub-state-machine |
| `pause for approval` | signal + condition | Step Functions Wait + callback |
| `read "path" -> var` | fs.readFileSync | Lambda function |
| `write {var} to "path"` | fs.writeFileSync | Lambda function |
| `stop "message"` | throw FlowStop | States.Fail |
| `within <duration>` (timeout) | startToCloseTimeout | ? |
| `retry N times` | RetryPolicy | Step Functions Retry |

CONTEXT:
- MFP (MyFitnessPal) has an existing AWS account and a formal decision to use AgentCore for agent hosting (Confluence: "Hosting Agent Infrastructure")
- Region: us-east-1
- FlowSpec workflows use multiple AI models: Claude (Anthropic), GPT (OpenAI), and Gemini (Google). Model heterogeneity is a core design principle — different models produce different reasoning patterns.
- The `means` operator requires a follow-up classification prompt to the same agent session
- FlowSpec supports recursive workflows via `run "Workflow"` (child workflows calling child workflows)
- We need to support at least 5 levels of recursion depth

QUESTIONS TO ANSWER:

1. **AgentCore API Surface**: What is the current AgentCore API? How do you invoke an agent, pass a prompt, and get a response? Is it synchronous or async? What are the request/response schemas?

2. **Multi-Model Support**: Can AgentCore run Claude, GPT-4o, and Gemini agents? Or is it restricted to Bedrock-supported models? If restricted, what's the alternative for model heterogeneity?

3. **Agent Sessions / Statefulness**: Does AgentCore support multi-turn conversations with a single agent? The `means` operator sends a follow-up classification prompt to the same agent that just responded. Does AgentCore support this, or is each invocation stateless?

4. **Tool Access**: Can AgentCore agents use tools like file read/write, bash execution, GitHub API, Jira API? How are tools configured? Are they equivalent to what Claude Code provides?

5. **Step Functions Limits**: What are the practical limits? Max states per state machine? Max execution history size? Max parallel branches? Max nested sub-state-machines (recursion depth)? Max execution duration?

6. **Race Semantics**: Step Functions Parallel waits for ALL branches. FlowSpec `race` needs first-to-finish-wins with cancellation of the rest. How do you implement race semantics in Step Functions?

7. **The `means` Operator**: This requires sending a follow-up prompt to the same agent: "Based on your previous response, reply with ONLY one of: approved, needs changes, rejected." How would this work with AgentCore? Does the agent retain session context between invocations?

8. **Cost Model**: What does AgentCore charge? Per invocation? Per compute-second? How does it compare to running Claude Code sessions via the Anthropic API directly?

9. **Approval Gates**: FlowSpec `pause for approval` blocks the workflow until a human signals approval. Step Functions has callback tokens for this. How exactly does this work? What's the max wait time?

10. **Compilation Strategy**: Should the FlowSpec compiler emit ASL (Amazon States Language) JSON directly? Or should it generate CDK/CloudFormation that creates the state machine? What's the right abstraction level?

DELIVERABLES:
1. Answers to all 10 questions with specific API references, ARN formats, and code examples where applicable
2. A risk assessment: what FlowSpec features are easy to port, hard to port, or impossible on AWS?
3. A recommended architecture diagram showing how the pieces connect
4. A migration roadmap: what to build first, what to defer
