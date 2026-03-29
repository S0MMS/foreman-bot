/**
 * FlowSpec Parser — hand-written recursive descent.
 * Turns .flow text into an AST (see ast.ts).
 *
 * The grammar is indentation-based (like Python).
 * Each line is classified by its leading keyword, then parsed.
 */

import type {
  FlowFile, Workflow, WorkflowInput, Step, Condition, ConditionExpr, ConditionOp,
  AskStep, SendStep, ParallelStep, RaceStep, ForEachStep,
  RepeatUntilStep, IfStep, ApprovalStep, RunStep, StopStep,
} from './ast.js';

// ── Errors ───────────────────────────────────────────────────────────────────

export class ParseError extends Error {
  constructor(public line: number, message: string) {
    super(`Line ${line}: ${message}`);
    this.name = 'ParseError';
  }
}

// ── Lexer ────────────────────────────────────────────────────────────────────

interface Line {
  num: number;       // 1-based line number
  indent: number;    // number of leading spaces
  text: string;      // trimmed content (no leading spaces)
}

/** Split source into indentation-aware lines, stripping comments and blanks. */
function lex(source: string): Line[] {
  const lines: Line[] = [];
  const raw = source.split('\n');
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    // Count leading spaces
    const stripped = line.replace(/^\s+/, '');
    if (stripped === '' || stripped.startsWith('--')) continue; // blank or comment
    const indent = line.length - stripped.length;
    lines.push({ num: i + 1, indent, text: stripped });
  }
  return lines;
}

// ── Parser state ─────────────────────────────────────────────────────────────

class Parser {
  private lines: Line[];
  private pos: number = 0;

