/**
 * FlowSpec Runtime — pure functions used by the compiler/interpreter.
 *
 * Extracted into a separate module so they can be tested outside
 * the Temporal workflow sandbox. No Temporal imports here.
 */

import type { Workflow, Step, Condition, ConditionExpr } from './ast.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FlowVars {
  [key: string]: string;
}

// ── Variable Interpolation ───────────────────────────────────────────────────

/** Replace {varName} placeholders with values from the variable map. */
export function interpolate(vars: FlowVars, template: string): string {
  return template.replace(/\{(\w+)\}/g, (_, varName) => vars[varName] || '');
}

// ── Bot Registry ─────────────────────────────────────────────────────────────

/** Resolve a bot name to a Slack channel ID. Throws if not found. */
export function resolveBot(botRegistry: Record<string, string>, botName: string): string {
  const channelId = botRegistry[botName];
  if (!channelId) {
    throw new Error(
      `Bot "${botName}" not found in registry. Available: ${Object.keys(botRegistry).join(', ')}`,
    );
  }
  return channelId;
}

// ── Condition Evaluation ─────────────────────────────────────────────────────

/** Evaluate a FlowSpec condition expression (single or compound). */
export function evaluateCondition(vars: FlowVars, cond: ConditionExpr): boolean {
  if ('and' in cond) return cond.and.every(c => evaluateCondition(vars, c));
  if ('or' in cond) return cond.or.some(c => evaluateCondition(vars, c));
  return evaluateSingleCondition(vars, cond);
}

/** Evaluate a single (leaf) condition. */
function evaluateSingleCondition(vars: FlowVars, cond: Condition): boolean {
  const value = vars[cond.variable] || '';

  switch (cond.op) {
    case 'is empty':
      return value.trim() === '';
    case 'is not empty':
      return value.trim() !== '';
    case 'contains':
      return value.toLowerCase().includes((cond.value || '').toLowerCase());
    case 'equals':
      return value.trim() === (cond.value || '').trim();
    case 'is above':
      return parseFloat(value) > parseFloat(cond.value || '0');
    case 'is below':
      return parseFloat(value) < parseFloat(cond.value || '0');
    case 'means': {
      const classification = vars[`__class_${cond.variable}`] || '';
      return classification.toLowerCase().trim() === (cond.value || '').toLowerCase().trim();
    }
  }
}

// ── Means Operator — Map Builder ─────────────────────────────────────────────

/**
 * Walk the AST and collect all `means` conditions into a map of
 * variable name → list of classification values.
 * Used by the compiler to know which captured variables need a follow-up
 * classification call after the ask step completes.
 */
export function buildMeansMap(workflow: Workflow): Map<string, string[]> {
  const meansMap = new Map<string, string[]>();
  collectMeansConditions(workflow.steps, meansMap);
  return meansMap;
}

function collectMeansConditions(steps: Step[], meansMap: Map<string, string[]>): void {
  for (const step of steps) {
    switch (step.type) {
      case 'if':
        addMeans(step.condition, meansMap);
        collectMeansConditions(step.body, meansMap);
        step.otherwiseIfs?.forEach((b) => {
          addMeans(b.condition, meansMap);
          collectMeansConditions(b.body, meansMap);
        });
        if (step.otherwise) collectMeansConditions(step.otherwise, meansMap);
        break;
      case 'repeat_until':
        addMeans(step.condition, meansMap);
        collectMeansConditions(step.body, meansMap);
        if (step.noConvergeHandler) collectMeansConditions(step.noConvergeHandler, meansMap);
        break;
      case 'parallel':
      case 'race':
        step.branches.forEach((b) => collectMeansConditions(b, meansMap));
        break;
      case 'for_each':
        collectMeansConditions(step.body, meansMap);
        break;
      case 'ask':
        if (step.failHandler) collectMeansConditions(step.failHandler, meansMap);
        if (step.timeoutHandler) collectMeansConditions(step.timeoutHandler, meansMap);
        break;
      case 'approval':
        if (step.rejectHandler) collectMeansConditions(step.rejectHandler, meansMap);
        break;
    }
  }
}

function addMeans(cond: ConditionExpr, meansMap: Map<string, string[]>): void {
  if ('and' in cond) { cond.and.forEach(c => addMeans(c, meansMap)); return; }
  if ('or' in cond) { cond.or.forEach(c => addMeans(c, meansMap)); return; }
  if (cond.op === 'means' && cond.value) {
    const existing = meansMap.get(cond.variable) || [];
    if (!existing.includes(cond.value)) existing.push(cond.value);
    meansMap.set(cond.variable, existing);
  }
}

