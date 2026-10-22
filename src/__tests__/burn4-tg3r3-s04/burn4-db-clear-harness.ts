import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const contentTables = [
  'goal_achievements', 'goals',
  'photos', 'photo_sources',
  'chore_completions', 'chores',
  'maintenance_completions', 'maintenance_reminders',
  'shopping_items', 'shopping_lists',
  'meals', 'family_messages', 'tasks', 'birthdays', 'events', 'layouts',
  'calendar_sources', 'calendar_groups',
  'settings', 'api_credentials',
] as const;

export const omittedContentTables = [
  'recipes', 'travel_trips', 'weekend_places', 'dismissed_birthdays',
] as const;

type Options = {
  args?: string[];
  failInvocation?: number;
  failureStatus?: number;
  sqlErrorTable?: string;
  missingPsql?: boolean;
};

export type RecordedCall = {
  args: string[];
  sql: string;
  tables: string[];
  failedTables: string[];
  onErrorStop: boolean;
  status: number;
};

export type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: RecordedCall[];
  initialRows: Record<string, number>;
  rows: Record<string, number>;
};

/** Runs unchanged shell source with a single allowlisted, local fake executable. */
export function runClear(options: Options = {}): RunResult {
  const fixture = mkdtempSync(path.join(tmpdir(), 'burn4-db-clear-'));
  const bin = path.join(fixture, 'burn4-bin');
  const statePath = path.join(fixture, 'burn4-rows.json');
  const callsPath = path.join(fixture, 'burn4-calls.json');
  const initialRows: Record<string, number> = Object.fromEntries(
    [...contentTables, ...omittedContentTables, 'users', '__drizzle_migrations']
      .map((table, index) => [table, index + 1]),
  );
  const sourcePath = path.resolve(__dirname, '../../../scripts/db-clear.sh');

  mkdirSync(bin);
  writeFileSync(statePath, JSON.stringify(initialRows));
  writeFileSync(callsPath, '[]');

  // The child has no host PATH fallback or caller env. psql is a local fake.
  // Stdin SQL errors continue by default; a failed -c command exits nonzero.
  const fake = `#!${process.execPath}
const fs = require('node:fs');
const statePath = ${JSON.stringify(statePath)};
const callsPath = ${JSON.stringify(callsPath)};
const options = ${JSON.stringify(options)};
const calls = JSON.parse(fs.readFileSync(callsPath, 'utf8'));
const rows = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
const commandIndex = args.indexOf('-c');
const sql = commandIndex >= 0 ? args[commandIndex + 1] : fs.readFileSync(0, 'utf8');
const onErrorStop = args.some((arg, index) =>
  /^(--set=)?ON_ERROR_STOP=(1|on|true)$/i.test(arg) ||
  (arg === '--set' && /^ON_ERROR_STOP=(1|on|true)$/i.test(args[index + 1] || ''))
) || /\\\\set\\s+ON_ERROR_STOP\\s+(1|on|true)/i.test(sql);
const tables = [...sql.matchAll(/TRUNCATE\\s+TABLE\\s+([a-z_]+)\\s+CASCADE\\s*;/gi)]
  .map(match => match[1]);
const call = { args, sql, tables, failedTables: [], onErrorStop, status: 0 };
calls.push(call);
if (options.failInvocation === calls.length) {
  call.status = options.failureStatus || 37;
  fs.writeFileSync(callsPath, JSON.stringify(calls));
  process.stderr.write('fake psql: connection interrupted\\n');
  process.exit(call.status);
}
for (const table of tables) {
  if (table === options.sqlErrorTable) {
    call.failedTables.push(table);
    process.stderr.write('ERROR: fixture relation cannot be truncated: ' + table + '\\n');
    if (onErrorStop || commandIndex >= 0) {
      call.status = commandIndex >= 0 ? 1 : 3;
      break;
    }
  } else {
    rows[table] = 0;
  }
}
fs.writeFileSync(statePath, JSON.stringify(rows));
fs.writeFileSync(callsPath, JSON.stringify(calls));
process.exit(call.status);
`;

  try {
    if (!options.missingPsql) {
      const fakePath = path.join(bin, 'psql');
      writeFileSync(fakePath, fake);
      chmodSync(fakePath, 0o700);
    }
    const child = spawnSync('/bin/sh', [sourcePath, ...(options.args ?? [])], {
      cwd: fixture,
      env: { PATH: bin },
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    if (child.error) throw child.error;
    return {
      status: child.status,
      stdout: child.stdout,
      stderr: child.stderr,
      calls: JSON.parse(readFileSync(callsPath, 'utf8')) as RecordedCall[],
      initialRows,
      rows: JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, number>,
    };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
