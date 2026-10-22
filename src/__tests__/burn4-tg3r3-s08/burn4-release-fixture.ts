import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export const RELEASE_DATE = '2041-07-09';
export const DEFAULT_PACKAGE = JSON.stringify({
  name: 'burn4-release-fixture',
  version: '1.2.3',
  private: true,
  metadata: { preserve: ['this', 'content'] },
}, null, 2) + '\n';
export const DEFAULT_CHANGELOG = [
  '# Fixture changelog',
  '',
  'Introductory text stays in place.',
  '',
  '## Unreleased',
  '',
  '### Added',
  '- A local fixture feature.',
  '',
  '### Fixed',
  '- A local fixture regression.',
  '',
  '## [1.2.3] - 2041-07-01',
  '',
  '- Existing release stays intact.',
  '',
  '## [1.2.2] - 2041-06-30',
  '',
  '- Earlier history stays intact.',
  '',
].join('\n');

export type ReleaseOptions = {
  packageText?: string | null;
  changelog?: string | null;
  addon?: string;
  checkerStatus?: number;
  failNodeAt?: number;
  omitCommand?: 'node' | 'date';
  concurrentChangelog?: { beforeNodeCall: number; text: string };
};

export type ReleaseDocuments = {
  packageText: string | null;
  changelog: string | null;
  addon: string | null;
};

export type ReleaseRun = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  before: ReleaseDocuments;
  after: ReleaseDocuments;
  nodeCalls: number;
  checkerCalls: string[];
};

const sourcePath = resolve(__dirname, '../../../scripts/release.sh');
const originalSource = readFileSync(sourcePath, 'utf8');

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function executable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o700);
}

function readOptional(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function documents(root: string): ReleaseDocuments {
  return {
    packageText: readOptional(join(root, 'package.json')),
    changelog: readOptional(join(root, 'docs/CHANGELOG.md')),
    addon: readOptional(join(root, 'ha-app/config.yaml')),
  };
}

/** Run the exact checked-in shell source with an isolated command allowlist. */
export function runRelease(args: string[] = ['1.2.4'], options: ReleaseOptions = {}): ReleaseRun {
  const root = mkdtempSync('/tmp/burn4-tg3r3-s08-');
  try {
    const bin = join(root, 'burn4-bin');
    mkdirSync(bin);
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'docs'));
    const packageText = options.packageText === undefined ? DEFAULT_PACKAGE : options.packageText;
    const changelog = options.changelog === undefined ? DEFAULT_CHANGELOG : options.changelog;
    if (packageText !== null) writeFileSync(join(root, 'package.json'), packageText);
    if (changelog !== null) writeFileSync(join(root, 'docs/CHANGELOG.md'), changelog);
    if (options.addon !== undefined) {
      mkdirSync(join(root, 'ha-app'));
      writeFileSync(join(root, 'ha-app/config.yaml'), options.addon);
    }

    // No repository script is rewritten, and no original checker is read or run.
    writeFileSync(join(root, 'scripts/burn4-release.sh'), originalSource);
    executable(join(root, 'scripts/check-version-sync.sh'), [
      '#!/bin/bash',
      "printf 'checker\\n' >> burn4-checker-calls",
      `exit ${options.checkerStatus ?? 0}`,
      '',
    ].join('\n'));

    // PATH has no host fallback. Only these three real local utilities and the
    // controlled date/node wrappers can be found by the source under test.
    symlinkSync('/bin/bash', join(bin, 'bash'));
    symlinkSync('/usr/bin/dirname', join(bin, 'dirname'));
    symlinkSync('/bin/cat', join(bin, 'cat'));
    if (options.omitCommand !== 'date') {
      executable(join(bin, 'date'), [
        '#!/bin/bash',
        '[[ $# -eq 1 && "$1" == "+%Y-%m-%d" ]] || exit 72',
        `printf '%s\\n' '${RELEASE_DATE}'`,
        '',
      ].join('\n'));
    }
    if (options.omitCommand !== 'node') {
      executable(join(bin, 'node'), [
        '#!/bin/bash',
        `counter_file=${shellQuote(join(root, 'burn4-node-count'))}`,
        'count=0',
        'if [[ -f "$counter_file" ]]; then read -r count < "$counter_file"; fi',
        'count=$((count + 1))',
        'printf "%s\\n" "$count" > "$counter_file"',
        ...(options.concurrentChangelog ? [
          `if [[ "$count" -eq ${options.concurrentChangelog.beforeNodeCall} ]]; then`,
          `  printf '%s' ${shellQuote(options.concurrentChangelog.text)} > ${shellQuote(join(root, 'docs/CHANGELOG.md'))}`,
          'fi',
        ] : []),
        `if [[ "$count" -eq ${options.failNodeAt ?? 0} ]]; then`,
        "  printf 'burn4 injected node phase failure\\n' >&2",
        '  exit 73',
        'fi',
        `exec ${shellQuote(process.execPath)} "$@"`,
        '',
      ].join('\n'));
    }

    const before = documents(root);
    const child = spawnSync('/bin/bash', [join(root, 'scripts/burn4-release.sh'), ...args], {
      cwd: root,
      env: { PATH: bin, LC_ALL: 'C', TZ: 'UTC' },
      encoding: 'utf8',
      timeout: 8_000,
      maxBuffer: 256 * 1024,
    });
    if (child.error) throw child.error;
    return {
      status: child.status,
      signal: child.signal,
      stdout: child.stdout,
      stderr: child.stderr,
      before,
      after: documents(root),
      nodeCalls: Number(readOptional(join(root, 'burn4-node-count')) ?? 0),
      checkerCalls: (readOptional(join(root, 'burn4-checker-calls')) ?? '').trim().split('\n').filter(Boolean),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
