/**
 * FlowSpec Compiler — interprets a FlowSpec AST as a Temporal workflow.
 *
 * Pure logic (interpolation, conditions, means augmentation) lives in
 * runtime.ts so it can be tested outside the Temporal sandbox.
 * This file handles only the Temporal-specific orchestration.
 */

import {
  proxyActivities,
  executeChild,
  defineSignal,
  setHandler,
  condition,
} from '@temporalio/workflow';
import type * as activities from '../temporal/activities.js';
import type {
  Workflow,
  Step,
  AskStep,
  SendStep,
  ParallelStep,
  RaceStep,
  ForEachStep,
  RepeatUntilStep,
  IfStep,
  ApprovalStep,
  RunStep,
  ReadFileStep,
  WriteFileStep,
} from './ast.js';
import {
  interpolate,
  resolveBot,
  evaluateCondition,
  buildMeansMap,
} from './runtime.js';

// ── Activity proxies ─────────────────────────────────────────────────────────

const defaultActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '60 seconds',
});

const { dispatchToBot, postStatus, resetBotSession, readFlowFile, writeFlowFile } = defaultActivities;

/** Create a dispatchToBot proxy with per-step timeout and retry options. */
function dispatchWithOptions(timeout?: string, retries?: number) {
  if (!timeout && !retries) return dispatchToBot;
  return proxyActivities<typeof activities>({
    startToCloseTimeout: (timeout || '15 minutes') as import('@temporalio/common').Duration,
    heartbeatTimeout: '60 seconds',
    retry: retries != null ? { maximumAttempts: retries + 1 } : undefined,
  }).dispatchToBot;
}

// ── Signals ──────────────────────────────────────────────────────────────────

export const approvalSignal = defineSignal<[boolean, string?]>('flowspec.approval');

// ── Types ────────────────────────────────────────────────────────────────────

interface FlowContext {
  vars: Record<string, string>;
  botRegistry: Record<string, string>;
  allWorkflows: Workflow[];
  reportChannelId?: string;
  resetBots: Set<string>;       // channels already reset in this workflow run
  meansMap: Map<string, string[]>;
}

class FlowStop {
  constructor(public message?: string) {}
}

// ── Main Workflow ────────────────────────────────────────────────────────────

export async function flowspecWorkflow(
  workflows: Workflow[],
  workflowName: string,
  inputs: Record<string, string>,
  botRegistry: Record<string, string>,
  reportChannelId?: string,
): Promise<Record<string, string>> {
  const workflow = workflows.find((w) => w.name === workflowName);
  if (!workflow) {
    throw new Error(
      `Workflow "${workflowName}" not found. Available: ${workflows.map((w) => w.name).join(', ')}`,
    );
  }

  const ctx: FlowContext = {
    vars: { ...inputs },
    botRegistry,
    allWorkflows: workflows,
    reportChannelId,
    meansMap: buildMeansMap(workflow),
    resetBots: new Set(),
  };

  let approvalResult: { approved: boolean; reason: string } | null = null;
  setHandler(approvalSignal, (approved: boolean, reason?: string) => {
    approvalResult = { approved, reason: reason || '' };
  });
  (ctx as any).__approvalResult = () => approvalResult;
  (ctx as any).__resetApproval = () => { approvalResult = null; };

  try {
    await executeSteps(ctx, workflow.steps);
  } catch (e) {
    if (e instanceof FlowStop) {
      if (e.message) ctx.vars.__stopReason = e.message;
      if (reportChannelId) {
        await postStatus(reportChannelId, `⏹️ Workflow stopped: ${e.message || '(no reason)'}`);
      }
    } else {
      throw e;
    }
  }

  return ctx.vars;
}

// ── Transport helpers ─────────────────────────────────────────────────────────

/**
 * Derive transport prefix from a reportChannelId.
 * "mm:C123" → "mm", "C123" → undefined
 */
function getTransport(reportChannelId?: string): string | undefined {
  if (!reportChannelId) return undefined;
  const colon = reportChannelId.indexOf(':');
  return colon === -1 ? undefined : reportChannelId.slice(0, colon);
}

// ── Step Execution ───────────────────────────────────────────────────────────

async function executeSteps(ctx: FlowContext, steps: Step[]): Promise<void> {
  for (const step of steps) {
    await executeStep(ctx, step);
  }
}

async function executeStep(ctx: FlowContext, step: Step): Promise<void> {
  switch (step.type) {
    case 'ask':
      return executeAsk(ctx, step);
    case 'send':
      return executeSend(ctx, step);
    case 'parallel':
      return executeParallel(ctx, step);
    case 'race':
      return executeRace(ctx, step);
    case 'for_each':
      return executeForEach(ctx, step);
    case 'repeat_until':
      return executeRepeatUntil(ctx, step);
    case 'if':
      return executeIf(ctx, step);
    case 'approval':
      return executeApproval(ctx, step);
    case 'run':
      return executeRun(ctx, step);
    case 'read_file':
      return executeReadFile(ctx, step);
    case 'write_file':
      return executeWriteFile(ctx, step);
    case 'stop':
      throw new FlowStop(step.message ? interpolate(ctx.vars, step.message) : undefined);
  }
}

