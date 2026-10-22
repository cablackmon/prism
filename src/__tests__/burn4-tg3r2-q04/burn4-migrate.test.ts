import { fixtureFiles, memoryDatabase, runMigration } from './burn4-migrate-harness';

const upgrade = '0000_upgrade';
const first = '0001_alpha';
const second = '0002_beta';
const files = fixtureFiles(`${upgrade}.sql`, `${first}.sql`, `${second}.sql`);

function eventNames(events: Awaited<ReturnType<typeof runMigration>>['events'], kind: string) {
  return events.filter(event => event.kind === kind).map(event => event.name);
}

describe('burn4 migration startup and connection lifecycle', () => {
  test('missing fake configuration exits before constructing a client or touching migration files', async () => {
    const result = await runMigration({ missingConfiguration: true });
    expect(result.configurationReads).toBe(1);
    expect(result.configurations).toHaveLength(0);
    expect(result.events).toEqual([]);
    expect(result.exits).toEqual([1]);
    expect(result.errors).toEqual(['[migrate] ERROR: DATABASE_URL is not set']);
  });

  test('uses only allowlisted fake modules and a single opaque configuration read', async () => {
    const result = await runMigration({ database: memoryDatabase(upgrade), files: {} });
    expect(result.requiredModules).toEqual(['postgres', 'fs', 'path']);
    expect(result.configurationReads).toBe(1);
    expect(result.configurations).toHaveLength(1);
    expect(typeof result.configurations[0]).toBe('symbol');
    expect(result.factoryOptions).toEqual([{
      max: 1, connect_timeout: 10, onnotice: expect.any(Function),
    }]);
    const beforeNotice = [...result.messages];
    result.factoryOptions[0]?.onnotice();
    expect(result.messages).toEqual(beforeNotice);
    expect(result.exits).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('factory failure is reported without attempting to close an uncreated client', async () => {
    const result = await runMigration({ factoryFailure: 'client construction fixture failure' });
    expect(result.events).toEqual([]);
    expect(result.errors).toEqual(['[migrate] Fatal error: client construction fixture failure']);
    expect(result.exits).toEqual([1]);
  });

  test('waits two seconds between connection failures and starts metadata only after readiness', async () => {
    const result = await runMigration({ database: memoryDatabase(upgrade), files: {}, unavailableAttempts: 2 });
    expect(result.events.slice(0, 6)).toEqual([
      { kind: 'ready' }, { kind: 'sleep', milliseconds: 2000 },
      { kind: 'ready' }, { kind: 'sleep', milliseconds: 2000 },
      { kind: 'ready' }, { kind: 'create-table' },
    ]);
    expect(result.messages.slice(0, 3)).toEqual([
      '[migrate] Waiting for database... (1/15)',
      '[migrate] Waiting for database... (2/15)',
      '[migrate] Connected',
    ]);
    expect(result.readinessAttempts).toBe(3);
    expect(result.events.filter(event => event.kind === 'close')).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  test('allows the fifteenth readiness attempt to succeed without an extra delay', async () => {
    const result = await runMigration({ database: memoryDatabase(upgrade), files: {}, unavailableAttempts: 14 });
    expect(result.readinessAttempts).toBe(15);
    expect(result.events.filter(event => event.kind === 'sleep')).toHaveLength(14);
    expect(result.events.filter(event => event.kind === 'create-table')).toHaveLength(1);
    expect(result.messages).toContain('[migrate] Complete');
    expect(result.exits).toEqual([]);
  });

  test('exhausted readiness closes once and exits without inspecting the filesystem', async () => {
    const result = await runMigration({ unavailableAttempts: 15 });
    expect(result.readinessAttempts).toBe(15);
    expect(result.events.filter(event => event.kind === 'sleep')).toHaveLength(14);
    expect(result.events.filter(event => !['ready', 'sleep', 'close'].includes(event.kind))).toEqual([]);
    expect(result.events.at(-1)).toEqual({ kind: 'close' });
    expect(result.errors).toEqual(['[migrate] Fatal error: Database not reachable after 15 attempts']);
    expect(result.exits).toEqual([1]);
  });

  test.each([
    ['tracking table failure', { createFailure: 'tracking table fixture failure' }, 'tracking table fixture failure'],
    ['initial migration lookup failure', { selectFailureOnCall: 1 }, 'record lookup fixture failure'],
  ])('%s closes the client before reporting failure and never reads files', async (_label, options, message) => {
    const result = await runMigration(options);
    expect(result.events.filter(event => ['exists', 'list', 'read', 'begin'].includes(event.kind))).toEqual([]);
    expect(result.events.at(-1)).toEqual({ kind: 'close' });
    expect(result.errors).toEqual([`[migrate] Fatal error: ${message}`]);
    expect(result.exits).toEqual([1]);
  });
});

describe('burn4 baseline upgrade transactions and recovery', () => {
  test('a tracking table without an upgrade record still requires the baseline file', async () => {
    const database = memoryDatabase('prior_manual_entry');
    const result = await runMigration({ database, missingUpgrade: true });
    expect(result.errors).toEqual(['[migrate] Fatal error: drizzle/0000_upgrade.sql not found']);
    expect(eventNames(result.events, 'exists')).toEqual(['0000_upgrade.sql']);
    expect(result.events.filter(event => ['begin', 'list', 'read'].includes(event.kind))).toEqual([]);
    expect([...database.records]).toEqual(['prior_manual_entry']);
    expect(result.exits).toEqual([1]);
    expect(result.events.at(-1)).toEqual({ kind: 'close' });
  });

  test('baseline existence check failure reaches cleanup without beginning a transaction', async () => {
    const result = await runMigration({ existsFailure: 'exists fixture failure' });
    expect(result.errors).toEqual(['[migrate] Fatal error: exists fixture failure']);
    expect(result.events.filter(event => event.kind === 'begin')).toEqual([]);
    expect(result.events.at(-1)).toEqual({ kind: 'close' });
    expect(result.exits).toEqual([1]);
  });

  test('baseline read failure does not open or record a transaction', async () => {
    const result = await runMigration({ readFailures: ['0000_upgrade.sql'] });
    expect(result.errors).toEqual(['[migrate] Fatal error: read fixture failure: 0000_upgrade.sql']);
    expect(result.database.records.size).toBe(0);
    expect(result.database.effects).toEqual([]);
    expect(result.events.filter(event => event.kind === 'begin')).toEqual([]);
    expect(result.events.at(-1)).toEqual({ kind: 'close' });
    expect(result.exits).toEqual([1]);
  });

  test('baseline execution and its record share one transaction before refreshing applied state', async () => {
    const result = await runMigration();
    expect(result.events).toEqual([
      { kind: 'ready' }, { kind: 'create-table' }, { kind: 'select-records' },
      { kind: 'exists', name: '0000_upgrade.sql' }, { kind: 'read', name: '0000_upgrade.sql' },
      { kind: 'begin', transaction: 1 }, { kind: 'execute', name: '0000_upgrade.sql', transaction: 1 },
      { kind: 'record', name: upgrade, transaction: 1 }, { kind: 'commit', transaction: 1 },
      { kind: 'select-records' }, { kind: 'list' }, { kind: 'close' },
    ]);
    expect([...result.database.records]).toEqual([upgrade]);
    expect(result.database.effects).toEqual(['0000_upgrade.sql']);
    expect(result.messages).toContain('[migrate] No pending migrations');
    expect(result.messages.at(-1)).toBe('[migrate] Complete');
    expect(result.errors).toEqual([]);
  });

  test('baseline execution failure rolls back and never records or starts pending files', async () => {
    const result = await runMigration({ files, executeFailures: ['0000_upgrade.sql'] });
    expect(result.database.records.size).toBe(0);
    expect(result.database.effects).toEqual([]);
    expect(eventNames(result.events, 'record')).toEqual([]);
    expect(result.events.slice(-2)).toEqual([{ kind: 'rollback', transaction: 1 }, { kind: 'close' }]);
    expect(result.events.filter(event => event.kind === 'list')).toEqual([]);
    expect(result.errors).toEqual(['[migrate] Fatal error: execution fixture failure: 0000_upgrade.sql']);
    expect(result.exits).toEqual([1]);
  });

  test('baseline record failure rolls back its SQL effect and a fresh invocation retries it', async () => {
    const database = memoryDatabase();
    const failed = await runMigration({ database, recordFailures: [upgrade] });
    expect(database.effects).toEqual([]);
    expect(database.records.size).toBe(0);
    expect(failed.events.slice(-2)).toEqual([{ kind: 'rollback', transaction: 1 }, { kind: 'close' }]);
    expect(failed.errors).toEqual(['[migrate] Fatal error: record fixture failure: 0000_upgrade']);
    expect(failed.exits).toEqual([1]);

    const retry = await runMigration({ database });
    expect(database.effects).toEqual(['0000_upgrade.sql']);
    expect([...database.records]).toEqual([upgrade]);
    expect(eventNames(retry.events, 'execute')).toEqual(['0000_upgrade.sql']);
    expect(retry.errors).toEqual([]);
  });

  test('post-upgrade lookup failure preserves its committed baseline for the next startup', async () => {
    const database = memoryDatabase();
    const failed = await runMigration({ database, files, selectFailureOnCall: 2 });
    expect(database.effects).toEqual(['0000_upgrade.sql']);
    expect([...database.records]).toEqual([upgrade]);
    expect(failed.events.filter(event => event.kind === 'list')).toEqual([]);
    expect(failed.errors).toEqual(['[migrate] Fatal error: record lookup fixture failure']);
    expect(failed.exits).toEqual([1]);

    const retry = await runMigration({ database, files });
    expect(eventNames(retry.events, 'execute')).toEqual([`${first}.sql`, `${second}.sql`]);
    expect(retry.events.filter(event => event.kind === 'exists')).toEqual([]);
    expect(database.effects).toEqual(['0000_upgrade.sql', `${first}.sql`, `${second}.sql`]);
    expect(retry.errors).toEqual([]);
  });

  test('recorded baseline is skipped even when its file no longer exists', async () => {
    const result = await runMigration({ database: memoryDatabase(upgrade), files: {}, missingUpgrade: true });
    expect(result.events.filter(event => ['exists', 'read', 'begin'].includes(event.kind))).toEqual([]);
    expect(result.messages).toContain('[migrate] No pending migrations');
    expect(result.messages.at(-1)).toBe('[migrate] Complete');
    expect(result.errors).toEqual([]);
  });
});

describe('burn4 pending migration ordering and atomic boundaries', () => {
  test('sorts filenames before execution, excludes non-SQL entries and skips exact recorded names', async () => {
    const localFiles = fixtureFiles('0010_tenth.sql', '0002_second.sql', '0001_first.sql', '0000_upgrade.sql', '0003_recorded.sql');
    const result = await runMigration({
      database: memoryDatabase(upgrade, '0003_recorded'), files: localFiles,
      directoryEntries: ['0010_tenth.sql', 'notes.md', '0003_recorded.sql', '0000_upgrade.sql', '0002_second.sql', '0001_first.sql', 'ignored.SQL'],
    });
    expect(eventNames(result.events, 'read')).toEqual(['0001_first.sql', '0002_second.sql', '0010_tenth.sql']);
    expect(eventNames(result.events, 'execute')).toEqual(['0001_first.sql', '0002_second.sql', '0010_tenth.sql']);
    expect(eventNames(result.events, 'record')).toEqual(['0001_first', '0002_second', '0010_tenth']);
    expect(result.events.filter(event => event.kind === 'commit')).toHaveLength(3);
    expect(result.errors).toEqual([]);
  });

  test('each numbered migration executes and records in its own transaction before the next file is read', async () => {
    const result = await runMigration({ database: memoryDatabase(upgrade), files });
    const start = result.events.findIndex(event => event.kind === 'read');
    expect(result.events.slice(start)).toEqual([
      { kind: 'read', name: `${first}.sql` }, { kind: 'begin', transaction: 1 },
      { kind: 'execute', name: `${first}.sql`, transaction: 1 }, { kind: 'record', name: first, transaction: 1 },
      { kind: 'commit', transaction: 1 }, { kind: 'read', name: `${second}.sql` },
      { kind: 'begin', transaction: 2 }, { kind: 'execute', name: `${second}.sql`, transaction: 2 },
      { kind: 'record', name: second, transaction: 2 }, { kind: 'commit', transaction: 2 }, { kind: 'close' },
    ]);
    expect(result.database.effects).toEqual([`${first}.sql`, `${second}.sql`]);
    expect(result.errors).toEqual([]);
  });

  test('directory listing failure preserves a previously committed baseline and closes the client', async () => {
    const result = await runMigration({ directoryFailure: 'directory fixture failure' });
    expect([...result.database.records]).toEqual([upgrade]);
    expect(result.database.effects).toEqual(['0000_upgrade.sql']);
    expect(result.events.at(-1)).toEqual({ kind: 'close' });
    expect(result.errors).toEqual(['[migrate] Fatal error: directory fixture failure']);
    expect(result.exits).toEqual([1]);
  });

  test('pending read failure keeps earlier commits and never starts the unread file transaction', async () => {
    const result = await runMigration({ database: memoryDatabase(upgrade), files, readFailures: [`${second}.sql`] });
    expect([...result.database.records]).toEqual([upgrade, first]);
    expect(result.database.effects).toEqual([`${first}.sql`]);
    expect(result.events.filter(event => event.kind === 'begin')).toHaveLength(1);
    expect(result.errors).toEqual([`[migrate] Fatal error: read fixture failure: ${second}.sql`]);
    expect(result.events.at(-1)).toEqual({ kind: 'close' });
    expect(result.exits).toEqual([1]);
  });

  test('transaction open failure leaves earlier commits intact and never runs that migration SQL', async () => {
    const result = await runMigration({ database: memoryDatabase(upgrade), files, beginFailureOnCall: 2 });
    expect([...result.database.records]).toEqual([upgrade, first]);
    expect(result.database.effects).toEqual([`${first}.sql`]);
    expect(eventNames(result.events, 'execute')).toEqual([`${first}.sql`]);
    expect(result.errors).toEqual(['[migrate] Fatal error: begin fixture failure']);
    expect(result.exits).toEqual([1]);
    expect(result.events.at(-1)).toEqual({ kind: 'close' });
  });

  test('failed pending SQL rolls back its own effects and prevents later files from executing', async () => {
    const localFiles = fixtureFiles(`${first}.sql`, `${second}.sql`, '0003_later.sql');
    const result = await runMigration({ database: memoryDatabase(upgrade), files: localFiles, executeFailures: [`${second}.sql`] });
    expect([...result.database.records]).toEqual([upgrade, first]);
    expect(result.database.effects).toEqual([`${first}.sql`]);
    expect(eventNames(result.events, 'read')).toEqual([`${first}.sql`, `${second}.sql`]);
    expect(eventNames(result.events, 'record')).toEqual([first]);
    expect(result.events.slice(-2)).toEqual([{ kind: 'rollback', transaction: 2 }, { kind: 'close' }]);
    expect(result.errors).toEqual([`[migrate] Fatal error: execution fixture failure: ${second}.sql`]);
    expect(result.exits).toEqual([1]);
    expect(result.messages).not.toContain('[migrate] Complete');
    expect(result.messages).not.toContain(`[migrate] ${second}.sql done`);
  });

  test('failed pending record rolls back successful SQL and retry skips only earlier commits', async () => {
    const database = memoryDatabase(upgrade);
    const failed = await runMigration({ database, files, recordFailures: [second] });
    expect([...database.records]).toEqual([upgrade, first]);
    expect(database.effects).toEqual([`${first}.sql`]);
    expect(failed.errors).toEqual([`[migrate] Fatal error: record fixture failure: ${second}`]);
    expect(failed.events.slice(-2)).toEqual([{ kind: 'rollback', transaction: 2 }, { kind: 'close' }]);
    expect(failed.exits).toEqual([1]);

    const retry = await runMigration({ database, files });
    expect(eventNames(retry.events, 'execute')).toEqual([`${second}.sql`]);
    expect(database.effects).toEqual([`${first}.sql`, `${second}.sql`]);
    expect([...database.records]).toEqual([upgrade, first, second]);
    expect(retry.errors).toEqual([]);
  });

  test('a complete rerun reads tracking state but applies no migration twice', async () => {
    const database = memoryDatabase();
    const initial = await runMigration({ database, files });
    expect(initial.errors).toEqual([]);
    const effects = [...database.effects];
    const repeated = await runMigration({ database, files });
    expect(repeated.events.map(event => event.kind)).toEqual(['ready', 'create-table', 'select-records', 'list', 'close']);
    expect(database.effects).toEqual(effects);
    expect([...database.records]).toEqual([upgrade, first, second]);
    expect(repeated.messages).toContain('[migrate] No pending migrations');
    expect(repeated.errors).toEqual([]);
    expect(repeated.exits).toEqual([]);
  });
});

describe('burn4 cleanup failures', () => {
  test('close failure reports fatal exit after successful work and next startup skips committed migrations', async () => {
    const database = memoryDatabase();
    const failed = await runMigration({ database, files, closeFailure: 'close fixture failure' });
    expect(database.effects).toEqual(['0000_upgrade.sql', `${first}.sql`, `${second}.sql`]);
    expect(failed.messages.at(-1)).toBe('[migrate] Complete');
    expect(failed.events.at(-1)).toEqual({ kind: 'close' });
    expect(failed.errors).toEqual(['[migrate] Fatal error: close fixture failure']);
    expect(failed.exits).toEqual([1]);
    const retry = await runMigration({ database, files });
    expect(eventNames(retry.events, 'execute')).toEqual([]);
    expect(retry.errors).toEqual([]);
    expect(retry.exits).toEqual([]);
  });

  test('combined execution and close failures still roll back and close once before exiting', async () => {
    const result = await runMigration({ executeFailures: ['0000_upgrade.sql'], closeFailure: 'close fixture failure' });
    expect(result.database.effects).toEqual([]);
    expect(result.database.records.size).toBe(0);
    expect(result.events.slice(-2)).toEqual([{ kind: 'rollback', transaction: 1 }, { kind: 'close' }]);
    expect(result.exits).toEqual([1]);
    expect(result.errors).toEqual(['[migrate] Fatal error: close fixture failure']);
  });

  test.failing('KNOWN GAP: a cleanup failure hides the original migration failure diagnostic', async () => {
    const result = await runMigration({ executeFailures: ['0000_upgrade.sql'], closeFailure: 'close fixture failure' });
    expect(result.errors.join('\n')).toContain('execution fixture failure: 0000_upgrade.sql');
  });
});
