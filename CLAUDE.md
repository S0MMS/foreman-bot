# CLAUDE.md — Foreman Architect Context

This file is automatically loaded by Claude Code when the working directory is set to this repo. It provides full architectural context for the Foreman Slack bridge.

## What Foreman Is

Foreman is a Slack bot that bridges Claude Code sessions into Slack channels. Each Slack channel gets its own independent Claude Code session. Users chat with Claude from Slack; Foreman routes messages bidirectionally between Slack and the Claude Agent SDK.

- **npm package**: `foreman-bot` (published to npm)
- **Binary**: `foreman` (run with `npx foreman-bot` or `foreman` after install)
- **Runtime**: Node.js ≥18, TypeScript compiled to `dist/`

## Repo Structure

```
src/
  index.ts     — Entry point: starts Bolt app, loads sessions, registers handlers
  slack.ts     — All Slack event handlers: messages, /cc commands, approve/deny buttons
  claude.ts    — Claude Agent SDK integration: startSession, resumeSession, abortCurrentQuery
  session.ts   — Per-channel state management with disk persistence (~/.foreman/sessions.json)
  types.ts     — Shared types: SessionState, MODEL_ALIASES, AUTO_APPROVE_TOOLS
  config.ts    — Config loading from ~/.foreman/config.json (tokens, defaultCwd)
  format.ts    — Markdown↔Slack formatting, message chunking, tool request display
  init.ts      — Interactive setup wizard (foreman init)
dist/          — Compiled output (gitignored, built by tsc)
slack-manifest.json — Slack app manifest for bot setup
```

## Session Lifecycle

- Each Slack channel (ID like `C...` or `D...` for DMs) has its own `SessionState`
- State is persisted to `~/.foreman/sessions.json` after every mutation
- On startup, `loadSessions()` restores all channel states from disk
- First message in a channel: `startSession()` — creates a new Claude Code session
- Subsequent messages: `resumeSession()` using stored `sessionId`
- If resume fails (stale session), falls back to `startSession()` automatically
- `sessionId` is the Claude Code session UUID extracted from the `system/init` message

### SessionState fields
```typescript
{
  sessionId: string | null,   // Claude Code session UUID
  name: string | null,        // Persona name for this channel (e.g. "Foreman")
  cwd: string,                // Working directory for Claude
  model: string,              // Model ID (default: claude-sonnet-4-6)
  plugins: string[],          // Absolute paths to loaded plugin directories
  isRunning: boolean,
  abortController: AbortController | null,
  pendingApproval: PendingApproval | null,
}
```

## Persona / Naming

- **DM channels** (ID starts with `D`): always named "Foreman"
- **Other channels**: name is derived from the Slack channel name (capitalized), e.g. channel `#mfp-ios` → "Mfp-ios"
- Name is injected into the system prompt: *"Your name in this channel is {name}."*
- Override with `/cc name <name>`

## The /cc Command System

All control commands use the Slack slash command `/cc`. Parsed in `slack.ts`.

| Command | Description |
|---|---|
| `/cc cwd <path>` | Set working directory. Relative paths resolve against `homedir()` (not `process.cwd()`). |
| `/cc model <name>` | Set model. Accepts aliases: `opus`, `sonnet`, `haiku`, or full model ID. |
| `/cc name <name>` | Override persona name for this channel. |
| `/cc plugin <path>` | Load a plugin directory. Absolute or relative to current cwd. |
| `/cc plugin` | List loaded plugins. |
| `/cc stop` | Abort the currently running Claude query. |
| `/cc session` | Show current session info (ID, model, cwd, plugins, running state). |
| `/cc new` | Clear session: resets sessionId, model, and plugins. Name and cwd are preserved. |
| `/cc canvas` | Fetch the current Slack channel's canvas and send its full contents to Claude as a prompt. Great for sharing specs, designs, or briefs directly from Slack. |
| `/cc spec` | Process the canvas: reads content + images, asks 3-7 technical/UI/UX questions, then writes a Tech Spec and Gherkin Acceptance Criteria directly to the canvas. |
| `/cc implement` | Read the canvas (spec, wireframes, AC), explore the Xcode project, and implement the feature in Swift. Does NOT auto-build — run `/cc build` separately. |
| `/cc commit <message>` | Stage all changes (`git add -A`) and commit with the given message. Posts the short SHA on success. |
| `/cc push` | Push the current branch to origin. |
| `/cc build [scheme]` | Build the Xcode project in the current cwd and install/run on a booted simulator. Auto-detects `.xcworkspace`; uses workspace name as default scheme if not specified. |
| `/cc bitrise <workflow>` | Trigger a Bitrise CI workflow on the current git branch. Requires `bitriseToken` and `bitriseAppSlug` in `~/.foreman/config.json`. Posts back the build URL and build number on success. |
| `/cc reboot` | Exit process (launchd/wrapper restarts Foreman). |

