import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../..');
const root = mkdtempSync('/tmp/burn4-https-inverse-');
const relative = 'src/__tests__/burn4-tg3r5-b08';
try {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(repository, 'scripts/setup-https.ps1'), join(root, 'scripts/setup-https.ps1'));
  cpSync(directory, join(root, relative), { recursive: true });
  symlinkSync(realpathSync(join(repository, 'node_modules')), join(root, 'node_modules'), 'dir');
  const gaps = join(root, relative, 'burn4-gaps.powershell.ts');
  writeFileSync(gaps, readFileSync(gaps, 'utf8').replaceAll('test.failing(', 'test('));
  const output = join(root, 'burn4-inverse-results.json');
  const child = spawnSync(process.execPath, [
    join(repository, 'node_modules/jest/bin/jest.js'),
    '--config', join(relative, 'burn4-jest.config.cjs'),
    '--runInBand', '--runTestsByPath', join(relative, 'burn4-gaps.powershell.ts'),
    '--json', '--outputFile', output,
  ], { cwd: root, env: {}, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  if (child.error) throw child.error;
  const result = JSON.parse(readFileSync(output, 'utf8'));
  if (child.status !== 1 || result.numFailedTests !== 4 || result.numPassedTests !== 0 || result.numPendingTests !== 0) {
    throw new Error('Expected exactly four failed direct gap assertions');
  }
  const checks = [
    ['CA installation status', 'not.toContain', 'generate'],
    ['generation status', 'not.toContain', 'Certificate written'],
    ['CA-root status', 'not.toContain', 'Done.'],
    ['pushed working directory', 'toBe', '/caller'],
  ];
  const cases = result.testResults.flatMap(suite => suite.assertionResults);
  const verified = checks.map(([title, matcher, assertion]) => {
    const item = cases.find(test => test.title.includes(title));
    const message = item?.failureMessages.join('\n') ?? '';
    if (item?.status !== 'failed' || !message.includes(matcher) || !message.includes(assertion)) {
      throw new Error('Gap failed outside its intended assertion: ' + title);
    }
    return { title: item.title, matcher, assertion };
  });
  process.stdout.write(JSON.stringify({ failedAtIntendedAssertion: verified, count: verified.length }) + '\n');
} finally {
  rmSync(root, { recursive: true, force: true });
}
