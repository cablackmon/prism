import {
  createResetFixture,
  dockerCalls,
  offeredSql,
  type Phase,
  type ResetResult,
} from './burn4-demo-reset-fixture';

type Fixture = ReturnType<typeof createResetFixture>;
const fixtures: Fixture[] = [];

function fixture(options: Parameters<typeof createResetFixture>[0] = {}): Fixture {
  const value = createResetFixture(options);
  fixtures.push(value);
  return value;
}

function successfulRun(options: Parameters<typeof createResetFixture>[0] = {}): ResetResult {
  const result = fixture(options).run();
  expect(result.status).toBe(0);
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe('');
  return result;
}

afterEach(() => {
  for (const value of fixtures.splice(0)) value.cleanup();
});

describe('strict Docker stdin fake calibration', () => {
  test('exec -i delivers offered stdin to its inner command', () => {
    const [entry] = fixture().calibrateDocker(true, 'SELECT 1;\n');
    expect(entry).toMatchObject({ offeredStdin: 'SELECT 1;\n', deliveredStdin: 'SELECT 1;\n' });
  });

  test('exec without -i leaves inner stdin empty and exits successfully', () => {
    const [entry] = fixture().calibrateDocker(false, 'SELECT 1;\n');
    expect(entry).toMatchObject({ offeredStdin: 'SELECT 1;\n', deliveredStdin: '' });
  });
});

describe('demo-reset orchestration', () => {
  test('attempts truncate, seed and cache invalidation between UTC progress stamps', () => {
    const result = successfulRun();
    expect(result.trace.map((entry) => entry.phase ?? entry.command)).toEqual([
      'date', 'truncate', 'seed', 'cache', 'date',
    ]);
    expect(result.stdout).toBe([
      '[2026-10-21T00:00:00Z] Demo reset starting',
      '  - tables truncated',
      '  - seed reapplied',
      '  - redis flushed',
      '[2026-10-21T00:00:00Z] Demo reset complete',
      '',
    ].join('\n'));
  });

  test('uses the default database and Redis containers without starting an app command', () => {
    const calls = dockerCalls(successfulRun());
    expect(calls.map((call) => call.args[1])).toEqual(['prism-db', 'prism-db', 'prism-redis']);
    expect(calls).toHaveLength(3);
  });

  test('preserves configured container names as single arguments', () => {
    const calls = dockerCalls(successfulRun({ containers: {
      DB_CONTAINER: 'burn4 database ; harmless marker',
      REDIS_CONTAINER: 'burn4 cache with spaces',
      APP_CONTAINER: 'burn4 unused app',
    } }));
    expect(calls.map((call) => call.args[1])).toEqual([
      'burn4 database ; harmless marker',
      'burn4 database ; harmless marker',
      'burn4 cache with spaces',
    ]);
  });

  test.each([
    { DB_CONTAINER: '' },
    { REDIS_CONTAINER: '' },
    { DB_CONTAINER: '', REDIS_CONTAINER: '', APP_CONTAINER: '' },
  ])('empty configured values fall back to defaults: %j', (containers) => {
    expect(dockerCalls(successfulRun({ containers })).map((call) => call.args[1]))
      .toEqual(['prism-db', 'prism-db', 'prism-redis']);
  });

  test('targets the Prism database and applies only the mounted canonical seed file', () => {
    const [truncate, seed] = dockerCalls(successfulRun());
    expect(truncate?.args.slice(2)).toEqual(['psql', '-U', 'prism', '-d', 'prism']);
    expect(seed?.args.slice(2)).toEqual([
      'psql', '-U', 'prism', '-d', 'prism', '-f', '/docker-entrypoint-initdb.d/03-seed.sql',
    ]);
    expect(seed?.offeredStdin).toBe('');
  });

  test('flushes only the selected Redis database after seeding and suppresses command output', () => {
    const result = successfulRun({ commandOutput: { cache: 'fixture cache reply\n' } });
    expect(dockerCalls(result).at(-1)?.args).toEqual(['exec', 'prism-redis', 'redis-cli', 'FLUSHDB']);
    expect(result.stdout).not.toContain('fixture cache reply');
  });

  test('retains harmless SQL tool output for operational diagnostics', () => {
    const result = successfulRun({ commandOutput: {
      truncate: 'fixture truncate reply\n',
      seed: 'fixture seed reply\n',
    } });
    expect(result.stdout.indexOf('fixture truncate reply')).toBeLessThan(result.stdout.indexOf('  - tables truncated'));
    expect(result.stdout.indexOf('fixture seed reply')).toBeLessThan(result.stdout.indexOf('  - seed reapplied'));
    expect(result.stdout).toContain('fixture truncate reply\n');
    expect(result.stdout).toContain('fixture seed reply\n');
  });
});

