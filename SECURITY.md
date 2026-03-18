# Foreman Security Concerns

Tracking security concerns for enterprise deployment. Each item includes the risk, current status, and how it was (or will be) addressed.

## Access Control

| # | Concern | Status | Resolution |
|---|---------|--------|------------|
| 1 | No user-level auth — anyone in a Slack channel can send commands | Mitigated | Enterprise SSO: workspace membership = authorization |
| 2 | Anyone can tap Approve/Deny buttons | Fixed | Only the message sender can approve/deny their own tool calls (v1.1.7) |
| 3 | `/cc cwd` — anyone in a channel can point Foreman at any directory | Open | No restriction on path access yet |
| 4 | `/cc reboot` — anyone can restart the process | Open | No restriction on who can issue control commands |
| 5 | `/cc new` — anyone can clear a session | Open | No restriction on who can reset sessions |

## Data Exposure

| # | Concern | Status | Resolution |
|---|---------|--------|------------|
| 6 | Auto-approved reads — Read/Glob/Grep can access any file the process user can access (`.ssh`, `.env`, credentials) | Open | No filesystem sandboxing or path restrictions |
| 7 | API keys stored in plaintext — `~/.foreman/config.json` has Anthropic key and Slack tokens unencrypted | Open | No encryption or secret management |
| 8 | Session state on disk — `~/.foreman/sessions.json` is plaintext | Open | No encryption of persisted state |

## Cost / Abuse

| # | Concern | Status | Resolution |
|---|---------|--------|------------|
| 9 | No rate limiting — anyone can spam the bot and rack up API costs | Open | No per-user or per-channel rate limits |
| 10 | No spending caps — no built-in way to limit monthly spend | Open | Relies on Anthropic dashboard limits |

## Architectural

| # | Concern | Status | Resolution |
|---|---------|--------|------------|
| 11 | Remote code execution — Foreman gives Slack users shell access to host Mac (with approval tap) | Mitigated | Approval buttons restricted to message sender; but Bash tool still executes arbitrary commands once approved |
| 12 | Single process / single host — no horizontal scaling, no redundancy | Open | Single-user design; not yet enterprise-scale |
| 13 | No audit logging — no record of who ran what, when, or what was approved | Open | No audit trail beyond Slack message history |

## Changelog

- **v1.1.7** — Approve/Deny buttons restricted to the user who sent the triggering message (#2, #11)