// ── ask ──────────────────────────────────────────────────────────────────────

const DEEP_PREFIX = 'Think very deeply. Take your time.\n\n';
const DEEP_TIMEOUT = '45 minutes';

async function executeAsk(ctx: FlowContext, step: AskStep): Promise<void> {
  const channelId = resolveBot(ctx.botRegistry, step.bot, getTransport(ctx.reportChannelId));
  const isDeep = ctx.vars.__deep === 'true';
  const prompt = (isDeep ? DEEP_PREFIX : '') + interpolate(ctx.vars, step.prompt);
  const dispatch = dispatchWithOptions(isDeep ? DEEP_TIMEOUT : step.timeout, step.retries);

  // Reset bot session on first dispatch per workflow run
  if (!ctx.resetBots.has(channelId)) {
    await resetBotSession(channelId);
    ctx.resetBots.add(channelId);
  }

  let result: string;
  try {
    result = await dispatch(channelId, prompt);
  } catch (err) {
    // Temporal throws TimeoutFailure for startToCloseTimeout breaches
    const isTimeout = err instanceof Error && err.constructor.name === 'TimeoutFailure';
    if (isTimeout && step.timeoutHandler) {
      await executeSteps(ctx, step.timeoutHandler);
      return;
    }
    if (step.failHandler) {
      await executeSteps(ctx, step.failHandler);
      return;
    }
    throw err;
  }

  if (step.capture) {
    ctx.vars[step.capture] = result;

    const meansValues = ctx.meansMap.get(step.capture);
    if (meansValues) {
      const classPrompt = `Based on your previous response, reply with ONLY one of: ${meansValues.join(', ')}`;
      const classification = await dispatchToBot(channelId, classPrompt);
      ctx.vars[`__class_${step.capture}`] = classification.trim().toLowerCase();
    }
  }
}

// ── send ─────────────────────────────────────────────────────────────────────

async function executeSend(ctx: FlowContext, step: SendStep): Promise<void> {
  const message = interpolate(ctx.vars, step.message);
  let channelId: string;
  if (step.targetType === 'channel') {
    channelId = ctx.botRegistry[step.target] || step.target;
  } else {
    channelId = resolveBot(ctx.botRegistry, step.target, getTransport(ctx.reportChannelId));
  }
  await postStatus(channelId, message);
}

// ── parallel ─────────────────────────────────────────────────────────────────

async function executeParallel(ctx: FlowContext, step: ParallelStep): Promise<void> {
  const results = await Promise.allSettled(
    step.branches.map((branch, i) => {
      const branchCtx = cloneContext(ctx);
      return executeSteps(branchCtx, branch).then(() => branchCtx);
    }),
  );

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      Object.assign(ctx.vars, r.value.vars);
      succeeded++;
    } else {
      failed++;
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }

  ctx.vars['__parallel_total'] = String(results.length);
  ctx.vars['__parallel_succeeded'] = String(succeeded);
  ctx.vars['__parallel_failed'] = String(failed);
  if (errors.length > 0) {
    ctx.vars['__parallel_errors'] = errors.join('; ');
  }
}

// ── race ─────────────────────────────────────────────────────────────────────

async function executeRace(ctx: FlowContext, step: RaceStep): Promise<void> {
  const winner = await Promise.race(
    step.branches.map((branch) => {
      const branchCtx = cloneContext(ctx);
      return executeSteps(branchCtx, branch).then(() => branchCtx);
    }),
  );
  Object.assign(ctx.vars, winner.vars);
}

// ── for each ─────────────────────────────────────────────────────────────────

async function executeForEach(ctx: FlowContext, step: ForEachStep): Promise<void> {
  const listStr = ctx.vars[step.listVar] || '';
  // If list contains newlines, split on newlines only (preserves commas within items).
  // If no newlines, split on commas. This enables nested for-each loops.
  const delimiter = listStr.includes('\n') ? /\n+/ : /,+/;
  const items = listStr.split(delimiter).map((s) => s.trim()).filter(Boolean);
  const collected: string[] = [];

  if (step.concurrency && step.concurrency > 1) {
    for (let i = 0; i < items.length; i += step.concurrency) {
      const batch = items.slice(i, i + step.concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          const branchCtx = cloneContext(ctx);
          branchCtx.vars[step.itemVar] = item;
          await executeSteps(branchCtx, step.body);
          return step.collectVar ? branchCtx.vars[step.collectVar] || '' : '';
        }),
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled' && step.collectVar) collected.push(r.value);
        if (r.status === 'rejected' && step.stopOnFailure) {
          storeCollected(ctx, step, collected);
          throw r.reason;
        }
      }
    }
  } else {
    for (const item of items) {
      ctx.vars[step.itemVar] = item;
      try {
        await executeSteps(ctx, step.body);
        if (step.collectVar) collected.push(ctx.vars[step.collectVar] || '');
      } catch (err) {
        if (step.stopOnFailure) {
          storeCollected(ctx, step, collected);
          throw err;
        }
      }
    }
  }

  storeCollected(ctx, step, collected);
}

