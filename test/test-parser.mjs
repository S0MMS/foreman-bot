import { readFileSync } from 'fs';
import { parseFlowSpec } from '../dist/flowspec/parser.js';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node test/test-parser.mjs <file.flow> [file2.flow ...]');
  process.exit(1);
}

let passed = 0;
let failed = 0;

for (const file of files) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Parsing: ${file}`);
  console.log('='.repeat(60));
  try {
    const source = readFileSync(file, 'utf-8');
    const workflows = parseFlowSpec(source);
    console.log(`  Workflows found: ${workflows.length}`);
    for (const wf of workflows) {
      console.log(`  - "${wf.name}": ${wf.steps.length} steps`);
      if (wf.inputs?.length) console.log(`    inputs: ${wf.inputs.join(', ')}`);
      if (wf.timeout) console.log(`    timeout: ${wf.timeout}`);
      for (const step of wf.steps) {
        console.log(`    [${step.type}]${step.resultVar ? ` -> ${step.resultVar}` : ''}`);
      }
    }
    console.log(`  PASS`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${err.message}`);
    failed++;
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
