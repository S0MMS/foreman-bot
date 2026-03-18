# Prototype Workflow

The canonical end-to-end flow for multi-agent feature implementation using Foreman.

## Channels

| Channel | Role | cwd |
|---|---|---|
| `#feature-channel` | Orchestrator — holds canvas, drives the saga | n/a |
| `#ios-dev-channel` | Worker — implements in Swift | iOS repo |
| `#android-dev-channel` | Worker — implements in Kotlin | Android repo |

## Flow

```
#feature-channel
│
│  1. Designer adds spec + wireframes to canvas
│  2. /cc spec → generates Tech Spec + Gherkin AC on canvas
│  3. Engineer approves
│
├──────────────────────────────────┐
▼                                  ▼
#android-dev-channel        #ios-dev-channel
4. 'implement feature'      4. 'implement feature'
5. /cc implement            5. /cc implement
6. builds + emulator        6. builds + simulator
   → sends 'done'              → sends 'done'
│                                  │
└──────────────┬────────────────────┘
               ▼
        #feature-channel
        6. Designer reviews both apps
        7. Designer approves
               │
├──────────────────────────────────┐
▼                                  ▼
#android-dev-channel        #ios-dev-channel
8. 'ship'                   8. 'ship'
9. commit + push            9. commit + push
10. /cc bitrise             10. /cc bitrise
    BuildQaRelease               TestFlight
```

## Human Gates

1. **Engineer approval** — after `/cc spec` generates the tech spec + AC, before implementation starts
2. **Designer approval** — after both platforms are built and running on simulators/emulators, before ship

## Key Technical Challenges

### Fan-in
`#feature-channel` must wait for BOTH `'done'` messages before notifying the designer. Slack Workflows are linear and can't natively wait for parallel completions — handled by Foreman's webhook server (`POST /webhook/dispatch-complete`).

### Cross-channel canvas read
Worker bots (`#ios-dev-channel`, `#android-dev-channel`) read the feature spec directly from `#feature-channel`'s canvas using `fetchChannelCanvas(app, sourceChannelId)`. No canvas copying — one source of truth.

### Parallel dispatch
`'implement feature'` is sent to both workers simultaneously. Each implements independently with no knowledge of the other.

## Implementation Architecture

```
Slack Workflow 1 (triggered by engineer approval reaction)
    → posts 'implement feature' to #ios-dev-channel
    → posts 'implement feature' to #android-dev-channel

Foreman (#ios-dev-channel)
    → reads canvas from #feature-channel
    → /cc implement (Swift)
    → POST /webhook/dispatch-complete

Foreman (#android-dev-channel)
    → reads canvas from #feature-channel
    → /cc implement (Kotlin)
    → POST /webhook/dispatch-complete

Foreman webhook server (fan-in)
    → counts completions
    → when all done → calls Slack Workflow 2 trigger URL

Slack Workflow 2 (designer review)
    → DMs designer: "Ready for review — Approve?"
    → Designer approves
    → posts 'ship' to #ios-dev-channel
    → posts 'ship' to #android-dev-channel

Foreman (#ios-dev-channel)
    → commit, push, /cc bitrise TestFlight

Foreman (#android-dev-channel)
    → commit, push, /cc bitrise BuildQaRelease
```

## One-Time Setup

1. Create `#ios-dev-channel`, `#android-dev-channel`, `#feature-channel`
2. Invite Foreman to all three
3. Set worker cwds:
   - `#ios-dev-channel`: `/cc cwd ~/path/to/ios-repo`
   - `#android-dev-channel`: `/cc cwd ~/path/to/android-repo`
4. Create Slack Workflow 1 (engineer approval → dispatch)
5. Create Slack Workflow 2 (designer approval → ship)
6. Configure webhook server URL in Slack Workflow 1