describe('demo-reset truncate SQL contract', () => {
  test('constructs the table list from public tables while excluding migration bookkeeping', () => {
    const sql = offeredSql(successfulRun());
    expect(sql).toMatch(/FROM pg_tables\s+WHERE schemaname = 'public'\s+AND tablename NOT IN \('__prism_migrations'\)/);
    expect(sql.match(/tablename NOT IN/g)).toHaveLength(1);
  });

  test('quotes schema and table identifiers before aggregating them into dynamic SQL', () => {
    expect(offeredSql(successfulRun())).toContain("string_agg(format('%I.%I', schemaname, tablename), ', ')");
  });

  test('guards empty table lists before truncating and resetting dependent identities', () => {
    expect(offeredSql(successfulRun())).toMatch(
      /IF truncate_list IS NOT NULL THEN\s+EXECUTE format\('TRUNCATE TABLE %s RESTART IDENTITY CASCADE', truncate_list\);\s+END IF;/,
    );
  });

  test('keeps the anonymous SQL body literal instead of expanding shell dollar markers', () => {
    const sql = offeredSql(successfulRun());
    expect(sql.startsWith('DO $$\nDECLARE\n')).toBe(true);
    expect(sql.endsWith('END $$;\n')).toBe(true);
  });

  test.failing('KNOWN GAP: docker exec omits -i so truncate SQL never reaches psql', () => {
    const result = fixture().run();
    const truncate = dockerCalls(result).find((entry) => entry.phase === 'truncate');
    const sql = offeredSql(result);
    expect(truncate?.deliveredStdin).toBe(sql);
  });

  test.failing('KNOWN GAP: psql invocations omit ON_ERROR_STOP so SQL errors need not stop the reset', () => {
    const calls = dockerCalls(fixture().run()).filter((entry) => entry.phase !== 'cache');
    const failFast = calls.map(({ args }) => args.some((argument, index) => (
      (argument === '-v' || argument === '--set') && args[index + 1] === 'ON_ERROR_STOP=1'
    ) || argument === '--set=ON_ERROR_STOP=1' || argument === '-vON_ERROR_STOP=1'));
    expect(failFast).toEqual([true, true]);
  });
});

describe('demo-reset halt-on-failure boundaries', () => {
  const cases: { phase: Phase; status: number; phases: Phase[]; progress: string[] }[] = [
    { phase: 'truncate', status: 41, phases: ['truncate'], progress: [] },
    { phase: 'seed', status: 42, phases: ['truncate', 'seed'], progress: ['  - tables truncated'] },
    {
      phase: 'cache', status: 43, phases: ['truncate', 'seed', 'cache'],
      progress: ['  - tables truncated', '  - seed reapplied'],
    },
  ];

  test.each(cases)('a $phase failure preserves status $status and stops subsequent commands', ({ phase, status, phases, progress }) => {
    const result = fixture({ failAt: phase, failStatus: status }).run();
    expect(result.status).toBe(status);
    expect(result.signal).toBeNull();
    expect(dockerCalls(result).map((entry) => entry.phase)).toEqual(phases);
    expect(result.trace.filter((entry) => entry.command === 'date')).toHaveLength(1);
    expect(result.stderr).toBe(`fixture ${phase} failure\n`);
    expect(result.stdout).toBe([
      '[2026-10-21T00:00:00Z] Demo reset starting', ...progress, '',
    ].join('\n'));
  });
});
