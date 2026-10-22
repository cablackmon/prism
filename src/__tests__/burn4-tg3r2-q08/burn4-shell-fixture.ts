import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../..');
const activeFixtures: string[] = [];

type ScriptName = 'check-inline-js.sh' | 'check-version-sync.sh';

export function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'burn4-prism-q08-'));
  activeFixtures.push(root);
  for (const directory of ['scripts', 'docs', 'ha-app', 'nested']) {
    mkdirSync(join(root, directory));
  }
  for (const name of ['check-inline-js.sh', 'check-version-sync.sh'] as const) {
    copyFileSync(join(repositoryRoot, 'scripts', name), join(root, 'scripts', name));
  }
  return root;
}

export function writeFixture(root: string, filename: string, contents: string): string {
  const target = join(root, filename);
  writeFileSync(target, contents);
  return target;
}

export function runScript(root: string, name: ScriptName, args: string[] = [], cwd = root) {
  // The child receives an empty environment and only disposable fixture inputs.
  // The original shell source is copied unchanged; node is used only for local parsing.
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', join(root, 'scripts', name), ...args], {
    cwd,
    env: {},
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 256 * 1024,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Fixture script terminated by ${result.signal}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function cleanupFixtures(): void {
  for (const root of activeFixtures.splice(0)) rmSync(root, { recursive: true, force: true });
}
