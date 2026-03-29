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
} from './ast.js';
import {
  interpolate,
  resolveBot,
  evaluateCondition,
  buildMeansMap,
} from './runtime.js';

// ── Activity proxies ─────────────────────────────────────────────────────────

const { dispatchToBot, postStatus } = proxyActivities<typeof activities>({
  startToCloseTimeout: '15 minutes',
  heartbeatTimeout: '60 seconds',
});

// ── Signals ──────────────────────────────────────────────────────────────────

export const approvalSignal = defineSignal<[boolean, string?]>('flowspec.approval');

// ── Types ────────────────────────────────────────────────────────────────────

interface FlowContext {
  vars: Record<string, string>;
  botRegistry: Record<string, string>;
  allWorkflows: Workflow[];
  reportChannelId?: string;
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
    case 'stop':
      throw new FlowStop(step.message ? interpolate(ctx.vars, step.message) : undefined);
  }
}

// ── ask ──────────────────────────────────────────────────────────────────────

async function executeAsk(ctx: FlowContext, step: AskStep): Promise<void> {
  const channelId = resolveBot(ctx.botRegistry, step.bot);
  const prompt = interpolate(ctx.vars, step.prompt);

  let result: string;
  try {
    result = await dispatchToBot(channelId, prompt);
  } catch (err) {
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
    channelId = resolveBot(ctx.botRegistry, step.target);
  }
  await postStatus(channelId, message);
}

// ── parallel ─────────────────────────────────────────────────────────────────

async function executeParallel(ctx: FlowContext, step: ParallelStep): Promise<void> {
  await Promise.allSettled(
    step.branches.map((branch) => {
      const branchCtx = cloneContext(ctx);
      return executeSteps(branchCtx, branch).then(() => {
        Object.assign(ctx.vars, branchCtx.vars);
      });
    }),
  );
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
  const items = listStr.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function cloneContext(ctx: FlowContext): FlowContext {
  return {
    vars: { ...ctx.vars },
    botRegistry: ctx.botRegistry,
    allWorkflows: ctx.allWorkflows,
    reportChannelId: ctx.reportChannelId,
    meansMap: ctx.meansMap,
  };
}