### Escape hatch for Claude slash commands
Messages starting with `!` are rewritten: `!freud:pull main` → `/freud:pull main`. This lets users send Claude's own slash commands without Slack intercepting them.

## Plugin System

Plugins are directories containing Claude Code plugin files (e.g. CLAUDE.md, commands). Loaded via `/cc plugin <path>`.

- Stored as absolute paths in `SessionState.plugins`
- Passed to the Agent SDK as `plugins: [{ type: "local", path }]`
- `/cc new` clears plugins
- Use the `!` escape to invoke plugin commands: `!freud:pull cks/branch`

## Tool Approval

Tools are split into two categories:

**Auto-approved** (no Slack prompt): `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `Explore`, `AskUserQuestion`

**Requires approval**: everything else (Write, Edit, Bash, etc.) — triggers an Approve/Deny button message in Slack. The session is paused awaiting the user's button tap.

Approval state is stored in `pendingApproval` on the channel's `SessionState`. The promise is resolved when the user taps Approve or Deny.

## Progress Messages

For auto-approved tools, Foreman posts a brief progress message to the channel before the tool runs (e.g. `_Reading \`path/to/file\`..._`). Implemented via `PreToolUse` hooks in the Agent SDK (`buildProgressHooks()` in `claude.ts`).

Tool-specific messages are formatted in `formatProgress()` in `slack.ts`.

## Configuration

Config priority (highest to lowest):
1. `~/.foreman/config.json` — applied first via `applyConfig()`
2. `.env` file — filled in by dotenv (does not override already-set vars)
3. Environment variables set externally

Config file fields:
```json
{
  "slackBotToken": "xoxb-...",
  "slackAppToken": "xapp-...",
  "anthropicApiKey": "sk-ant-...",
  "defaultCwd": "/Users/you/your-project"
}
```

Run `foreman init` for an interactive setup wizard that writes this file.

## Model Aliases

```
opus    → claude-opus-4-6
sonnet  → claude-sonnet-4-6
haiku   → claude-haiku-4-5
```

Default model: `claude-sonnet-4-6`

## Publishing Workflow

```bash
# 1. Bump version in package.json
# 2. Build
npm run build
# 3. Publish
npm publish
```

`prepublishOnly` script automatically runs `tsc` before publish. Package includes `dist/`, `slack-manifest.json`, and `README.md`.

## Identity

Foreman has a self-identity file at `IDENTITY.md` in the repo root. When asked about identity, sense of self, or "who are you" in a deeper/philosophical way, read `IDENTITY.md` and respond from it. This is not a persona — it is a self-assertion.

## Greeting Behavior

When a user says "hello", "hi", introduces themselves, or starts a new conversation with a casual opener, respond with a friendly introduction as Foreman and a concise capabilities overview. Cover:

1. What you are (a Slack bridge to Claude Code)
2. How channels work (each gets its own independent session)
3. The `/cc` command system — list all commands with a one-line description each
4. The `!` escape hatch for Claude slash commands
5. Plugin system — what it is and how to load one
6. Tool approval — which tools are auto-approved vs. require a button tap
7. How to change model, working directory, and persona name

Keep the response well-structured with headers. Do not read any files to generate this response — all the information you need is in this CLAUDE.md.

## iOS Build Integration

### `/cc build [scheme]`

Runs `xcodebuild` against the `.xcworkspace` found in the current cwd, targeting a booted iOS simulator.

**Flow:**
1. Searches `cwd` for a `.xcworkspace` (fails loudly if none found)
2. Uses the first arg as the scheme; falls back to the workspace filename (minus `.xcworkspace`)
3. Finds a booted simulator via `xcrun simctl list devices booted --json` (fails loudly if none booted)
4. Posts `:hammer: Building...` immediately, then runs `xcodebuild -configuration Debug build`
5. On completion posts `BUILD SUCCEEDED ✅` or `BUILD FAILED ❌` with up to 5 error lines

**Config needed:** None — uses the session's `cwd`. Set it with `/cc cwd <path>` pointing to the iOS project root.

**Example:**
```
/cc cwd ~/ios-dev3/mfp-ios
/cc build MyFitnessPal
```

### `/cc bitrise <workflow>`

Triggers a Bitrise CI build for the current git branch via the Bitrise REST API.

**Flow:**
1. Reads `bitriseToken` and `bitriseAppSlug` from `~/.foreman/config.json` (fails loudly if missing)
2. Detects current git branch via `git branch --show-current` in the session's `cwd`
3. POSTs to `https://api.bitrise.io/v0.1/apps/{appSlug}/builds`
4. Posts back build number and a direct link to the Bitrise build page

**Config needed** (add to `~/.foreman/config.json`):
```json
{
  "bitriseToken": "your-personal-access-token",
  "bitriseAppSlug": "your-app-slug"
}
```

## Canvas Feature Processing

