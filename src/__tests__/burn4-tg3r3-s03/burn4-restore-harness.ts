import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export type SqlPhase = 'terminate' | 'drop' | 'create' | 'load';
export type FixtureOptions = {
  failPhase?: SqlPhase;
  failCode?: number;
  sqlErrorPhase?: SqlPhase;
  sleepCode?: number;
  decompressionFailureAfter?: string;
};
export type CommandRecord = {
  tool: string;
  args: string[];
  phase?: SqlPhase;
  stdin?: string;
  stopsOnSqlError?: boolean;
};
export type RestoreResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  commands: CommandRecord[];
};

const sourcePath = resolve(__dirname, '../../..', 'scripts/restore.sh');
const source = readFileSync(sourcePath, 'utf8');

/** Only the usage listing's absolute backup root is relocated in the copied text. */
export function restoreFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync('/tmp/burn4-prism-restore-');
  const backupRoot = join(root, 'burn4-backups');
  const bin = join(root, 'burn4-bin');
  const script = join(root, 'burn4-restore.sh');
  const trace = join(root, 'burn4-trace.jsonl');
  mkdirSync(backupRoot);
  mkdirSync(bin);
  writeFileSync(script, source.replace('/backups/prism_*.sql.gz', `${backupRoot}/prism_*.sql.gz`));
  const fakePath = join(bin, 'burn4-command.cjs');
  writeFileSync(fakePath, `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const config = ${JSON.stringify(options)};
const trace = ${JSON.stringify(trace)};
function record(value) { fs.appendFileSync(trace, JSON.stringify({tool, args, ...value}) + '\\n'); }
if (tool === 'date') { record({}); process.stdout.write('fixture-date\\n'); }
else if (tool === 'sleep') { record({}); process.exit(config.sleepCode || 0); }
else if (tool === 'gunzip') {
  record({});
  if (config.decompressionFailureAfter !== undefined) {
    process.stdout.write(config.decompressionFailureAfter);
    process.stderr.write('fixture gunzip: corrupt trailer\\n');
    process.exitCode = 2;
  } else {
    try { process.stdout.write(zlib.gunzipSync(fs.readFileSync(args[1]))); }
    catch { process.stderr.write('fixture gunzip: invalid gzip\\n'); process.exitCode = 1; }
  }
}
else if (tool === 'psql') {
  const commandIndex = args.indexOf('-c');
  const sql = commandIndex >= 0 ? args[commandIndex + 1] : fs.readFileSync(0, 'utf8');
  const phase = commandIndex < 0 ? 'load' : /pg_terminate_backend/.test(sql) ? 'terminate' : /^DROP/.test(sql) ? 'drop' : /^CREATE/.test(sql) ? 'create' : 'unexpected';
  const stopsOnSqlError = args.some((arg, index) => /^(ON_ERROR_STOP=(1|on|true)|--set=ON_ERROR_STOP=(1|on|true))$/i.test(arg) || (arg === '--set' && /^ON_ERROR_STOP=(1|on|true)$/i.test(args[index + 1] || '')));
  record({phase, stdin: sql, stopsOnSqlError});
  if (phase === 'unexpected') process.exitCode = 97;
  else if (config.failPhase === phase) process.exitCode = config.failCode || 23;
  else if (config.sqlErrorPhase === phase) {
    process.stderr.write('fixture psql: ERROR: simulated SQL statement failure\\n');
    process.exitCode = commandIndex >= 0 ? 1 : stopsOnSqlError ? 3 : 0;
  }
} else { process.stderr.write('Unallowlisted fixture command\\n'); process.exitCode = 99; }
`);
  chmodSync(fakePath, 0o755);
  for (const command of ['psql', 'gunzip', 'sleep', 'date']) {
    symlinkSync(fakePath, join(bin, command));
  }
  // Local listing is the only allowlisted real child tool. All service tools are fakes.
  symlinkSync('/bin/ls', join(bin, 'ls'));

  return {
    root,
    backupRoot,
    backup(name = 'prism_fixture.sql.gz', sql = 'SELECT 17;\n') {
      const file = join(backupRoot, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, gzipSync(sql));
      return file;
    },
    rawBackup(name: string, contents: string | Buffer) {
      const file = join(backupRoot, name);
      writeFileSync(file, contents);
      return file;
    },
    run(args: string[]): RestoreResult {
      rmSync(trace, { force: true });
      const child = spawnSync('/bin/sh', [script, ...args], {
        cwd: root,
        env: { PATH: bin, POSTGRES_PASSWORD: '' },
        encoding: 'utf8',
        timeout: 4_000,
        maxBuffer: 1024 * 1024,
      });
      if (child.error) throw child.error;
      let commands: CommandRecord[] = [];
      try {
        commands = readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean)
          .map((line: string) => JSON.parse(line) as CommandRecord);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      return {
        status: child.status,
        signal: child.signal,
        stdout: child.stdout,
        stderr: child.stderr,
        commands,
      };
    },
    assertContained() {
      for (const command of ['psql', 'gunzip', 'sleep', 'date', 'ls']) {
        if (!lstatSync(join(bin, command)).isSymbolicLink()) throw new Error('Fixture command escaped allowlist');
      }
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

export function sqlCommands(result: RestoreResult): CommandRecord[] {
  return result.commands.filter((command) => command.tool === 'psql');
}
