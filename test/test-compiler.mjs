/**
 * FlowSpec Compiler tests — exercises the pure runtime logic
 * (interpolation, conditions, means augmentation, classification extraction)
 * and verifies parser→compiler integration for all 10 primitives.
 */

import { readFileSync } from 'fs';
import { parseFlowSpec } from '../dist/flowspec/parser.js';
import {
  interpolate,
  resolveBot,
  evaluateCondition,
  extractClassification,
  augmentMeansPrompts,
  buildClassificationSuffix,
  FLOWSPEC_CLASS_PREFIX,
} from '../dist/flowspec/runtime.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || ''}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── interpolate ──');

test('replaces single variable', () => {
  assertEqual(interpolate({ name: 'Chris' }, 'Hello {name}!'), 'Hello Chris!');
});

test('replaces multiple variables', () => {
  assertEqual(
    interpolate({ a: 'foo', b: 'bar' }, '{a} and {b}'),
    'foo and bar',
  );
});

test('missing variable becomes empty string', () => {
  assertEqual(interpolate({}, 'Hello {name}!'), 'Hello !');
});

test('no variables returns template unchanged', () => {
  assertEqual(interpolate({ x: '1' }, 'no vars here'), 'no vars here');
});

test('handles adjacent variables', () => {
  assertEqual(interpolate({ a: 'X', b: 'Y' }, '{a}{b}'), 'XY');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── resolveBot ──');

test('resolves known bot', () => {
  assertEqual(resolveBot({ writer: 'C123' }, 'writer'), 'C123');
});

test('throws for unknown bot', () => {
  try {
    resolveBot({ writer: 'C123' }, 'unknown');
    throw new Error('Should have thrown');
  } catch (e) {
    assert(e.message.includes('not found in registry'), `Wrong error: ${e.message}`);
    assert(e.message.includes('writer'), 'Should list available bots');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── evaluateCondition ──');

test('is empty — true for empty string', () => {
  assert(evaluateCondition({ x: '' }, { variable: 'x', op: 'is empty' }));
});

test('is empty — true for whitespace', () => {
  assert(evaluateCondition({ x: '  ' }, { variable: 'x', op: 'is empty' }));
});

test('is empty — false for content', () => {
  assert(!evaluateCondition({ x: 'hello' }, { variable: 'x', op: 'is empty' }));
});

test('is empty — true for missing var', () => {
  assert(evaluateCondition({}, { variable: 'x', op: 'is empty' }));
});

test('is not empty — true for content', () => {
  assert(evaluateCondition({ x: 'hello' }, { variable: 'x', op: 'is not empty' }));
});

test('is not empty — false for empty', () => {
  assert(!evaluateCondition({ x: '' }, { variable: 'x', op: 'is not empty' }));
});

test('contains — case insensitive match', () => {
  assert(evaluateCondition({ x: 'Hello World' }, { variable: 'x', op: 'contains', value: 'hello' }));
});

test('contains — no match', () => {
  assert(!evaluateCondition({ x: 'Hello' }, { variable: 'x', op: 'contains', value: 'world' }));
});

test('equals — exact match with trim', () => {
  assert(evaluateCondition({ x: ' yes ' }, { variable: 'x', op: 'equals', value: 'yes' }));
});

test('equals — no match', () => {
  assert(!evaluateCondition({ x: 'no' }, { variable: 'x', op: 'equals', value: 'yes' }));
});

test('is above — numeric comparison', () => {
  assert(evaluateCondition({ x: '10' }, { variable: 'x', op: 'is above', value: '5' }));
});

test('is above — false when equal', () => {
  assert(!evaluateCondition({ x: '5' }, { variable: 'x', op: 'is above', value: '5' }));
});

test('is below — numeric comparison', () => {
  assert(evaluateCondition({ x: '3' }, { variable: 'x', op: 'is below', value: '5' }));
});

test('is below — float comparison', () => {
  assert(evaluateCondition({ x: '3.14' }, { variable: 'x', op: 'is below', value: '3.15' }));
});

test('means — matches classification', () => {
  assert(evaluateCondition(
    { review: 'looks good', __class_review: 'approved' },
    { variable: 'review', op: 'means', value: 'approved' },
  ));
});

test('means — case insensitive', () => {
  assert(evaluateCondition(
    { review: 'test', __class_review: 'Security Issue' },
    { variable: 'review', op: 'means', value: 'security issue' },
  ));
});

test('means — no match', () => {
  assert(!evaluateCondition(
    { review: 'test', __class_review: 'approved' },
    { variable: 'review', op: 'means', value: 'rejected' },
  ));
});

test('means — missing classification', () => {
  assert(!evaluateCondition(
    { review: 'some text' },
    { variable: 'review', op: 'means', value: 'anything' },
  ));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── extractClassification ──');

test('extracts classification from last line', () => {
  const text = 'This is a review of the code.\nIt looks good overall.\nFLOWSPEC_CLASS: approved';
  const result = extractClassification(text);
  assertEqual(result.classification, 'approved');
  assertEqual(result.cleaned, 'This is a review of the code.\nIt looks good overall.');
});

test('handles classification with extra whitespace', () => {
  const text = 'Response here\n  FLOWSPEC_CLASS:  security issue  ';
  const result = extractClassification(text);
  assertEqual(result.classification, 'security issue');
  assertEqual(result.cleaned, 'Response here');
});

test('returns original text when no classification', () => {
  const text = 'Just a normal response\nNo classification here';
  const result = extractClassification(text);
  assertEqual(result.cleaned, text);
  assertEqual(result.classification, undefined);
});

test('handles single line with classification', () => {
  const text = 'FLOWSPEC_CLASS: yes';
  const result = extractClassification(text);
  assertEqual(result.classification, 'yes');
  assertEqual(result.cleaned, '');
});

test('handles "other" classification', () => {
  const text = 'Some response\nFLOWSPEC_CLASS: other';
  const result = extractClassification(text);
  assertEqual(result.classification, 'other');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── buildClassificationSuffix ──');

test('single value suffix', () => {
  const suffix = buildClassificationSuffix(['approved']);
  assert(suffix.includes('FLOWSPEC_CLASS: approved'), 'Should contain class tag');
  assert(suffix.includes('FLOWSPEC_CLASS: other'), 'Should contain "other" fallback');
  assert(suffix.startsWith('\n\n'), 'Should start with double newline');
});

test('multiple value suffix', () => {
  const suffix = buildClassificationSuffix(['approved', 'rejected', 'needs work']);
  assert(suffix.includes('FLOWSPEC_CLASS: approved'), 'Should list approved');
  assert(suffix.includes('FLOWSPEC_CLASS: rejected'), 'Should list rejected');
  assert(suffix.includes('FLOWSPEC_CLASS: needs work'), 'Should list needs work');
  assert(suffix.includes('FLOWSPEC_CLASS: other'), 'Should include "other" option');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── augmentMeansPrompts ──');

test('augments ask prompt for single means condition', () => {
  const workflows = parseFlowSpec(`
workflow "test"
  ask @bot "Review this" -> review
  if {review} means "approved"
    send #general "Done"
`);
  augmentMeansPrompts(workflows[0]);
  const askStep = workflows[0].steps[0];
  assert(askStep.prompt.includes('FLOWSPEC_CLASS'), 'Prompt should be augmented');
  assert(askStep.prompt.includes('approved'), 'Should mention the means value');
  assert(askStep.prompt.startsWith('Review this'), 'Original prompt preserved');
});

test('augments for multiple means values on same variable', () => {
  const workflows = parseFlowSpec(`
workflow "test"
  ask @bot "Analyze this" -> result
  if {result} means "critical"
    send #alerts "Critical!"
  otherwise if {result} means "warning"
    send #warnings "Warning"
  otherwise
    send #general "OK"
`);
  augmentMeansPrompts(workflows[0]);
  const askStep = workflows[0].steps[0];
  assert(askStep.prompt.includes('critical'), 'Should mention critical');
  assert(askStep.prompt.includes('warning'), 'Should mention warning');
});

test('augments ask inside repeat_until body', () => {
  const workflows = parseFlowSpec(`
workflow "test"
  repeat until {verdict} means "consensus", at most 3 times
    ask @judge "Evaluate" -> verdict
`);
  augmentMeansPrompts(workflows[0]);
  const repeatStep = workflows[0].steps[0];
  const askStep = repeatStep.body[0];
  assert(askStep.prompt.includes('FLOWSPEC_CLASS'), 'Body ask should be augmented');
  assert(askStep.prompt.includes('consensus'), 'Should mention consensus');
});

test('does not augment unrelated ask steps', () => {
  const workflows = parseFlowSpec(`
workflow "test"
  ask @bot1 "Do something" -> result1
  ask @bot2 "Check it" -> result2
  if {result2} means "good"
    send #general "OK"
`);
  augmentMeansPrompts(workflows[0]);
  const ask1 = workflows[0].steps[0];
  const ask2 = workflows[0].steps[1];
  assert(!ask1.prompt.includes('FLOWSPEC_CLASS'), 'Unrelated ask should NOT be augmented');
  assert(ask2.prompt.includes('FLOWSPEC_CLASS'), 'Related ask SHOULD be augmented');
});

test('no-op when no means conditions exist', () => {
  const workflows = parseFlowSpec(`
workflow "test"
  ask @bot "Hello" -> greeting
  if {greeting} is not empty
    send #general "{greeting}"
`);
  const originalPrompt = workflows[0].steps[0].prompt;
  augmentMeansPrompts(workflows[0]);
  assertEqual(workflows[0].steps[0].prompt, originalPrompt, 'Prompt should be unchanged');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── End-to-end: means classification flow ──');

test('full means pipeline: augment → extract → evaluate', () => {
  // Step 1: Parse and augment
  const workflows = parseFlowSpec(`
workflow "test"
  ask @bot "Review this PR" -> review
  if {review} means "security issue"
    send #alerts "Alert!"
`);
  augmentMeansPrompts(workflows[0]);

  // Step 2: Simulate bot response with classification
  const botResponse = 'The PR looks fine, no major issues found.\nFLOWSPEC_CLASS: other';
  const { cleaned, classification } = extractClassification(botResponse);

  // Step 3: Store in vars and evaluate condition
  const vars = {
    review: cleaned,
    __class_review: classification,
  };

  assert(!evaluateCondition(vars, { variable: 'review', op: 'means', value: 'security issue' }),
    'Should NOT match "security issue" when classification is "other"');
  assertEqual(vars.review, 'The PR looks fine, no major issues found.',
    'Cleaned text should not contain classification');
});

test('full means pipeline: positive match', () => {
  const botResponse = 'Found SQL injection vulnerability in auth.ts line 42.\nFLOWSPEC_CLASS: security issue';
  const { cleaned, classification } = extractClassification(botResponse);
  const vars = { review: cleaned, __class_review: classification };

  assert(evaluateCondition(vars, { variable: 'review', op: 'means', value: 'security issue' }),
    'Should match "security issue"');
  assert(!vars.review.includes('FLOWSPEC_CLASS'), 'Cleaned text should be stripped');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── Parser → Compiler integration (all 10 primitives) ──');

test('complex.flow: full parse produces compiler-ready AST', () => {
  const source = readFileSync('test/fixtures/complex.flow', 'utf-8');
  const workflows = parseFlowSpec(source);

  // Verify structure compiler needs
  assertEqual(workflows.length, 2, 'workflow count');
  const wf = workflows[0];
  assertEqual(wf.name, 'code_review', 'workflow name');
  assertEqual(wf.inputs.length, 2, 'input count');
  assert(wf.timeout, 'should have timeout');

  // Verify step types
  const types = wf.steps.map(s => s.type);
  assertEqual(types[0], 'ask', 'step 1');
  assertEqual(types[1], 'for_each', 'step 2');
  assertEqual(types[2], 'repeat_until', 'step 3');
  assertEqual(types[3], 'if', 'step 4');

  // Verify for_each has collect
  const forEach = wf.steps[1];
  assertEqual(forEach.collectVar, 'review', 'collectVar');
  assertEqual(forEach.collectAs, 'reviews', 'collectAs');

  // Verify nested approval + stop
  const ifStep = wf.steps[3];
  const approval = ifStep.otherwise[0];
  assertEqual(approval.type, 'approval', 'nested approval');
  assertEqual(approval.rejectHandler[0].type, 'stop', 'nested stop');
  assertEqual(approval.rejectHandler[0].message, 'Review rejected by human', 'stop message');
});

test('means augmentation works on complex.flow', () => {
  const source = readFileSync('test/fixtures/complex.flow', 'utf-8');
  const workflows = parseFlowSpec(source);
  augmentMeansPrompts(workflows[0]);

  // The repeat_until body's ask (captures into 'consensus') should be augmented
  const repeatStep = workflows[0].steps[2];
  const askInRepeat = repeatStep.body[0];
  assert(askInRepeat.prompt.includes('FLOWSPEC_CLASS'),
    'ask inside repeat_until should be augmented for means');
  assert(askInRepeat.prompt.includes('all reviewers agree'),
    'Should reference the means value');

  // The first ask (captures into 'summary') should NOT be augmented (no means on summary)
  const firstAsk = workflows[0].steps[0];
  assert(!firstAsk.prompt.includes('FLOWSPEC_CLASS'),
    'ask for summary should NOT be augmented');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