  constructor(source: string) {
    this.lines = lex(source);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private peek(): Line | undefined {
    return this.lines[this.pos];
  }

  private advance(): Line {
    const line = this.lines[this.pos];
    if (!line) throw new ParseError(this.lines[this.lines.length - 1]?.num ?? 0, 'Unexpected end of file');
    this.pos++;
    return line;
  }

  private atEnd(): boolean {
    return this.pos >= this.lines.length;
  }

  /** Collect all lines indented deeper than `baseIndent`. */
  private collectBlock(baseIndent: number): Line[] {
    const block: Line[] = [];
    while (!this.atEnd() && this.peek()!.indent > baseIndent) {
      block.push(this.advance());
    }
    return block;
  }

  /** Parse steps from a block of lines at a given indentation level. */
  private parseSteps(lines: Line[], blockIndent: number): Step[] {
    const sub = new Parser('');
    sub.lines = lines;
    sub.pos = 0;
    const steps: Step[] = [];
    while (!sub.atEnd()) {
      steps.push(sub.parseStep(blockIndent));
    }
    return steps;
  }

  /** Get body lines for current block — lines indented deeper than the current line. */
  private getBody(currentLine: Line): Line[] {
    return this.collectBlock(currentLine.indent);
  }

  // ── String parsing ───────────────────────────────────────────────────────

  /** Extract a quoted string (single or triple-quoted). Returns [extracted, rest]. */
  private extractQuoted(text: string, lineNum: number): [string, string] {
    if (text.startsWith('"""')) {
      // Triple-quoted: may span the rest of this token, or multi-line was pre-joined
      const endIdx = text.indexOf('"""', 3);
      if (endIdx === -1) throw new ParseError(lineNum, 'Unterminated triple-quoted string');
      return [text.slice(3, endIdx).trim(), text.slice(endIdx + 3).trim()];
    }
    if (text.startsWith('"')) {
      // Find closing quote (not escaped)
      let i = 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '"') break;
        i++;
      }
      if (i >= text.length) throw new ParseError(lineNum, 'Unterminated string');
      return [text.slice(1, i), text.slice(i + 1).trim()];
    }
    throw new ParseError(lineNum, `Expected quoted string, got: ${text.slice(0, 30)}`);
  }

  /** Handle triple-quoted strings that span multiple source lines. */
  private extractMultilineQuoted(startLine: Line): [string, string] {
    const text = startLine.text;
    const tripleStart = text.indexOf('"""');
    if (tripleStart === -1) return this.extractQuoted(text.slice(text.indexOf('"')), startLine.num);

    const afterOpen = text.slice(tripleStart + 3);
    const endInSameLine = afterOpen.indexOf('"""');
    if (endInSameLine !== -1) {
      // Triple quote opens and closes on same line
      const content = afterOpen.slice(0, endInSameLine).trim();
      const rest = afterOpen.slice(endInSameLine + 3).trim();
      return [content, rest];
    }

    // Multi-line: collect until we find closing """
    const parts = [afterOpen];
    while (!this.atEnd()) {
      const next = this.advance();
      const closeIdx = next.text.indexOf('"""');
      if (closeIdx !== -1) {
        parts.push(next.text.slice(0, closeIdx));
        const rest = next.text.slice(closeIdx + 3).trim();
        return [parts.join('\n').trim(), rest];
      }
      parts.push(next.text);
    }
    throw new ParseError(startLine.num, 'Unterminated triple-quoted string');
  }

  // ── Condition parsing ────────────────────────────────────────────────────

  /** Parse a condition expression, possibly compound (AND/OR). */
  private parseCondition(text: string, lineNum: number): ConditionExpr {
    // Split on " and " / " or " to detect compound conditions.
    // We try " and " first, then " or ". No mixing allowed.
    const andParts = this.splitConditionParts(text, ' and ');
    if (andParts.length > 1) {
      return { and: andParts.map(p => this.parseSingleCondition(p, lineNum)) };
    }
    const orParts = this.splitConditionParts(text, ' or ');
    if (orParts.length > 1) {
      return { or: orParts.map(p => this.parseSingleCondition(p, lineNum)) };
    }
    return this.parseSingleCondition(text, lineNum);
  }

  /**
   * Split condition text on a conjunction keyword, but only outside quoted strings.
   * Returns the original text in a single-element array if the keyword isn't found.
   */
  private splitConditionParts(text: string, conjunction: string): string[] {
    const parts: string[] = [];
    let inQuote = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '"') inQuote = !inQuote;
      if (!inQuote && text.slice(i, i + conjunction.length) === conjunction) {
        parts.push(text.slice(start, i).trim());
        i += conjunction.length - 1;
        start = i + 1;
      }
    }
    parts.push(text.slice(start).trim());
    return parts.length > 1 ? parts : [text];
  }

  /** Parse a single (non-compound) condition like: {review} means "security issue" */
  private parseSingleCondition(text: string, lineNum: number): Condition {
    // Extract variable: {varName}
    const varMatch = text.match(/^\{(\w+)\}\s+(.+)$/);
    if (!varMatch) throw new ParseError(lineNum, `Expected condition like {variable} <op> "value", got: ${text}`);
    const variable = varMatch[1];
    let rest = varMatch[2];

    // Match operator
    const ops: Array<[string, ConditionOp]> = [
      ['is not empty', 'is not empty'],
      ['is empty', 'is empty'],
      ['is above', 'is above'],
      ['is below', 'is below'],
      ['contains', 'contains'],
      ['equals', 'equals'],
      ['means', 'means'],
    ];

    for (const [keyword, op] of ops) {
      if (rest.startsWith(keyword)) {
        rest = rest.slice(keyword.length).trim();
        if (op === 'is empty' || op === 'is not empty') {
          return { variable, op };
        }
        // Extract the value
        if (rest.startsWith('"')) {
          const [value] = this.extractQuoted(rest, lineNum);
          return { variable, op, value };
        }
        // Numeric value (for is above / is below)
        const numMatch = rest.match(/^(\d+(?:\.\d+)?)/);
        if (numMatch) {
          return { variable, op, value: numMatch[1] };
        }
        throw new ParseError(lineNum, `Expected value after "${keyword}", got: ${rest}`);
      }
    }

    throw new ParseError(lineNum, `Unknown condition operator in: ${text}`);
  }

  // ── Step parsers ─────────────────────────────────────────────────────────

  private parseStep(blockIndent: number): Step {
    const line = this.peek()!;
    const text = line.text;

    if (text.startsWith('ask ')) return this.parseAsk();
    if (text.startsWith('send ')) return this.parseSend();
    if (text.startsWith('at the same time')) return this.parseParallel();
    if (text === 'race' || text.startsWith('race')) return this.parseRace();
    if (text.startsWith('for each ')) return this.parseForEach();
    if (text.startsWith('repeat until ')) return this.parseRepeatUntil();
    if (text.startsWith('if ')) return this.parseIf();
    if (text.startsWith('pause for approval')) return this.parseApproval();
    if (text.startsWith('wait for approval')) return this.parseApproval();
    if (text.startsWith('run ')) return this.parseRun();
    if (text === 'stop' || text.startsWith('stop ')) return this.parseStop();

    throw new ParseError(line.num, `Unknown statement: ${text.slice(0, 50)}`);
  }

  private parseAsk(): AskStep {
    const line = this.advance();
    let text = line.text;

    // ask @bot "prompt" [modifiers] -> capture
    const botMatch = text.match(/^ask\s+@([\w-]+)\s+/);
    if (!botMatch) throw new ParseError(line.num, `Expected: ask @bot "prompt", got: ${text}`);
    const bot = botMatch[1];
    text = text.slice(botMatch[0].length);

    // Handle (new session) modifier before the prompt
    const step: AskStep = { type: 'ask', bot, prompt: '', line: line.num };
    if (text.startsWith('(new session)')) {
      step.newSession = true;
      text = text.slice('(new session)'.length).trim();
    }

    // Extract prompt (possibly multi-line)
    let prompt: string;
    let rest: string = '';
    if (text.startsWith('"""')) {
      // Back up: need to handle multi-line from current position
      const tripleEnd = text.indexOf('"""', 3);
      if (tripleEnd !== -1) {
        prompt = text.slice(3, tripleEnd).trim();
        rest = text.slice(tripleEnd + 3).trim();
      } else {
        // Multi-line triple quote
        const parts = [text.slice(3)];
        let foundClose = false;
        while (!this.atEnd()) {
          const next = this.advance();
          const closeIdx = next.text.indexOf('"""');
          if (closeIdx !== -1) {
            parts.push(next.text.slice(0, closeIdx));
            rest = next.text.slice(closeIdx + 3).trim();
            foundClose = true;
            break;
          }
          parts.push(next.text);
        }
        if (!foundClose) throw new ParseError(line.num, 'Unterminated triple-quoted string in ask');
        prompt = parts.join('\n').trim();
      }
    } else {
      [prompt, rest] = this.extractQuoted(text, line.num);
    }

    // Parse modifiers from rest of line
    step.prompt = prompt;

    // -> capture
    const captureMatch = rest.match(/->\s*(\w+)/);
    if (captureMatch) {
      step.capture = captureMatch[1];
      rest = rest.replace(/->\s*\w+/, '').trim();
    }

    // within <duration>
    const timeoutMatch = rest.match(/within\s+(\d+\s+\w+)/);
    if (timeoutMatch) {
      step.timeout = timeoutMatch[1];
      rest = rest.replace(/within\s+\d+\s+\w+/, '').trim();
    }

    // retry N times
    const retryMatch = rest.match(/retry\s+(\d+)\s+times?/);
    if (retryMatch) {
      step.retries = parseInt(retryMatch[1], 10);
      rest = rest.replace(/retry\s+\d+\s+times?/, '').trim();
    }

    // (new session)
    if (rest.includes('(new session)')) {
      step.newSession = true;
      rest = rest.replace('(new session)', '').trim();
    }

    // Sub-blocks: if it fails / if it times out
    const body = this.getBody(line);
    if (body.length > 0) {
      let i = 0;
      while (i < body.length) {
        if (body[i].text === 'if it fails') {
          const failIndent = body[i].indent;
          const failBody: Line[] = [];
          i++;
          while (i < body.length && body[i].indent > failIndent) {
            failBody.push(body[i]);
            i++;
          }
          step.failHandler = this.parseSteps(failBody, failIndent);
        } else if (body[i].text === 'if it times out') {
          const toIndent = body[i].indent;
          const toBody: Line[] = [];
          i++;
          while (i < body.length && body[i].indent > toIndent) {
            toBody.push(body[i]);
            i++;
          }
          step.timeoutHandler = this.parseSteps(toBody, toIndent);
        } else {
          i++;
        }
      }
    }

    return step;
  }

  private parseSend(): SendStep {
    const line = this.advance();
    const text = line.text;

    // send @target "message" or send #channel "message"
    const targetMatch = text.match(/^send\s+([#@][\w-]+)\s+/);
    if (!targetMatch) throw new ParseError(line.num, `Expected: send @target "message" or send #channel "message"`);

    const rawTarget = targetMatch[1];
    const targetType: 'bot' | 'channel' | 'human' = rawTarget.startsWith('#') ? 'channel' : 'bot';
    const target = rawTarget.slice(1); // strip @ or #

    let remaining = text.slice(targetMatch[0].length);
    let message: string;

    if (remaining.startsWith('"""')) {
      const endInLine = remaining.indexOf('"""', 3);
      if (endInLine !== -1) {
        message = remaining.slice(3, endInLine).trim();
      } else {
        // Multi-line triple quote
        const parts = [remaining.slice(3)];
        let found = false;
        while (!this.atEnd()) {
          const next = this.advance();
          const closeIdx = next.text.indexOf('"""');
          if (closeIdx !== -1) {
            parts.push(next.text.slice(0, closeIdx));
            found = true;
            break;
          }
          parts.push(next.text);
        }
        if (!found) throw new ParseError(line.num, 'Unterminated triple-quoted string in send');
        message = parts.join('\n').trim();
      }
    } else {
      [message] = this.extractQuoted(remaining, line.num);
    }

    return { type: 'send', target, targetType, message, line: line.num };
  }

  private parseParallel(): ParallelStep {
    const line = this.advance();
    const body = this.getBody(line);
    if (body.length === 0) throw new ParseError(line.num, '"at the same time" block has no body');

    const branches = this.splitBranches(body);
    return { type: 'parallel', branches, line: line.num };
  }

  private parseRace(): RaceStep {
    const line = this.advance();
    const body = this.getBody(line);
    if (body.length === 0) throw new ParseError(line.num, '"race" block has no body');

    const branches = this.splitBranches(body);
    return { type: 'race', branches, line: line.num };
  }

  /** Split a block of lines into branches (each top-level line starts a branch). */
  private splitBranches(lines: Line[]): Step[][] {
    if (lines.length === 0) return [];
    const baseIndent = lines[0].indent;
    const branches: Step[][] = [];
    let current: Line[] = [];
    let inTripleQuote = false;

    for (const line of lines) {
      // Track triple-quoted strings so closing """ lines don't split branches
      const wasInTripleQuote = inTripleQuote;
      const tripleCount = (line.text.match(/"""/g) || []).length;
      if (tripleCount % 2 === 1) inTripleQuote = !inTripleQuote;

      if (!wasInTripleQuote && line.indent === baseIndent && current.length > 0) {
        branches.push(this.parseSteps(current, baseIndent));
        current = [];
      }
      current.push(line);
    }
    if (current.length > 0) {
      branches.push(this.parseSteps(current, baseIndent));
    }
    return branches;
  }

  private parseForEach(): ForEachStep {
    const line = this.advance();
    let text = line.text;

    // for each <item> in {list}[, modifiers]
    const match = text.match(/^for each\s+(\w+)\s+in\s+\{(\w+)\}/);
    if (!match) throw new ParseError(line.num, `Expected: for each <item> in {list}`);
    const itemVar = match[1];
    const listVar = match[2];
    let rest = text.slice(match[0].length).trim();

    const step: ForEachStep = { type: 'for_each', itemVar, listVar, body: [], line: line.num };

    // Parse comma-separated modifiers
    if (rest.startsWith(',')) rest = rest.slice(1).trim();

    // N at a time
    const concurrencyMatch = rest.match(/(\d+)\s+at a time/);
    if (concurrencyMatch) {
      step.concurrency = parseInt(concurrencyMatch[1], 10);
      rest = rest.replace(/\d+\s+at a time/, '').trim();
    }

    // stop on failure
    if (rest.includes('stop on failure')) {
      step.stopOnFailure = true;
      rest = rest.replace('stop on failure', '').trim();
    }

    // collect {var} as name
    const collectMatch = rest.match(/collect\s+\{(\w+)\}\s+as\s+(\w+)/);
    if (collectMatch) {
      step.collectVar = collectMatch[1];
      step.collectAs = collectMatch[2];
    }

    const body = this.getBody(line);
    step.body = this.parseSteps(body, line.indent);
    return step;
  }

  private parseRepeatUntil(): RepeatUntilStep {
    const line = this.advance();
    const text = line.text;

    // repeat until {var} <condition>, at most N times
    const match = text.match(/^repeat until\s+(.+?),\s*at most\s+(\d+)\s+times$/);
    if (!match) throw new ParseError(line.num, `Expected: repeat until {var} <condition>, at most N times`);

    const condition = this.parseCondition(match[1].trim(), line.num);
    const maxIterations = parseInt(match[2], 10);

    const allBody = this.getBody(line);

    // Separate main body from "if it never converges" handler
    let mainBody: Line[] = [];
    let noConvergeHandler: Step[] | undefined;
    let i = 0;
    const bodyBaseIndent = allBody.length > 0 ? allBody[0].indent : line.indent + 2;

    // Find "if it never converges" at the same indent as the body
    for (i = 0; i < allBody.length; i++) {
      if (allBody[i].text === 'if it never converges' && allBody[i].indent === bodyBaseIndent) {
        mainBody = allBody.slice(0, i);
        const handlerBody: Line[] = [];
        i++;
        while (i < allBody.length && allBody[i].indent > allBody[i - 1].indent) {
          handlerBody.push(allBody[i]);
          i++;
        }
        noConvergeHandler = this.parseSteps(handlerBody, bodyBaseIndent);
        break;
      }
    }
    if (!noConvergeHandler) mainBody = allBody;

    return {
      type: 'repeat_until',
      condition,
      maxIterations,
      body: this.parseSteps(mainBody, line.indent),
      noConvergeHandler,
      line: line.num,
    };
  }

  private parseIf(): IfStep {
    const line = this.advance();
    const text = line.text;

    // if {var} <condition>
    const condText = text.slice(3).trim(); // strip "if "
    const condition = this.parseCondition(condText, line.num);

    const body = this.getBody(line);
    const step: IfStep = {
      type: 'if',
      condition,
      body: this.parseSteps(body, line.indent),
      line: line.num,
    };

    // Check for otherwise if / otherwise
    while (!this.atEnd()) {
      const next = this.peek()!;
      if (next.indent !== line.indent) break;

      if (next.text.startsWith('otherwise if ')) {
        this.advance();
        const elseIfCondText = next.text.slice('otherwise if '.length).trim();
        const elseIfCond = this.parseCondition(elseIfCondText, next.num);
        const elseIfBody = this.getBody(next);
        if (!step.otherwiseIfs) step.otherwiseIfs = [];
        step.otherwiseIfs.push({
          condition: elseIfCond,
          body: this.parseSteps(elseIfBody, next.indent),
        });
      } else if (next.text === 'otherwise') {
        this.advance();
        const elseBody = this.getBody(next);
        step.otherwise = this.parseSteps(elseBody, next.indent);
        break;
      } else {
        break;
      }
    }

    return step;
  }

  private parseApproval(): ApprovalStep {
    const line = this.advance();
    const text = line.text;

    // pause for approval with message "..." or wait for approval "..."
    let message: string;
    const pauseMatch = text.match(/(?:pause for|wait for) approval(?:\s+with message)?\s+/);
    if (!pauseMatch) throw new ParseError(line.num, 'Expected: pause for approval with message "..."');
    const rest = text.slice(pauseMatch[0].length);
    [message] = this.extractQuoted(rest, line.num);

    const step: ApprovalStep = { type: 'approval', message, line: line.num };

    // Check for on reject handler
    const body = this.getBody(line);
    if (body.length > 0 && body[0].text.startsWith('on reject')) {
      const rejectLine = body[0];
      const captureMatch = rejectLine.text.match(/on reject\s+->\s*(\w+)/);
      if (captureMatch) {
        step.rejectCapture = captureMatch[1];
      }
      const rejectBody = body.slice(1).filter(l => l.indent > rejectLine.indent);
      if (rejectBody.length > 0) {
        step.rejectHandler = this.parseSteps(rejectBody, rejectLine.indent);
      }
    }

    return step;
  }

  private parseRun(): RunStep {
    const line = this.advance();
    const text = line.text;

    // run "Workflow Name" [with key = {value}] [, at most N total]
    const rest = text.slice(4).trim(); // strip "run "
    const [workflowName, afterName] = this.extractQuoted(rest, line.num);

    const step: RunStep = { type: 'run', workflowName, line: line.num };

    if (afterName) {
      // with key = {value}, key2 = {value2}
      const withMatch = afterName.match(/^with\s+(.+?)(?:,\s*at most|\s*->|$)/);
      if (withMatch) {
        step.args = {};
        const pairs = withMatch[1].split(/,\s*/);
        for (const pair of pairs) {
          const kv = pair.match(/(\w+)\s*=\s*(.+?)(?:\s*->|$)/);
          if (kv) {
            step.args[kv[1]] = kv[2].trim();
          }
        }
      }

      // at most N total
      const totalMatch = afterName.match(/at most\s+(\d+)\s+total/);
      if (totalMatch) {
        step.maxTotal = parseInt(totalMatch[1], 10);
      }

      // -> capture
      const captureMatch = afterName.match(/->\s*(\w+)/);
      if (captureMatch) {
        step.capture = captureMatch[1];
      }
    }

    return step;
  }

  private parseStop(): StopStep {
    const line = this.advance();
    const text = line.text;
    const step: StopStep = { type: 'stop', line: line.num };
    const rest = text.slice('stop'.length).trim();
    if (rest.startsWith('"')) {
      const [message] = this.extractQuoted(rest, line.num);
      step.message = message;
    }
    return step;
  }

  // ── Workflow parsing ─────────────────────────────────────────────────────

  private parseWorkflow(): Workflow {
    const line = this.advance();
    const text = line.text;

    // workflow "Name"
    const rest = text.slice('workflow '.length).trim();
    const [name] = this.extractQuoted(rest, line.num);

    const workflow: Workflow = { name, inputs: [], steps: [] };

    // Collect the workflow body
    const body = this.getBody(line);
    let i = 0;

    // Parse optional headers: inputs, timeout
    while (i < body.length) {
      if (body[i].text.startsWith('inputs:')) {
        workflow.inputs = this.parseInputs(body[i].text, body[i].num);
        i++;
      } else if (body[i].text.startsWith('timeout:')) {
        workflow.timeout = body[i].text.slice('timeout:'.length).trim();
        i++;
      } else {
        break;
      }
    }

    // Parse remaining lines as steps
    const stepLines = body.slice(i);
    if (stepLines.length > 0) {
      workflow.steps = this.parseSteps(stepLines, line.indent);
    }

    return workflow;
  }

  private parseInputs(text: string, lineNum: number): WorkflowInput[] {
    const inputText = text.slice('inputs:'.length).trim();
    const inputs: WorkflowInput[] = [];

    for (const part of inputText.split(/,\s*/)) {
      const trimmed = part.trim();
      const match = trimmed.match(/^(\w+)(?:\s+\((.+)\))?$/);
      if (!match) throw new ParseError(lineNum, `Invalid input declaration: ${trimmed}`);
      const name = match[1];
      const modifier = match[2];

      if (modifier === 'required') {
        inputs.push({ name, required: true });
      } else if (modifier?.startsWith('default ')) {
        const defaultValue = modifier.slice('default '.length).replace(/^"|"$/g, '');
        inputs.push({ name, required: false, defaultValue });
      } else {
        inputs.push({ name, required: false });
      }
    }
    return inputs;
  }

  // ── Top-level ────────────────────────────────────────────────────────────

  parse(): FlowFile {
    const workflows: Workflow[] = [];
    while (!this.atEnd()) {
      const line = this.peek()!;
      if (line.text.startsWith('workflow ')) {
        workflows.push(this.parseWorkflow());
      } else {
        throw new ParseError(line.num, `Expected "workflow" declaration, got: ${line.text.slice(0, 30)}`);
      }
    }
    if (workflows.length === 0) {
      throw new ParseError(1, 'No workflow definitions found');
    }
    return workflows;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function parseFlowSpec(source: string): FlowFile {
  return new Parser(source).parse();
}
