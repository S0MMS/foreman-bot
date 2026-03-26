/**
 * FlowSpec Runtime — pure functions used by the compiler/interpreter.
 *
 * Extracted into a separate module so they can be tested outside
 * the Temporal workflow sandbox. No Temporal imports here.
 */

import type { Workflow, Step, Condition } from './ast.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const FLOWSPEC_CLASS_PREFIX = 'FLOWSPEC_CLASS:';

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

/** Evaluate a FlowSpec condition against the current variable state. */
export function evaluateCondition(vars: FlowVars, cond: Condition): boolean {
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
      // Check the pre-extracted classification stored by extractClassification
      const classification = vars[`__class_${cond.variable}`] || '';
      return classification.toLowerCase().trim() === (cond.value || '').toLowerCase().trim();
    }
  }
}

// ── Classification Extraction ────────────────────────────────────────────────

/**
 * Extract the FLOWSPEC_CLASS tag from the last line of bot output.
 * Returns the cleaned text (tag stripped) and the classification value.
 * If no tag is found, returns the original text unchanged.
 */
export function extractClassification(text: string): { cleaned: string; classification?: string } {
  const lines = text.trimEnd().split('\n');
  const lastLine = lines[lines.length - 1]?.trim() || '';

  if (lastLine.startsWith(FLOWSPEC_CLASS_PREFIX)) {
    const classification = lastLine.slice(FLOWSPEC_CLASS_PREFIX.length).trim();
    const cleaned = lines.slice(0, -1).join('\n').trimEnd();
    return { cleaned, classification };
  }

  return { cleaned: text };
}

// ── Means Operator — First Pass (AST augmentation) ──────────────────────────

/**
 * Walk the AST before execution, find all `means` conditions, and inject
 * classification instructions into the upstream `ask` prompts that produce
 * those variables. Mutates the AST in place.
 */
export function augmentMeansPrompts(workflow: Workflow): void {
  const meansMap = new Map<string, string[]>();
  collectMeansConditions(workflow.steps, meansMap);
  if (meansMap.size === 0) return;
  augmentAskSteps(workflow.steps, meansMap);
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

function addMeans(cond: Condition, meansMap: Map<string, string[]>): void {
  if (cond.op === 'means' && cond.value) {
    const existing = meansMap.get(cond.variable) || [];
    if (!existing.includes(cond.value)) existing.push(cond.value);
    meansMap.set(cond.variable, existing);
  }
}

function augmentAskSteps(steps: Step[], meansMap: Map<string, string[]>): void {
  for (const step of steps) {
    if (step.type === 'ask' && step.capture && meansMap.has(step.capture)) {
      const values = meansMap.get(step.capture)!;
      step.prompt += buildClassificationSuffix(values);
    }
    // Recurse into sub-steps
    switch (step.type) {
      case 'if':
        augmentAskSteps(step.body, meansMap);
        step.otherwiseIfs?.forEach((b) => augmentAskSteps(b.body, meansMap));
        if (step.otherwise) augmentAskSteps(step.otherwise, meansMap);
        break;
      case 'repeat_until':
        augmentAskSteps(step.body, meansMap);
        if (step.noConvergeHandler) augmentAskSteps(step.noConvergeHandler, meansMap);
        break;
      case 'parallel':
      case 'race':
        step.branches.forEach((b) => augmentAskSteps(b, meansMap));
        break;
      case 'for_each':
        augmentAskSteps(step.body, meansMap);
        break;
      case 'ask':
        if (step.failHandler) augmentAskSteps(step.failHandler, meansMap);
        if (step.timeoutHandler) augmentAskSteps(step.timeoutHandler, meansMap);
        break;
      case 'approval':
        if (step.rejectHandler) augmentAskSteps(step.rejectHandler, meansMap);
        break;
    }
  }
}

/** Build the classification instruction appended to an `ask` prompt. */
export function buildClassificationSuffix(values: string[]): string {
  if (values.length === 1) {
    return (
      `\n\nIMPORTANT: On the very last line of your response, write exactly ` +
      `"${FLOWSPEC_CLASS_PREFIX} ${values[0]}" if your response means "${values[0]}", ` +
      `otherwise write "${FLOWSPEC_CLASS_PREFIX} other".`
    );
  }
  const options = values.map((v) => `"${FLOWSPEC_CLASS_PREFIX} ${v}"`).join(', ');
  return (
    `\n\nIMPORTANT: On the very last line of your response, classify it by writing ` +
    `exactly one of: ${options}, or "${FLOWSPEC_CLASS_PREFIX} other".`
  );
}
