import assert from 'node:assert/strict';
import { gapCases } from './burn4-gap-cases';

async function main() {
  for (const gap of gapCases) {
    let confirmed = false;
    try { await gap.run(); }
    catch (error) {
      if (!(error instanceof assert.AssertionError) || !error.message.startsWith('KNOWN GAP desired contract:')) throw error;
      console.log(JSON.stringify({ name: gap.name, assertion: error.message.split('\n')[0], actual: error.actual, expected: error.expected }));
      confirmed = true;
    }
    assert.equal(confirmed, true, `Expected direct desired-contract assertion failure: ${gap.name}`);
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