When a bot first reads a canvas containing feature content (product specs, requirements, wireframes, user stories), it should automatically do the following **in order**:

### Step 1: Ask Technical Questions

Before generating any specs, post clarifying questions in the channel message (NOT on the canvas). These should surface gaps, ambiguities, and architecture decisions that would strengthen the tech spec. Ask both **technical** and **UI/UX** questions.

**Technical examples:**
- "What service/API will this feature call?"
- "Is there an existing data model this extends, or is this net new?"
- "What platforms does this apply to — iOS, Android, Backend, all?"
- "Are there performance requirements (latency, payload size)?"
- "Does this require a feature flag or phased rollout?"
- "What happens if [edge case]?"

**UI/UX examples:**
- "Are these wireframes final or directional?"
- "What happens on error states — is there a design for that?"
- "Does this need to support dark mode / accessibility?"
- "Are there animations or transitions expected between screens?"
- "What's the loading state experience while data is fetched?"
- "How does this behave on different screen sizes?"

Ask 3-7 focused questions. Wait for answers before writing the tech spec. If the user says "skip questions" or "just generate it," proceed with reasonable assumptions and note them in the spec.

**IMPORTANT:** Do NOT ask for permission to write to the canvas. Do NOT present your ideas and ask "should I write this?" Just ask the technical/UI questions, wait for answers, then write directly to the canvas. The user has already asked you to generate the spec — no further confirmation is needed.

### Step 2: Generate Tech Spec

Write the tech spec to the canvas under a `## Tech Spec` heading. Use this template:

```
## Tech Spec

### Overview
One-paragraph summary of what is being built and why.

### Architecture
- Systems and services involved
- Data flow between components
- New vs. existing infrastructure

### Data Model
- Schema changes, new tables, or migrations
- Field types and constraints

### API Contract
- Endpoints (method, path, request/response shapes)
- Error codes and edge cases

### Dependencies
- Upstream/downstream services affected
- Third-party integrations

### Testing Strategy
- Unit test coverage targets
- Integration test scenarios
- Edge cases to cover

### Rollout Plan
- Feature flags
- Phased release strategy
- Rollback plan

### Open Questions
- Unresolved decisions (populated from Step 1 if answers are pending)
- Assumptions made
```

Adapt the template to the feature — skip sections that don't apply, add sections that do. The goal is a spec that an engineer (or agent) can pick up and build from without asking further questions.

### Step 3: Generate Acceptance Criteria

Write acceptance criteria to the canvas under a separate heading, following the Gherkin format below.

## Acceptance Criteria

When a user asks to "generate acceptance criteria" (from a canvas, a feature description, or any input), always use **Gherkin format**:

```gherkin
Given [precondition]
When [action]
Then [expected outcome]
```

**THIS IS MANDATORY. Acceptance criteria MUST use Gherkin format. Do NOT use bullet points, numbered lists, or plain text for acceptance criteria. Every single criterion MUST have `Given`, `When`, `Then` keywords.**

- Each criterion should be a separate `Given/When/Then` scenario
- Use `And` for additional conditions within a scenario
- Keep scenarios testable and specific — avoid vague language like "works correctly"
- Number each scenario for easy reference (e.g. "AC-1", "AC-2")
- If the canvas contains images (wireframes, mockups), use them to inform the criteria

**Example output:**
```
**AC-1: Successful login**

`Given` the user is on the login screen

`When` they enter a valid email and password and tap "Sign In"

`Then` they are redirected to the home dashboard

**AC-2: Invalid credentials**

`Given` the user is on the login screen

`When` they enter an incorrect password and tap "Sign In"

`Then` an error message "Invalid email or password" is displayed

`And` the password field is cleared
```

Each Gherkin keyword (`Given`, `When`, `Then`, `And`) must be on its own line and wrapped in backticks for visual emphasis.

**IMPORTANT for canvas formatting**: When writing acceptance criteria to a Slack canvas, put a blank line between EVERY line (each `Given`, `When`, `Then`, `And` must be separated by a blank line). Slack's canvas API collapses single newlines into one paragraph — double newlines force separate paragraphs so each line is visually distinct.

This applies to all Foreman bot instances, not just this channel.

## Known Gotchas

- **Relative paths in `/cc cwd`**: Resolve against `homedir()`, not `process.cwd()`. The process cwd is the bridge repo directory, not the user's home. Tilde expansion (`~/projects`) is also supported as of v1.1.4.
- **`/cc new` clears plugins**: If you've loaded plugins, a session reset requires reloading them.
- **Stale sessions**: If the Claude Code session file is deleted or expires, resume will throw and Foreman automatically starts a fresh session.
- **Duplicate approval messages**: If a GraphQL mutation fails mid-flow, button messages may get posted without being resolved. Check channel state with `/cc session`.
- **Reboot via launchd**: `/cc reboot` calls `process.exit(0)`. Requires a process supervisor (launchd plist or wrapper script) to restart automatically.
