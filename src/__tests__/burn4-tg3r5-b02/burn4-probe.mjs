import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(__dirname, '../../..');
const original = path.join(__dirname, 'burn4-gaps.test.ts');
const inverse = path.join(__dirname, 'burn4-inverse.test.ts');
const report = path.join(__dirname, 'burn4-inverse-result.json');
assert.equal(fs.existsSync(inverse), false, 'Do not overwrite an existing probe');
assert.equal(fs.existsSync(report), false, 'Do not overwrite an existing report');
try {
  const source = fs.readFileSync(original, 'utf8');
  assert.equal((source.match(/it\.failing\(/g) || []).length, 2);
  const assertionLines = source.split('\n').flatMap((line, index) =>
    line.includes('expect(cell?.textContent).toBe(name);') ? [index + 1] : []);
  assert.equal(assertionLines.length, 2);
  fs.writeFileSync(inverse, source.replaceAll('it.failing(', 'it('), { flag: 'wx' });
  const run = spawnSync(process.execPath, [
    path.join(root, 'node_modules/jest/bin/jest.js'),
    '--config', path.join(__dirname, 'burn4-jest.config.cjs'),
    '--runInBand', '--runTestsByPath', inverse,
    '--json', '--outputFile', report,
  ], { cwd: root, env: {}, encoding: 'utf8', timeout: 60000 });
  if (run.error) throw run.error;
  assert.equal(run.status, 1, 'Direct assertions must fail');
  const reportText = fs.readFileSync(report, 'utf8');
  const results = JSON.parse(reportText);
  assert.equal(results.numTotalTests, 4);
  assert.equal(results.numFailedTests, 4);
  assert.equal(results.numPassedTests, 0);
  assert.equal(results.numPendingTests, 0);
  for (const suite of results.testResults) {
    for (const test of suite.assertionResults) {
      assert.equal(test.status, 'failed');
      assert.match(test.title, /^KNOWN GAP:/);
      assert.equal(test.failureMessages.length, 1);
      const message = test.failureMessages[0];
      assert.match(message, /expect\(received\)\.toBe\(expected\)/);
      assert.match(message, /Expected:.*data-burn4/);
      assert.match(message, /Received:.*(?:search|archive)\.example/);
      const assertionLine = assertionLines[test.title.includes('current referrer') ? 0 : 1];
      assert.ok(message.includes(`burn4-inverse.test.ts:${assertionLine}:`), 'Failure must point to the literal text assertion');
      console.log(`CONFIRMED: ${test.fullName}`);
    }
  }
  if (process.argv[2]) fs.writeFileSync(process.argv[2], reportText);
  console.log('PASS: four direct gap assertions fail on literal referrer text, with no setup failure.');
} finally {
  fs.rmSync(inverse, { force: true });
  fs.rmSync(report, { force: true });
}