function storeCollected(ctx: FlowContext, step: ForEachStep, collected: string[]): void {
  if (collected.length === 0) return;
  const joined = collected.join('\n\n---\n\n');
  if (step.collectAs) {
    ctx.vars[step.collectAs] = joined;
  } else if (step.collectVar) {
    ctx.vars[step.collectVar + 's'] = joined;
  }
}

// ── repeat until ─────────────────────────────────────────────────────────────

async function executeRepeatUntil(ctx: FlowContext, step: RepeatUntilStep): Promise<void> {
  for (let i = 0; i < step.maxIterations; i++) {
    await executeSteps(ctx, step.body);
    if (evaluateCondition(ctx.vars, step.condition)) return;
  }
  if (step.noConvergeHandler) {
    await executeSteps(ctx, step.noConvergeHandler);
  }
}

// ── if / otherwise ───────────────────────────────────────────────────────────

async function executeIf(ctx: FlowContext, step: IfStep): Promise<void> {
  if (evaluateCondition(ctx.vars, step.condition)) {
    await executeSteps(ctx, step.body);
    return;
  }
  if (step.otherwiseIfs) {
    for (const branch of step.otherwiseIfs) {
      if (evaluateCondition(ctx.vars, branch.condition)) {
        await executeSteps(ctx, branch.body);
        return;
      }
    }
  }
  if (step.otherwise) {
    await executeSteps(ctx, step.otherwise);
  }
}

// ── approval ─────────────────────────────────────────────────────────────────

async function executeApproval(ctx: FlowContext, step: ApprovalStep): Promise<void> {
  const message = interpolate(ctx.vars, step.message);
  const targetChannel = ctx.reportChannelId || Object.values(ctx.botRegistry)[0] || '';

  const resetApproval = (ctx as any).__resetApproval as () => void;
  const getApproval = (ctx as any).__approvalResult as () => { approved: boolean; reason: string } | null;
  resetApproval();

  await postStatus(
    targetChannel,
    `⏸️ *Approval needed:* ${message}\n\n_Send signal \`flowspec.approval\` with \`[true]\` to approve or \`[false, "reason"]\` to reject._`,
  );

  await condition(() => getApproval() !== null);

  const result = getApproval()!;
  if (!result.approved && step.rejectHandler) {
    if (step.rejectCapture) {
      ctx.vars[step.rejectCapture] = result.reason;
    }
    await executeSteps(ctx, step.rejectHandler);
  }
}

// ── run (child workflow) ─────────────────────────────────────────────────────

async function executeRun(ctx: FlowContext, step: RunStep): Promise<void> {
  const childInputs: Record<string, string> = {};
  if (step.args) {
    for (const [key, valueTemplate] of Object.entries(step.args)) {
      childInputs[key] = interpolate(ctx.vars, valueTemplate);
    }
  }

  const result = await executeChild<typeof flowspecWorkflow>('flowspecWorkflow', {
    args: [ctx.allWorkflows, step.workflowName, childInputs, ctx.botRegistry, ctx.reportChannelId],
  });

  if (step.capture) {
    // Named capture: serialize child's public vars under the capture name
    const publicVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(result)) {
      if (!key.startsWith('__')) publicVars[key] = value;
    }
    ctx.vars[step.capture] = JSON.stringify(publicVars);
  } else {
    // No capture: merge child vars into parent (backward compat)
    for (const [key, value] of Object.entries(result)) {
      if (!key.startsWith('__')) {
        ctx.vars[key] = value;
      }
    }
  }
}

// ── read file ─────────────────────────────────────────────────────────────────

async function executeReadFile(ctx: FlowContext, step: ReadFileStep): Promise<void> {
  const filePath = interpolate(ctx.vars, step.path);
  const content = await readFlowFile(filePath);
  ctx.vars[step.capture] = content;
}

// ── write file ────────────────────────────────────────────────────────────────

async function executeWriteFile(ctx: FlowContext, step: WriteFileStep): Promise<void> {
  const filePath = interpolate(ctx.vars, step.path);
  const content = ctx.vars[step.variable] || '';
  await writeFlowFile(filePath, content);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cloneContext(ctx: FlowContext): FlowContext {
  return {
    vars: { ...ctx.vars },
    botRegistry: ctx.botRegistry,
    allWorkflows: ctx.allWorkflows,
    reportChannelId: ctx.reportChannelId,
    meansMap: ctx.meansMap,
    resetBots: ctx.resetBots,  // shared — don't re-reset in branches
  };
}
