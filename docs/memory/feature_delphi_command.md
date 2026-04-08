---
name: /cc delphi command implementation
description: Fully automated 3-phase Delphi multi-model verification command for Foreman
type: project
---

## Overview
`/cc delphi #worker1 #worker2 <question>` — automated 3-phase Delphi process.
- The channel where the command is invoked = the **judge** channel
- Worker channels post their answers back to the judge channel
- Same workers used for all 3 phases

## 3 Phases
1. **Phase 1 (quorum)**: Workers answer the question independently → judge synthesizes
2. **Phase 2 (verify)**: Workers critique the judge's synthesis → post critiques
3. **Phase 3 (revise)**: Judge revises its answer incorporating the critiques

## Key Design Decisions
- Workers are told to post their ENTIRE answer as a SINGLE message (prevents multi-chunk polling issues)
- Judge is told "Do not use any tools — just respond directly" (prevents judge from searching for channels)
- `isDelphiMeta` filter skips cost/meta lines (`_N turns | $X.XXXX_`) AND messages < 100 chars
- `pollForBotMessages` polls judge channel for N substantive bot messages after a timestamp
  - 10s poll interval, 30s settle window (waits 30s after detecting N messages to catch stragglers)
  - 5-min timeout per phase
- Same worker channels used for Phase 2 as Phase 1 (by user request)

## Worker Prompt Template
```
You are participating in a multi-model Delphi verification process. This is a new, independent request — do not reference or repeat any previous answers from prior conversations. Answer this question fresh and completely, then post your ENTIRE answer as a SINGLE message to <#${judgeChannel}>. Do not split your answer across multiple messages. This process may be automated in future rounds.

Question: ${question}
```

## Phase 2 Worker Prompt Template
```
You are participating in a multi-model Delphi verification process. An AI judge synthesized the following answer. Critically review it — what is correct, what is missing or inaccurate? Post your critique as a SINGLE message to <#${judgeChannel}>.

Judge's synthesis:
${judgeSynthesis}
```

## Phase 3 Judge Prompt Template
```
You previously synthesized an answer as part of a Delphi verification process. AI workers have reviewed your synthesis and posted critiques. Your original synthesis:

${judgeSynthesis}

Worker critiques:

${critiqueSummary}

Revise your answer to incorporate valid feedback, correct any errors, and fill in any identified gaps. Respond directly with your final revised answer. Do not use any tools.
```

## pollForBotMessages Helper
```ts
const isDelphiMeta = (m: any) =>
  !m.text ||
  /_\d+ turns \| \$[\d.]+_/.test(m.text) ||
  m.text.length < 100;

const pollForBotMessages = async (afterTs: string, minCount: number): Promise<any[]> => {
  const POLL_MS = 10_000;
  const SETTLE_MS = 30_000;
  const PHASE_TIMEOUT = 5 * 60_000;
  const deadline = Date.now() + PHASE_TIMEOUT;
  let settleDeadline: number | null = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS));
    try {
      const hist = await app.client.conversations.history({ channel, oldest: afterTs, limit: 50 });
      const msgs = (hist.messages || []).filter((m: any) => m.bot_id && m.ts > afterTs && !isDelphiMeta(m));
      if (msgs.length >= minCount) {
        if (settleDeadline === null) {
          settleDeadline = Date.now() + SETTLE_MS;
        } else if (Date.now() >= settleDeadline) {
          return msgs;
        }
      }
    } catch { /* ignore poll errors */ }
  }
  // Timeout fallback
  try {
    const hist = await app.client.conversations.history({ channel, oldest: afterTs, limit: 50 });
    return (hist.messages || []).filter((m: any) => m.bot_id && m.ts > afterTs && !isDelphiMeta(m));
  } catch { return []; }
};
```

## Channel Parsing
Same pattern as `/cc quorum` — iterates through args, strips commas, matches `<#CHANNELID>` or `#name` patterns, stops at first non-channel arg:
```ts
const rawChannels: string[] = [];
let qIdx = 1;
for (let i = 1; i < args.length; i++) {
  const clean = args[i].replace(/,/g, "");
  if (/<#[A-Z0-9]+/.test(clean) || /^[A-Z0-9]{8,}$/.test(clean) || clean.startsWith("#")) {
    rawChannels.push(args[i]);
    qIdx = i + 1;
  } else break;
}
const question = args.slice(qIdx).join(" ").trim();
```

## Status Messages Posted During Run
- `:brain: *Delphi started* — 3-phase automated process with N worker(s).`
- `:hourglass_flowing_sand: *Phase 1* — waiting for N worker response(s)...`
- `:scales: *Phase 1 complete* — judge is synthesizing N worker response(s)...`
- `:mag: *Phase 2* — dispatching workers to critique the judge's synthesis...`
- `:hourglass_flowing_sand: *Phase 2* — waiting for worker critiques...`
- `:pencil2: *Phase 3* — judge revising with worker feedback...`

## Known Issues / Gotchas
- Long-running async loop — `delphiLoop()` runs fire-and-forget via `.catch()`
- Worker messages to the judge channel are filtered by `bot_id` — only bot messages counted
- `Slack conversations.history` returns newest-first; reverse to get chronological order
- The polling uses the judge channel (`channel`) — make sure worker bots post TO the judge channel

## Re-implementation Order
1. First verify the `setSessionId` fix works (and that `/cc model` clears sessionId)
2. Then add `case "delphi"` after `case "quorum"` in `slack.ts`
3. The `pollForBotMessages` helper is defined inside the `case "delphi"` block (closure over `app`, `channel`, `isDelphiMeta`)
4. `delphiLoop()` is also defined inside the case block and called with `.catch()`
