/**
 * FlowSpec AST — the data structures the parser produces
 * and the compiler consumes.
 */

// ── Conditions ───────────────────────────────────────────────────────────────

export type ConditionOp =
  | 'contains'
  | 'equals'
  | 'means'
  | 'is above'
  | 'is below'
  | 'is empty'
  | 'is not empty';

export interface Condition {
  variable: string;           // e.g. "review"
  op: ConditionOp;
  value?: string;             // not needed for is empty / is not empty
}

export interface AndCondition {
  and: ConditionExpr[];
}

export interface OrCondition {
  or: ConditionExpr[];
}

/** A condition expression: single condition, or AND/OR compound (no mixing). */
export type ConditionExpr = Condition | AndCondition | OrCondition;

// ── Steps (AST nodes) ────────────────────────────────────────────────────────

export interface AskStep {
  type: 'ask';
  bot: string;                // e.g. "clive"
  prompt: string;             // may contain {variables}
  capture?: string;           // -> name
  timeout?: string;           // "10 minutes"
  retries?: number;           // retry N times
  failHandler?: Step[];       // if it fails
  timeoutHandler?: Step[];    // if it times out
  newSession?: boolean;       // (new session)
  line: number;
}

export interface SendStep {
  type: 'send';
  target: string;             // bot name, channel, or human
  targetType: 'bot' | 'channel' | 'human';
  message: string;
  line: number;
}

export interface ParallelStep {
  type: 'parallel';
  branches: Step[][];         // each branch is a list of steps
  line: number;
}

export interface RaceStep {
  type: 'race';
  branches: Step[][];
  line: number;
}

export interface ForEachStep {
  type: 'for_each';
  itemVar: string;            // "bug"
  listVar: string;            // "bugs"
  concurrency?: number;       // N at a time
  stopOnFailure?: boolean;
  collectVar?: string;        // collect {fix} ...
  collectAs?: string;         // ... as all_fixes
  body: Step[];
  line: number;
}

export interface RepeatUntilStep {
  type: 'repeat_until';
  condition: ConditionExpr;
  maxIterations: number;      // at most N times (required)
  body: Step[];
  noConvergeHandler?: Step[]; // if it never converges
  line: number;
}

export interface IfStep {
  type: 'if';
  condition: ConditionExpr;
  body: Step[];
  otherwiseIfs?: Array<{      // otherwise if ...
    condition: ConditionExpr;
    body: Step[];
  }>;
  otherwise?: Step[];         // otherwise (final else)
  line: number;
}

export interface ApprovalStep {
  type: 'approval';
  message: string;
  rejectCapture?: string;     // on reject -> feedback
  rejectHandler?: Step[];     // on reject body
  line: number;
}

export interface RunStep {
  type: 'run';
  workflowName: string;
  args?: Record<string, string>; // with key = {value}
  maxTotal?: number;          // at most N total
  capture?: string;           // run "X" -> capture
  line: number;
}

export interface ReadFileStep {
  type: 'read_file';
  path: string;                 // file path (may contain {variables})
  capture: string;              // -> variable name
  line: number;
}

export interface WriteFileStep {
  type: 'write_file';
  variable: string;             // {variable} to write
  path: string;                 // file path (may contain {variables})
  line: number;
}

export interface StopStep {
  type: 'stop';
  message?: string;
  line: number;
}

export type Step =
  | AskStep
  | SendStep
  | ParallelStep
  | RaceStep
  | ForEachStep
  | RepeatUntilStep
  | IfStep
  | ApprovalStep
  | RunStep
  | ReadFileStep
  | WriteFileStep
  | StopStep;

// ── Workflow (top-level) ─────────────────────────────────────────────────────

export interface WorkflowInput {
  name: string;
  required: boolean;
  defaultValue?: string;
}

export interface Workflow {
  name: string;
  inputs: WorkflowInput[];
  timeout?: string;           // e.g. "2 hours"
  steps: Step[];
}

/** A .flow file can contain multiple workflow definitions. */
export type FlowFile = Workflow[];
