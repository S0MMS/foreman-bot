# Connect to MFP Slack — Setup & Verification

## Status: COMPLETE ✅ (2026-03-21)

The MFP Slack MCP is fully connected and verified. Foreman can search channels, read history, look up users, and send messages/DMs in the MyFitnessPal workspace.

---

## How It Was Set Up

1. Went to `claude.ai` → Settings → Integrations → Slack
2. Disconnected the personal **B L A C K L A B** workspace
3. Re-authorized with MFP Slack account (`chris.shreve@myfitnesspal.com`)
4. The `claudeai-proxy` MCP in `AnthropicAdapter.ts` now routes to MFP

## What's Wired In

The Slack MCP is in `src/adapters/AnthropicAdapter.ts` via `buildMcpServers()`:

```typescript
servers["slack"] = {
  type: "claudeai-proxy",
  url: "https://mcp.slack.com/mcp",
  id: "slack"
};
```

Every Claude session spawned by Foreman automatically gets these Slack tools:
- `slack_search_channels` — find channels by name
- `slack_search_users` — find users by name/email
- `slack_read_channel` — read message history
- `slack_send_message` — post messages or DMs
- `slack_search_public` — search messages across channels

## Verified

- `#all-hands` found ✅
- `#engineering` found ✅
- `chris.shreve` user lookup ✅
- DM sent to Chris successfully ✅

## Notes

- **Foreman's bot token** (`xoxb-` in `.env`) is still B L A C K L A B — this is what powers Foreman itself (receiving/posting messages). Unaffected.
- **The Slack MCP** (`claude.ai` OAuth) is now MFP — this gives Claude sessions read/write access to MFP Slack.
- `search:read` scope works — full message search is available.
