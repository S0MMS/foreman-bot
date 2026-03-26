/**
 * Temporal Workflows — define the sequence of steps.
 * Workflows are durable: if Foreman restarts mid-workflow,
 * Temporal replays from the last completed step.
 *
 * NOTE: Workflows run in a sandboxed environment.
 * All external calls must go through Activities.
 */

import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities.js';

// Short-lived activities: Slack API calls, dispatch, collection (~1-2 minutes max)
const {
  greet,
  postStatus,
  getEpochSec,
  runClaudeInChannel,
  collectWorkerMessages,
  collectJudgeMessage,
  postCompletion,
} = proxyActivities<typeof activities>({ startToCloseTimeout: '2 minutes' });

// Long-running activities: polling loops (up to 20 minutes + buffer)
const { waitForWorkers, waitForJudge } = proxyActivities<typeof activities>({
  startToCloseTimeout: '25 minutes',
  heartbeatTimeout: '30 seconds',
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DelphiWorkflowParams {
  question: string;
  workerIds: string[];
  judgeChannelId: string;
  mode: 'code' | 'research' | 'design';
  deep: boolean;
  contextPath: string | null;
  startEpochMs: number;
}

// ── Prompt builders ───────────────────────────────────────────────────────────
// Pure functions — deterministic string operations are safe in the workflow sandbox.

function ctxNote(contextPath: string | null): string {
  return contextPath
    ? `\n\nBefore answering, read this file for background context:\n- ${contextPath}`
    : '';
}

function thinkSuffix(deep: boolean): string {
  return deep
    ? '\n\nThink deeply about this. Write your complete analysis and recommendation in full in your response — do not assume your reasoning is visible to others.'
    : '';
}

function buildPhase1WorkerPrompt(p: DelphiWorkflowParams): string {
  const ctx = ctxNote(p.contextPath);
  const think = thinkSuffix(p.deep);
  if (p.mode === 'research') {
    return `Your goal is to provide the most complete and accurate answer to this question, drawing on your knowledge and expertise.${ctx}\n\nEnumerate all relevant options, explain tradeoffs, and cover approaches the questioner may not have considered. Be thorough and specific.\n\nQuestion: ${p.question}${think}`;
  }
  if (p.mode === 'design') {
    return `Your goal is to propose the best solution to this design problem.${ctx}\n\nResearch the available options, evaluate them against the real constraints you find, and recommend a specific approach with clear rationale. Consider implementation complexity, risk, and fit with the existing system.\n\nDesign question: ${p.question}${think}`;
  }
  return `Your goal is to provide the best possible answer to this question. This is a fresh, independent request — do not reference anything from prior conversations.${ctx}\n\nUse your file reading tools (Read, Glob, Grep, Bash) to thoroughly explore the source code in your working directory. Do not answer from memory or general knowledge — ground your answer entirely in what you actually find in the code.\n\nQuestion: ${p.question}${think}`;
}

function buildPhase1JudgePrompt(
  p: DelphiWorkflowParams,
  workerAnswers: Array<{ channelId: string; text: string }>,
): string {
  const ctx = ctxNote(p.contextPath);
  const think = thinkSuffix(p.deep);
  const summary = workerAnswers
    .map((w, i) => `**Worker ${i + 1} (<#${w.channelId}>):**\n${w.text}`)
    .join('\n\n---\n\n');
  const n = workerAnswers.length;
  if (p.mode === 'research') {
    return `${n} worker(s) researched this question: "${p.question}"${ctx}\n\nHere are their answers:\n\n${summary}\n\nYour job is to improve on these answers, not just blend them. Evaluate each for:\n- Completeness: are important options or considerations missing?\n- Accuracy: is any reasoning weak, outdated, or unsupported?\n- Depth: what would a domain expert add?\n\nWrite a comprehensive answer that is better than any individual worker response — filling gaps, correcting weak reasoning, and adding expert-level insight.${think}`;
  }
  if (p.mode === 'design') {
    return `${n} worker(s) proposed solutions to this design problem: "${p.question}"${ctx}\n\nHere are their proposals:\n\n${summary}\n\nYour job is to evaluate FEASIBILITY, not just summarize. For each proposal:\n- Does it actually satisfy the real system constraints?\n- What are the implementation risks?\n- What is missing or underspecified?\n\nThen recommend the strongest approach — or a synthesis of the best elements — with clear rationale grounded in the actual system constraints.${think}`;
  }
  return `${n} worker(s) answered this question: "${p.question}"\n\nHere are their answers:\n\n${summary}\n\nYour job is NOT to summarize or blend these answers. Your job is to VERIFY every claim against the actual source code.\n\nFor each claim made by the workers:\n- Use Read, Glob, Grep, and Bash to find the relevant code\n- Label it CORRECT (cite the file/line that confirms it), INCORRECT (state what the code actually shows and why the claim is wrong), or INCOMPLETE (confirm what is right, then add what is missing from the code)\n\nAfter verifying all claims, write a final answer containing only what you could confirm in the source code. If a worker claim was wrong, explicitly state why — this helps future reasoning sessions avoid the same mistake.${think}`;
}

function buildPhase2WorkerPrompt(p: DelphiWorkflowParams, judgeSynthesis: string): string {
  const think = thinkSuffix(p.deep);
  if (p.mode === 'research') {
    return `Your goal is to critically evaluate this research answer and improve it.\n\nThe question was: "${p.question}"\n\nA judge produced this answer:\n${judgeSynthesis}\n\nIdentify: What important options or considerations are missing? Is any reasoning flawed or unsupported? What would a domain expert add or change? Be specific.${think}`;
  }
  if (p.mode === 'design') {
    return `Your goal is to stress-test this design recommendation.\n\nThe design question was: "${p.question}"\n\nThe judge recommended:\n${judgeSynthesis}\n\nChallenge this recommendation: Does it actually work given the real constraints? Are there risks the judge underestimated? Are there better alternatives that were overlooked? Be specific and constructive.${think}`;
  }
  return `Your goal is to critically evaluate this answer and help produce the best possible final response.\n\nThe question was: "${p.question}"\n\nA judge produced this answer:\n${judgeSynthesis}\n\nUse your file reading tools (Read, Glob, Grep, Bash) to verify the claims against the actual source code. Be specific: what is correct, what is wrong, and what important details are missing?${think}`;
}

function buildPhase3JudgePrompt(
  p: DelphiWorkflowParams,
  judgeSynthesis: string,
  critiques: Array<{ channelId: string; text: string }>,
): string {
  const think = thinkSuffix(p.deep);
  const critiqueSummary =
    critiques
      .map((w, i) => `**Critique ${i + 1} (<#${w.channelId}>):**\n${w.text}`)
      .join('\n\n---\n\n') || '(No critiques received)';
  if (p.mode === 'research') {
    return `You produced a research answer to: "${p.question}"\n\nYour answer:\n\n${judgeSynthesis}\n\nExperts reviewed it and raised these critiques:\n\n${critiqueSummary}\n\nFor each critique, evaluate whether it is valid. Incorporate legitimate additions and corrections. Produce your final, most complete and accurate answer.${think}`;
  }
  if (p.mode === 'design') {
    return `You produced a design recommendation for: "${p.question}"\n\nYour recommendation:\n\n${judgeSynthesis}\n\nExperts stress-tested it and raised these challenges:\n\n${critiqueSummary}\n\nAddress each challenge. Refine your recommendation to account for valid concerns. Produce your final design recommendation with updated rationale.${think}`;
  }
  return `You previously verified worker answers to this question: "${p.question}"\n\nYour verified answer:\n\n${judgeSynthesis}\n\nWorkers have now reviewed your answer and raised these critiques:\n\n${critiqueSummary}\n\nFor each critique, use Read, Glob, Grep, and Bash to verify it against the actual source code. If the critique is correct, update your answer and explain what was wrong. If the critique is incorrect, state why — citing the code. Then write your final verified answer, grounded entirely in what the code actually shows.${think}`;
}

// ── Workflows ─────────────────────────────────────────────────────────────────

/** Hello workflow — simplest possible example. */
export async function helloWorkflow(name: string): Promise<string> {
  return await greet(name);
}

/**
 * Delphi workflow — 3-phase Delphi process.
 * Durable: survives Foreman restarts by replaying from the last completed activity.
 *
 * Phase 1: Workers answer the question independently.
 * Phase 1 Judge: Judge synthesizes/verifies worker answers.
 * Phase 2: Workers critique the judge's synthesis.
 * Phase 3: Judge produces final answer incorporating worker critiques.
 */
export async function delphiWorkflow(params: DelphiWorkflowParams): Promise<void> {
  const { workerIds, judgeChannelId, startEpochMs } = params;

  // ── Phase 1: Workers answer independently ────────────────────────────────────
  await postStatus(
    judgeChannelId,
    `:satellite: *Phase 1 — dispatching to ${workerIds.length} worker(s)...*`,
  );
  const p1Epoch = await getEpochSec();
  const phase1Prompt = buildPhase1WorkerPrompt(params);
  await Promise.all(workerIds.map((wId) => runClaudeInChannel(wId, phase1Prompt, judgeChannelId)));
  await waitForWorkers(workerIds, p1Epoch, params.mode, params.deep);
  await postStatus(judgeChannelId, `:white_check_mark: *Workers done — assessing answers...*`);
  const workerAnswers = await collectWorkerMessages(workerIds, p1Epoch);

  if (workerAnswers.length === 0) {
    await postStatus(
      judgeChannelId,
      `:warning: No worker answers collected. Delphi stopped after Phase 1.`,
    );
    return;
  }

  // ── Phase 1 Judge: Synthesize ────────────────────────────────────────────────
  await postStatus(judgeChannelId, `:mag: *Phase 1 — judge verifying worker answers...*`);
  const p1jEpoch = await getEpochSec();
  await runClaudeInChannel(
    judgeChannelId,
    buildPhase1JudgePrompt(params, workerAnswers),
    judgeChannelId,
  );
  await waitForJudge(judgeChannelId, p1jEpoch);
  const judgeSynthesis = await collectJudgeMessage(judgeChannelId, p1jEpoch);

  if (!judgeSynthesis) {
    await postStatus(
      judgeChannelId,
      `:warning: Judge did not respond in time. Delphi stopped after Phase 1.`,
    );
    return;
  }

  // ── Phase 2: Workers critique ────────────────────────────────────────────────
  await postStatus(
    judgeChannelId,
    `:satellite: *Phase 2 — dispatching critiques to ${workerIds.length} worker(s)...*`,
  );
  const p2Epoch = await getEpochSec();
  const phase2Prompt = buildPhase2WorkerPrompt(params, judgeSynthesis);
  await Promise.all(workerIds.map((wId) => runClaudeInChannel(wId, phase2Prompt, judgeChannelId)));
  await waitForWorkers(workerIds, p2Epoch, params.mode, params.deep);
  await postStatus(judgeChannelId, `:white_check_mark: *Workers done — writing final answer...*`);
  const workerCritiques = await collectWorkerMessages(workerIds, p2Epoch);

  // ── Phase 3: Judge revises ───────────────────────────────────────────────────
  await postStatus(judgeChannelId, `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n:checkered_flag:  *FINAL ANSWER*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  const p3jEpoch = await getEpochSec();
  await runClaudeInChannel(
    judgeChannelId,
    buildPhase3JudgePrompt(params, judgeSynthesis, workerCritiques),
    judgeChannelId,
  );
  await waitForJudge(judgeChannelId, p3jEpoch);
  await postCompletion(judgeChannelId, startEpochMs);
}
