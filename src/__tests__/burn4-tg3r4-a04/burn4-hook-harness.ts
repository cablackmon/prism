import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export type Reply = {
  stdout?: string;
  stderr?: string;
  status?: number;
};

export type HookScenario = {
  ghAvailable?: boolean;
  repo?: Reply;
  prs?: Reply;
  issues?: Reply;
  stdin?: string;
};

export type HookResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  calls: string[][];
  injectedFileExists: boolean;
};

const hookPath = resolve(__dirname, '../../../.claude/hooks/github-activity.sh');

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function respond(reply: Reply): string {
  return [
    `printf '%s' ${shellQuote(reply.stdout ?? '')}`,
    `printf '%s' ${shellQuote(reply.stderr ?? '')} >&2`,
    `exit ${reply.status ?? 0}`,
  ].join('\n');
}

function fakeGh(logPath: string, unexpectedPath: string, scenario: HookScenario): string {
  return [
    '#!/bin/bash',
    'set -u',
    `printf '%s\\0' "$@" >> ${shellQuote(logPath)}`,
    `printf '\\0' >> ${shellQuote(logPath)}`,
    'if [ "$#" -eq 4 ] && [ "$1" = repo ] && [ "$2" = view ] && [ "$3" = --json ] && [ "$4" = name ]; then',
    respond(scenario.repo ?? {}),
    'fi',
    'if [ "$#" -eq 10 ] && [ "$2" = list ] && [ "$3" = --state ] && [ "$4" = open ] && [ "$5" = --limit ] && [ "$6" = 20 ] && [ "$7" = --json ] && [ "$9" = --jq ] && [ -n "${10}" ]; then',
    'if [ "$1" = pr ] && [ "$8" = number,title,author,isDraft,createdAt ]; then',
    respond(scenario.prs ?? {}),
    'fi',
    'if [ "$1" = issue ] && [ "$8" = number,title,author,createdAt ]; then',
    respond(scenario.issues ?? {}),
    'fi',
    'fi',
    `printf 'unexpected fake gh invocation' > ${shellQuote(unexpectedPath)}`,
    'exit 125',
    '',
  ].join('\n');
}

// The child receives only a synthetic PATH and locale. No ambient environment
// is read or inherited. The only external commands available are fake gh and grep.
export function runHook(scenario: HookScenario = {}): HookResult {
  const root = mkdtempSync(join(__dirname, 'burn4-runtime-'));
  const bin = join(root, 'burn4-bin');
  const logPath = join(root, 'burn4-calls');
  const unexpectedPath = join(root, 'burn4-unexpected');
  mkdirSync(bin);

  try {
    symlinkSync('/bin/grep', join(bin, 'grep'));
    if (scenario.ghAvailable !== false) {
      writeFileSync(join(bin, 'gh'), fakeGh(logPath, unexpectedPath, scenario), { mode: 0o700 });
    }

    const child = spawnSync('/bin/bash', ['--noprofile', '--norc', hookPath], {
      cwd: root,
      env: { PATH: bin, LC_ALL: 'C' },
      input: scenario.stdin ?? '',
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 1024 * 1024,
    });
    if (child.error) throw child.error;
    if (existsSync(unexpectedPath)) throw new Error('Hook attempted an unsupported fake gh invocation');

    const calls = existsSync(logPath)
      ? readFileSync(logPath, 'utf8').split('\0\0').filter(Boolean).map((call) => call.split('\0'))
      : [];

    return {
      status: child.status,
      signal: child.signal,
      stdout: child.stdout,
      stderr: child.stderr,
      calls,
      injectedFileExists: existsSync(join(root, 'burn4-injected')),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
