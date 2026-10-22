import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type Phase = 'truncate' | 'seed' | 'cache';

export type TraceEntry = {
  command: 'date' | 'docker';
  args: string[];
  phase?: Phase;
  offeredStdin?: string;
  deliveredStdin?: string;
};

type FixtureOptions = {
  containers?: Partial<Record<'DB_CONTAINER' | 'APP_CONTAINER' | 'REDIS_CONTAINER', string>>;
  failAt?: Phase;
  failStatus?: number;
  commandOutput?: Partial<Record<Phase, string>>;
};

export type ResetResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  trace: TraceEntry[];
};

const sourcePath = path.resolve(__dirname, '../../..', 'scripts/demo-reset.sh');

export function createResetFixture(options: FixtureOptions = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'burn4-demo-reset-'));
  const binaryDirectory = path.join(directory, 'burn4-bin');
  const tracePath = path.join(directory, 'burn4-trace.jsonl');
  mkdirSync(binaryDirectory);
  writeFileSync(tracePath, '');

  // Both command names resolve only inside this disposable directory. Each fake
  // has an absolute Node shebang, so PATH never falls through to host tools.
  const fakeSource = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const tracePath = ${JSON.stringify(tracePath)};
const config = ${JSON.stringify(options)};
const args = process.argv.slice(2);
const command = path.basename(process.argv[1]);
function record(entry) { fs.appendFileSync(tracePath, JSON.stringify(entry) + '\\n'); }
function reject(message) {
  process.stderr.write('Unapproved fake command: ' + message + '\\n');
  process.exit(90);
}
if (command === 'date') {
  record({ command, args });
  if (JSON.stringify(args) !== JSON.stringify(['-u', '+%Y-%m-%dT%H:%M:%SZ'])) {
    reject('date arguments');
  }
  process.stdout.write('2026-10-21T00:00:00Z\\n');
  process.exit(0);
}
if (command !== 'docker' || args[0] !== 'exec') reject('docker exec required');
let cursor = 1;
let interactive = false;
if (args[cursor] === '-i' || args[cursor] === '--interactive') {
  interactive = true;
  cursor += 1;
}
const container = args[cursor++];
const inner = args.slice(cursor);
const containers = config.containers || {};
const db = containers.DB_CONTAINER || 'prism-db';
const redis = containers.REDIS_CONTAINER || 'prism-redis';
let phase;
if (JSON.stringify(inner) === JSON.stringify(['psql', '-U', 'prism', '-d', 'prism'])) {
  phase = 'truncate';
} else if (JSON.stringify(inner) === JSON.stringify([
  'psql', '-U', 'prism', '-d', 'prism', '-f', '/docker-entrypoint-initdb.d/03-seed.sql'
])) {
  phase = 'seed';
} else if (JSON.stringify(inner) === JSON.stringify(['redis-cli', 'FLUSHDB'])) {
  phase = 'cache';
} else {
  reject('unexpected inner command');
}
if (container !== (phase === 'cache' ? redis : db)) reject('container mismatch');
const offeredStdin = fs.readFileSync(0, 'utf8');
// Docker exec forwards stdin only with --interactive/-i. An empty psql stdin
// exits successfully, which allows this script's missing -i to stay silent.
const deliveredStdin = interactive ? offeredStdin : '';
record({ command, args, phase, offeredStdin, deliveredStdin });
if (config.failAt === phase) {
  process.stderr.write('fixture ' + phase + ' failure\\n');
  process.exit(config.failStatus || 41);
}
process.stdout.write((config.commandOutput || {})[phase] || '');
`;
  for (const name of ['docker', 'date']) {
    writeFileSync(path.join(binaryDirectory, name), fakeSource, { mode: 0o755 });
  }

  function trace(): TraceEntry[] {
    return readFileSync(tracePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line: string) => JSON.parse(line) as TraceEntry);
  }

  function run(): ResetResult {
    const result = spawnSync('/bin/sh', [sourcePath], {
      cwd: directory,
      env: { PATH: binaryDirectory, ...options.containers },
      input: '',
      encoding: 'utf8',
      timeout: 4_000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      trace: trace(),
    };
  }

  function calibrateDocker(interactive: boolean, input: string): TraceEntry[] {
    const result = spawnSync(path.join(binaryDirectory, 'docker'), [
      'exec', ...(interactive ? ['-i'] : []), 'prism-db', 'psql', '-U', 'prism', '-d', 'prism',
    ], {
      cwd: directory,
      env: {},
      input,
      encoding: 'utf8',
      timeout: 4_000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Fake calibration failed: ${result.stderr}`);
    return trace();
  }

  return {
    run,
    calibrateDocker,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export function dockerCalls(result: ResetResult): TraceEntry[] {
  return result.trace.filter((entry) => entry.command === 'docker');
}

export function offeredSql(result: ResetResult): string {
  const sql = dockerCalls(result).find((entry) => entry.phase === 'truncate')?.offeredStdin;
  if (!sql) throw new Error('The script did not offer truncate SQL to fake Docker');
  return sql;
}
