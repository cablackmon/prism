import { StartupFixture, stages } from './burn4-startup-fixture';

describe('screenshot container entrypoint', () => {
  const fixtures: StartupFixture[] = [];
  function fixture(options: ConstructorParameters<typeof StartupFixture>[0] = {}): StartupFixture {
    const created = new StartupFixture(options);
    fixtures.push(created);
    return created;
  }
  afterEach(() => { for (const created of fixtures.splice(0)) created.dispose(); });

  test('waits for readiness, migrates, clears, seeds and then starts dev mode', () => {
    const result = fixture().run('screenshots');
    expect(result.status).toBe(0);
    expect(stages(result)).toEqual(['ready', 'migrate', 'clear', 'seed', 'dev']);
    expect(result.stdout).toBe('[screenshots] Waiting for database...\n[screenshots] Running migrations...\n[screenshots] Clearing demo data...\n[screenshots] Seeding demo data...\n[screenshots] Starting Prism (dev mode)...\n');
    expect(result.stderr).toBe('');
  });

  test('retries each failed probe after one sleep and advances only after a success', () => {
    const result = fixture({ readiness: [1, 2, 0] }).run('screenshots');
    expect(result.status).toBe(0);
    expect(stages(result)).toEqual(['ready', 'sleep', 'ready', 'sleep', 'ready', 'migrate', 'clear', 'seed', 'dev']);
  });

  test('keeps readiness diagnostics off stderr on failures and success', () => {
    const result = fixture({ readiness: [1, 0], stderr: { ready: 'synthetic unavailable' }, stdout: { ready: 'synthetic probe output' } }).run('screenshots');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.match(/synthetic probe output/g)).toHaveLength(2);
    expect(result.stdout).not.toContain('synthetic unavailable');
  });

  test('a failed retry delay stops without another probe or any destructive phase', () => {
    const result = fixture({ readiness: [1, 0], statuses: { sleep: 37 }, stderr: { sleep: 'synthetic delay failure' } }).run('screenshots');
    expect(result.status).toBe(37);
    expect(stages(result)).toEqual(['ready', 'sleep']);
    expect(result.stdout).toBe('[screenshots] Waiting for database...\n');
    expect(result.stderr).toBe('synthetic delay failure\n');
  });

  test.each([
    { failed: 'migrate', status: 41, events: ['ready', 'migrate'], absent: 'Clearing demo data' },
    { failed: 'clear', status: 42, events: ['ready', 'migrate', 'clear'], absent: 'Seeding demo data' },
    { failed: 'seed', status: 43, events: ['ready', 'migrate', 'clear', 'seed'], absent: 'Starting Prism' },
    { failed: 'dev', status: 44, events: ['ready', 'migrate', 'clear', 'seed', 'dev'], absent: null },
  ] as const)('$failed failure stops with its status and visible diagnostics', ({ failed, status, events, absent }) => {
    const result = fixture({ statuses: { [failed]: status }, stderr: { [failed]: 'synthetic mandatory phase failure' } }).run('screenshots');
    expect(result.status).toBe(status);
    expect(stages(result)).toEqual(events);
    expect(result.stderr).toBe('synthetic mandatory phase failure\n');
    if (absent) expect(result.stdout).not.toContain(absent);
  });

  test.each([
    { omitted: 'npx', readiness: [0], events: ['ready', 'migrate'], absent: 'Seeding demo data' },
    { omitted: 'npm', readiness: [0], events: ['ready', 'migrate', 'clear', 'seed'], absent: null },
    { omitted: 'sleep', readiness: [1, 0], events: ['ready'], absent: 'Running migrations' },
  ] as const)('missing $omitted stops at its first required invocation', ({ omitted, readiness, events, absent }) => {
    const result = fixture({ omit: [omitted], readiness: [...readiness] }).run('screenshots');
    expect(result.status).toBe(127);
    expect(stages(result)).toEqual(events);
    expect(result.stderr).toContain(`${omitted}: not found`);
    if (absent) expect(result.stdout).not.toContain(absent);
  });

  test('keeps mandatory phase output in sequence after readiness succeeds', () => {
    const result = fixture({ stdout: { migrate: 'synthetic migrated', clear: 'synthetic cleared', seed: 'synthetic seeded', dev: 'synthetic dev ready' } }).run('screenshots');
    expect(result.status).toBe(0);
    expect(result.stdout.split('\n').filter((line) => line.startsWith('synthetic'))).toEqual(['synthetic migrated', 'synthetic cleared', 'synthetic seeded', 'synthetic dev ready']);
  });

  test.each([['SIGTERM', 143, 'term'], ['SIGINT', 130, 'int']] as const)('exec preserves PID and delivers %s directly to dev command', async (signal, status, record) => {
    const created = fixture({ hold: 'dev' });
    const running = created.start('screenshots');
    try {
      const event = await running.event('dev');
      expect(event.pid).toBe(running.child.pid);
      expect(running.child.kill(signal)).toBe(true);
      const result = await running.completed;
      expect(result.status).toBe(status);
      expect(result.signal).toBeNull();
      expect(created.signals()).toEqual([`${record}:${event.pid}`]);
      expect(stages(result)).toEqual(['ready', 'migrate', 'clear', 'seed', 'dev']);
    } finally {
      await running.stop();
    }
  });

  test('concurrent boots keep retries, failure status and command traces independent', async () => {
    const healthy = fixture({ readiness: [1, 2, 0], hold: 'dev' });
    const failing = fixture({ readiness: [1, 0], statuses: { clear: 53 } });
    const production = fixture({ hold: 'server' });
    const healthyRun = healthy.start('screenshots');
    const failingRun = failing.start('screenshots');
    const productionRun = production.start('production');
    try {
      await Promise.all([healthyRun.event('dev'), productionRun.event('server')]);
      const failedResult = await failingRun.completed;
      expect(failedResult.status).toBe(53);
      expect(stages(failedResult)).toEqual(['ready', 'sleep', 'ready', 'migrate', 'clear']);
      expect(healthy.events().map((event) => event.stage)).toEqual(['ready', 'sleep', 'ready', 'sleep', 'ready', 'migrate', 'clear', 'seed', 'dev']);
      expect(production.events().map((event) => event.stage)).toEqual(['migrate', 'server']);
      const allPids = [...healthy.events(), ...failing.events(), ...production.events()].map((event) => event.pid);
      expect(new Set(allPids).size).toBe(allPids.length);
    } finally {
      await Promise.all([healthyRun.stop(), failingRun.stop(), productionRun.stop()]);
    }
  });
});
