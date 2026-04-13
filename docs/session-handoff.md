# Session Handoff — 2026-04-12 (Token usage in stats footer)

## What we were working on
Adding input/output token counts to the stats footer in both Mattermost and Slack transports.

## What was done
- Added `tokensIn`, `tokensOut` to `QueryResult` interface (AgentAdapter.ts + claude.ts)
- Anthropic adapter extracts `message.usage.input_tokens` / `output_tokens` from SDK result
- Gemini/OpenAI return 0 (no token tracking yet)
- Footer format: `Done in 4 turns | $0.0234 | 1,204 in / 1,643 out | 12s`
- Token counts only shown when > 0 (so Gemini/OpenAI show old format)

## Next steps
1. Verify footer shows tokens after reboot
2. Commit and push
3. Discuss BI layer plan — Chris has additional ideas
