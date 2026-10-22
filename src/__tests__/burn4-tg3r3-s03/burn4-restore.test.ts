import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { restoreFixture, sqlCommands, type SqlPhase } from './burn4-restore-harness';

type Fixture = ReturnType<typeof restoreFixture>;
let fixtures: Fixture[] = [];
function fixture(options?: Parameters<typeof restoreFixture>[0]): Fixture {
  const created = restoreFixture(options);
  fixtures.push(created);
  created.assertContained();
  return created;
}
afterEach(() => {
  for (const created of fixtures) created.cleanup();
  fixtures = [];
});

const phases: SqlPhase[] = ['terminate', 'drop', 'create', 'load'];

describe('restore command input and cancellation', () => {
  test.each([{ args: [] }, { args: [''] }])('missing or empty backup argument gives usage: %j', ({ args }) => {
    const result = fixture().run(args);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('Available backups:');
    expect(result.stdout).toContain('(none found)');
    expect(result.commands).toEqual([]);
  });

  test('usage lists only Prism gzip backup names in the relocated fixture directory', () => {
    const created = fixture();
    created.backup('prism_listing.sql.gz');
    created.backup('unrelated.sql.gz');
    const result = created.run([]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('prism_listing.sql.gz');
    expect(result.stdout).not.toContain('unrelated.sql.gz');
    expect(result.stdout).not.toContain('(none found)');
    expect(result.commands).toEqual([]);
  });

  test('absent backup exits before the cancellation wait and SQL', () => {
    const created = fixture();
    const absent = join(created.backupRoot, 'prism_absent file.sql.gz');
    const result = created.run([absent]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`ERROR: Backup file not found: ${absent}`);
    expect(result.commands).toEqual([]);
  });

  test('directory input is rejected as a missing regular file', () => {
    const created = fixture();
    const directory = join(created.backupRoot, 'burn4-directory');
    mkdirSync(directory);
    const result = created.run([directory]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`Backup file not found: ${directory}`);
    expect(result.commands).toEqual([]);
  });

  test.each([130, 9])('failed cancellation wait preserves status %i and starts no database commands', (sleepCode) => {
    const created = fixture({ sleepCode });
    const result = created.run([created.backup()]);
    expect(result.status).toBe(sleepCode);
    expect(result.stdout).toContain('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    expect(result.commands).toEqual([{ tool: 'sleep', args: ['5'] }]);
    expect(result.stdout).not.toContain('Starting restore');
    expect(result.stdout).not.toContain('Restore completed');
  });
});

describe('successful restore sequencing and payload integrity', () => {
  test('runs terminate, drop, create and payload load against the intended databases', () => {
    const created = fixture();
    const sql = "CREATE TABLE fixture_item (id integer);\nINSERT INTO fixture_item VALUES (17);\n";
    const result = created.run([created.backup('prism_valid.sql.gz', sql)]);
    const commands = sqlCommands(result);
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    expect(commands.map((command) => command.phase)).toEqual(phases);
    expect(commands.slice(0, 3).map((command) => command.args.slice(0, 6))).toEqual([
      ['-h', 'db', '-U', 'prism', '-d', 'postgres'],
      ['-h', 'db', '-U', 'prism', '-d', 'postgres'],
      ['-h', 'db', '-U', 'prism', '-d', 'postgres'],
    ]);
    expect(commands[0]?.stdin).toContain("WHERE datname = 'prism' AND pid <> pg_backend_pid()");
    expect(commands[1]?.stdin).toBe('DROP DATABASE IF EXISTS prism;');
    expect(commands[2]?.stdin).toBe('CREATE DATABASE prism;');
    expect(commands[3]?.args).toEqual(['-h', 'db', '-U', 'prism', '-d', 'prism']);
    expect(commands[3]?.stdin).toBe(sql);
    expect(result.commands.slice(0, 2).map((command) => command.tool)).toEqual(['sleep', 'date']);
    expect(result.commands.at(-1)?.tool).toBe('date');
    expect(result.stdout).toContain('Restore completed successfully!');
    expect(result.stdout).toContain('docker-compose restart app');
  });

  test.each(['prism backup with spaces.sql.gz', 'prism_$(unused); literal.sql.gz'])('preserves literal backup path %s as one gunzip argument', (name) => {
    const created = fixture();
    const file = created.backup(name, 'SELECT 42;\n');
    const result = created.run([file]);
    expect(result.status).toBe(0);
    expect(result.commands.find((command) => command.tool === 'gunzip')?.args).toEqual(['-c', file]);
    expect(sqlCommands(result).at(-1)?.stdin).toBe('SELECT 42;\n');
    expect(result.stdout).toContain(`Backup file: ${file}`);
  });

  test('relative backup path is resolved from the fixture working directory', () => {
    const created = fixture();
    created.backup('prism_relative.sql.gz', 'SELECT 64;\n');
    const relative = 'burn4-backups/prism_relative.sql.gz';
    const result = created.run([relative]);
    expect(result.status).toBe(0);
    expect(result.commands.find((command) => command.tool === 'gunzip')?.args).toEqual(['-c', relative]);
    expect(sqlCommands(result).at(-1)?.stdin).toBe('SELECT 64;\n');
  });

  test('backup bytes remain unchanged after a successful restore', () => {
    const created = fixture();
    const file = created.backup();
    const before = readFileSync(file);
    const result = created.run([file]);
    expect(result.status).toBe(0);
    expect(readFileSync(file)).toEqual(before);
  });
});

describe('reported command failures stop later work', () => {
  test.each(phases)('%s psql failure propagates and halts subsequent phases', (failPhase) => {
    const created = fixture({ failPhase, failCode: 27 });
    const result = created.run([created.backup()]);
    expect(result.status).toBe(27);
    expect(sqlCommands(result).map((command) => command.phase)).toEqual(phases.slice(0, phases.indexOf(failPhase) + 1));
    expect(result.commands.filter((command) => command.tool === 'gunzip')).toHaveLength(failPhase === 'load' ? 1 : 0);
    expect(result.commands.filter((command) => command.tool === 'date')).toHaveLength(1);
    expect(result.stdout).not.toContain('Restore completed successfully');
    expect(result.stdout).not.toContain('docker-compose restart app');
  });
});

describe('SQL command errors before loading', () => {
  test.each<SqlPhase>(['terminate', 'drop', 'create'])('%s SQL statement error returns failure and prevents later SQL', (sqlErrorPhase) => {
    const created = fixture({ sqlErrorPhase });
    const result = created.run([created.backup()]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fixture psql: ERROR: simulated SQL statement failure');
    expect(sqlCommands(result).map((command) => command.phase)).toEqual(phases.slice(0, phases.indexOf(sqlErrorPhase) + 1));
    expect(result.commands.some((command) => command.tool === 'gunzip')).toBe(false);
    expect(result.stdout).not.toContain('Restore completed');
  });
});

describe('existing restore defects', () => {
  test.failing('KNOWN GAP: corrupt gzip failure is hidden by the successful final psql pipeline stage', () => {
    const created = fixture();
    const result = created.run([created.rawBackup('prism_corrupt.sql.gz', 'invalid gzip fixture')]);
    if (!result.stderr.includes('fixture gunzip: invalid gzip')) throw new Error('Corrupt input did not reach the decompressor');
    expect(result.status).not.toBe(0);
  });

  test.failing('KNOWN GAP: partial decompression failure is hidden after SQL bytes have reached psql', () => {
    const created = fixture({ decompressionFailureAfter: 'SELECT 7;\n' });
    const result = created.run([created.backup()]);
    if (sqlCommands(result).at(-1)?.stdin !== 'SELECT 7;\n') throw new Error('Partial SQL did not reach the load phase');
    expect(result.status).not.toBe(0);
  });

  test.failing('KNOWN GAP: corrupt backup is not validated before the existing database is dropped', () => {
    const created = fixture();
    const result = created.run([created.rawBackup('prism_corrupt.sql.gz', 'invalid gzip fixture')]);
    if (!result.stderr.includes('fixture gunzip: invalid gzip')) throw new Error('Corrupt input did not reach the decompressor');
    expect(sqlCommands(result).map((command) => command.phase)).not.toContain('drop');
  });

  test.failing('KNOWN GAP: load SQL statement errors are accepted because ON_ERROR_STOP is absent', () => {
    const sqlErrorPhase = 'load';
    const created = fixture({ sqlErrorPhase });
    const result = created.run([created.backup()]);
    if (!result.stderr.includes('fixture psql: ERROR: simulated SQL statement failure')) throw new Error('SQL error did not reach the selected phase');
    expect(result.status).not.toBe(0);
  });
});
