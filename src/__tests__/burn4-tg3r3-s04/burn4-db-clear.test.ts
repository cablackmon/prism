import { contentTables, omittedContentTables, runClear } from './burn4-db-clear-harness';

describe('db-clear command and recorded SQL', () => {
  test('default mode submits content before the separate user truncate', () => {
    const result = runClear();

    expect(result.status).toBe(0);
    expect(result.calls.map(call => call.tables)).toEqual([[...contentTables], ['users']]);
    expect(result.calls.map(call => call.args)).toEqual([
      ['-U', 'prism', '-d', 'prism'],
      ['-U', 'prism', '-d', 'prism', '-c', 'TRUNCATE TABLE users CASCADE;'],
    ]);
    expect(result.stdout).toContain('Mode: Clearing ALL data including family members');
  });

  test('all documented content groups receive CASCADE truncation in dependency order', () => {
    const result = runClear({ args: ['--keep-users'] });
    const sql = result.calls[0]!.sql;
    const statements = sql.replace(/^--.*$/gm, '').split(';').map(line => line.trim()).filter(Boolean);

    expect(statements).toEqual(contentTables.map(table => `TRUNCATE TABLE ${table} CASCADE`));
    expect(result.calls[0]!.tables).toHaveLength(20);
  });

  test('default mode removes the listed fixture content and users', () => {
    const result = runClear();

    expect(Object.fromEntries([...contentTables, 'users'].map(table => [table, result.rows[table]])))
      .toEqual(Object.fromEntries([...contentTables, 'users'].map(table => [table, 0])));
    expect(result.stdout.indexOf('Cleared all content tables'))
      .toBeLessThan(result.stdout.indexOf('Cleared users table'));
    expect(result.stdout.indexOf('Cleared users table'))
      .toBeLessThan(result.stdout.indexOf('Database cleared!'));
  });

  test('keep-users actually preserves fixture family rows while clearing listed content', () => {
    const result = runClear({ args: ['--keep-users'] });

    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.rows.users).toBe(result.initialRows.users);
    expect(contentTables.map(table => result.rows[table])).toEqual(contentTables.map(() => 0));
    expect(result.stdout).toContain('Mode: Clearing data but KEEPING family members');
    expect(result.stdout).toContain('Family members were preserved.');
    expect(result.stdout).not.toContain('Cleared users table');
  });

  test('repeated keep-users flags still preserve users and execute content only once', () => {
    const result = runClear({ args: ['--keep-users', '--keep-users', '--keep-users'] });

    expect(result.status).toBe(0);
    expect(result.calls.map(call => call.tables)).toEqual([[...contentTables]]);
    expect(result.rows.users).toBe(result.initialRows.users);
  });

  test.each([
    { mode: 'default', args: [] },
    { mode: 'keep-users', args: ['--keep-users'] },
  ])('schema metadata is not truncated in $mode mode', ({ args }) => {
    const result = runClear({ args });

    expect(result.rows.__drizzle_migrations).toBe(result.initialRows.__drizzle_migrations);
    expect(result.calls.every(call => !/DROP\s|ALTER\s|DELETE\s|CREATE\s/i.test(call.sql))).toBe(true);
  });

  test('success guidance is printed without executing docker or a seed command', () => {
    const result = runClear({ args: ['--keep-users'] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('docker exec prism-db psql');
    expect(result.stderr).toBe('');
    expect(result.calls).toHaveLength(1);
  });

  test('default success guidance names the family and data seed action', () => {
    const result = runClear();

    expect(result.stdout).toContain('All data cleared including users.');
    expect(result.stdout).toContain('Run seed to create sample family and data.');
    expect(result.stdout).not.toContain('Family members were preserved.');
  });
});

describe('db-clear process failures and phase boundaries', () => {
  test.each([
    { mode: 'default', args: [] },
    { mode: 'keep-users', args: ['--keep-users'] },
  ])('first psql process failure halts $mode mode', ({ args }) => {
    const result = runClear({ args, failInvocation: 1, failureStatus: 42 });

    expect(result.status).toBe(42);
    expect(result.calls).toHaveLength(1);
    expect(result.rows).toEqual(result.initialRows);
    expect(result.stderr).toContain('fake psql: connection interrupted');
    expect(result.stdout).not.toContain('Cleared all content tables');
    expect(result.stdout).not.toContain('Database cleared!');
  });

  test('user psql process failure occurs after content and suppresses final success', () => {
    const result = runClear({ failInvocation: 2, failureStatus: 43 });

    expect(result.status).toBe(43);
    expect(result.calls.map(call => call.tables)).toEqual([[...contentTables], ['users']]);
    expect(result.stdout).toContain('Cleared all content tables');
    expect(result.stdout).not.toContain('Cleared users table');
    expect(result.stdout).not.toContain('Database cleared!');
    expect(contentTables.map(table => result.rows[table])).toEqual(contentTables.map(() => 0));
    expect(result.rows.users).toBe(result.initialRows.users);
  });

  test('user SQL failure in psql command mode propagates and suppresses final success', () => {
    const result = runClear({ sqlErrorTable: 'users' });

    expect(result.status).toBe(1);
    expect(result.calls[1]!.failedTables).toEqual(['users']);
    expect(result.rows.users).toBe(result.initialRows.users);
    expect(result.stdout).not.toContain('Cleared users table');
    expect(result.stdout).not.toContain('Database cleared!');
  });

  test('missing fake psql has no fallback to a real database client', () => {
    const result = runClear({ missingPsql: true });

    expect(result.status).toBe(127);
    expect(result.calls).toEqual([]);
    expect(result.rows).toEqual(result.initialRows);
    expect(result.stderr).toContain('psql: not found');
    expect(result.stdout).not.toContain('Database cleared!');
  });
});

describe('db-clear named safety gaps', () => {
  test.failing.each(['--keep-user', '--help', 'unexpected-argument'])(
    'KNOWN GAP: unrecognized argument %s starts destructive clearing instead of rejecting it',
    argument => {
      const result = runClear({ args: [argument] });

      expect(result.calls).toEqual([]);
    },
  );

  test.failing('KNOWN GAP: a content SQL error is ignored and users are cleared with a success message', () => {
    const result = runClear({ sqlErrorTable: 'goals' });

    expect({
      success: result.stdout.includes('Database cleared!'),
      users: result.rows.users,
      calls: result.calls.length,
    }).toEqual({ success: false, users: result.initialRows.users, calls: 1 });
  });

  test.failing('KNOWN GAP: keep-users leaves newer user content tables uncleared', () => {
    const result = runClear({ args: ['--keep-users'] });

    expect(Object.fromEntries(omittedContentTables.map(table => [table, result.rows[table]])))
      .toEqual(Object.fromEntries(omittedContentTables.map(table => [table, 0])));
  });

  test.failing('KNOWN GAP: default clear leaves independent birthday tombstones behind', () => {
    const result = runClear();

    expect(result.rows.dismissed_birthdays).toBe(0);
  });
});
