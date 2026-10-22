import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type Scanner = 'pii' | 'secrets';
type FixtureOptions = {
  files?: Record<string, string>;
  tracked?: string[];
  denylist?: string;
  missingDenylist?: boolean;
  missingCommands?: string[];
  initializeGit?: boolean;
};

const commands = ['git', 'grep', 'xargs', 'sed', 'mktemp', 'rm', 'wc'];
const roots: string[] = [];

export const MARKER = 'burn4fixtureword';
// The impossible octet cannot identify a real endpoint or usable credential.
export const INVALID_IP = '192.168.999.999';
export const EMAIL = 'burn4person@fixture.invalid';

export function cleanupFixtures(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function scannerFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync('/tmp/burn4-s06-');
  roots.push(root);
  const repo = join(root, 'burn4-repo');
  const bin = join(root, 'burn4-bin');
  const scratch = join(root, 'burn4-tmp');
  const template = join(root, 'burn4-empty-template');
  const denylist = join(root, 'burn4-denylist.txt');
  for (const directory of [repo, bin, scratch, template]) mkdirSync(directory);
  for (const command of commands) {
    if (!options.missingCommands?.includes(command)) symlinkSync(`/usr/bin/${command}`, join(bin, command));
  }
  if (!options.missingDenylist) writeFileSync(denylist, options.denylist ?? `${MARKER}\n`);
  const env = {
    PATH: bin,
    TMPDIR: scratch,
    PRISM_PII_DENYLIST: denylist,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TEMPLATE_DIR: template,
    LC_ALL: 'C',
  };

  function git(...args: string[]): void {
    const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: repo, env, encoding: 'utf8', timeout: 5000,
    });
    if (result.error || result.status !== 0) throw new Error(`Fixture git ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  }

  function write(path: string, text: string): void {
    const target = join(repo, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }

  if (options.initializeGit !== false) git('init', '--quiet', '--initial-branch=burn4-fixture');
  for (const [path, text] of Object.entries(options.files ?? {})) write(path, text);
  const tracked = options.tracked ?? Object.keys(options.files ?? {});
  if (tracked.length) git('add', '--', ...tracked);

  function run(scanner: Scanner) {
    const source = resolve(__dirname, `../../../scripts/scan-${scanner}.sh`);
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', source], {
      cwd: repo, env, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    });
    if (result.error || result.signal) throw new Error(`Scanner process did not finish: ${result.error?.message ?? result.signal}`);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  return { repo, git, write, run };
}
