import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const sourceScript = resolve(__dirname, '../../../scripts/scan-hostnames.sh');
const fixtureParent = __dirname;

type FixtureOptions = {
  tracked?: Record<string, string>;
  untracked?: Record<string, string>;
  removeAfterTracking?: string[];
  workingChanges?: Record<string, string>;
};

type ProcessResult = { status: number | null; stdout: string; stderr: string };

function run(executable: '/usr/bin/git' | '/bin/bash', args: string[], cwd: string): ProcessResult {
  const result = spawnSync(executable, args, {
    cwd,
    env: {},
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`fixture process terminated: ${result.signal}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function fixturePath(root: string, name: string): string {
  const target = resolve(root, name);
  if (isAbsolute(name) || !target.startsWith(root + sep) || name.split(/[\\/]/).includes('.git')) {
    throw new Error('fixture path must remain inside the disposable root');
  }
  return target;
}

export function scanFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(fixtureParent, 'burn4-hostnames-fixture-'));
  try {
    const initialized = run('/usr/bin/git', ['-c', 'init.templateDir=', '-c', 'core.hooksPath=/dev/null', 'init', '--quiet'], root);
    if (initialized.status !== 0) throw new Error(`fixture git init failed: ${initialized.stderr}`);
    for (const [name, content] of Object.entries({ ...options.untracked, ...options.tracked })) {
      const target = fixturePath(root, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    const names = Object.keys(options.tracked ?? {});
    if (names.length > 0) {
      const indexed = run('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', 'add', '--', ...names], root);
      if (indexed.status !== 0) throw new Error(`fixture git add failed: ${indexed.stderr}`);
    }
    for (const [name, content] of Object.entries(options.workingChanges ?? {})) {
      if (!names.includes(name)) throw new Error('working changes require an already tracked fixture file');
      writeFileSync(fixturePath(root, name), content, 'utf8');
    }
    for (const name of options.removeAfterTracking ?? []) unlinkSync(fixturePath(root, name));

    const before = readFileSync(sourceScript, 'utf8');
    const result = run('/bin/bash', [sourceScript], root);
    const after = readFileSync(sourceScript, 'utf8');
    if (after !== before) throw new Error('scanner source changed during fixture execution');
    return {
      ...result,
      violationLines: result.stdout.split('\n').filter(line => line.includes('[hostname(s): ')),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
