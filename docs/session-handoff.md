# Session Handoff — 2026-04-13

## What was done this session

Completed the foreman-toolbelt modularization refactor. The monolithic `mcp-canvas.ts`
(~1092 lines, all tools inline) has been split into 6 domain-specific files plus a thin
orchestrator.

### New domain files created
| File | Server name | Tools |
|------|-------------|-------|
| `src/mcp-slack.ts` | `foreman-slack` | 13 tools: CanvasList, CanvasRead, CanvasFindSection, CanvasCreate, CanvasAppend, CanvasDelete, CanvasReadById, CanvasUpdateElementById, CanvasDeleteElementById, PostMessage, GetCurrentChannel, ReadChannel, DiagramCreate |
| `src/mcp-atlassian.ts` | `foreman-atlassian` | 13 Jira tools + 4 Confluence tools |
| `src/mcp-github.ts` | `foreman-github` | GitHubCreatePR, GitHubReadPR, GitHubReadIssue, GitHubSearch, GitHubListPRs |
| `src/mcp-bitrise.ts` | `foreman-bitrise` | TriggerBitrise |
| `src/mcp-admin.ts` | `foreman-admin` | SelfReboot |
| `src/mcp-xcode.ts` | `foreman-xcode` | LaunchApp |

### Updated files
- `src/mcp-canvas.ts` — now a thin orchestrator (~55 lines); imports from all domain files
- `src/bots.ts` — added `mcp_servers?: string[]` to `SdkBot` interface
- `src/mattermost.ts` — BotConfig gets `mcpServers`, passed to `createCanvasMcpServer`

### Backward compatibility
- `createCanvasMcpServer()` signature unchanged — all callers work without modification
- Default behavior (no `enabledServers`) loads ALL tools — same as before
- Per-bot tool scoping: add `mcp_servers: [foreman-slack, foreman-atlassian]` to a bot in `bots.yaml`

### Build status
- `npm run build` → clean, zero errors
- Smoke test: server starts, `/health` returns `{"status":"ok"}`

## After reboot — verify
1. Check Mattermost bot responds in a channel
2. Confirm canvas tools work (CanvasRead / CanvasAppend)
3. Confirm Jira tools work (JiraSearch)
4. Update `docs/memory/project_foreman_2.md` health status → ✅ STABLE

## Rollback (if reboot fails)
```bash
cd ~/claude-slack-bridge
git checkout 2c6cf44 -- src/mcp-canvas.ts src/bots.ts src/mattermost.ts
rm -f src/mcp-slack.ts src/mcp-atlassian.ts src/mcp-github.ts src/mcp-bitrise.ts src/mcp-admin.ts src/mcp-xcode.ts
npm run build
```
