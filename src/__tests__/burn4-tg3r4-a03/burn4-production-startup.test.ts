import { StartupFixture, stages } from './burn4-startup-fixture';

describe('production container entrypoint', () => {
  const fixtures: StartupFixture[] = [];
  function fixture(options: ConstructorParameters<typeof StartupFixture>[0] = {}): StartupFixture {
    const created = new StartupFixture(options);
    fixtures.push(created);
    return created;
  }
  afterEach(() => { for (const created of fixtures.splice(0)) created.dispose(); });

  test('runs migration before the server using the fixed application paths', () => {
    const result = fixture().run('production');
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(stages(result)).toEqual(['migrate', 'server']);
    expect(result.stdout).toBe('[entrypoint] Running database migrations...\n[entrypoint] Starting Prism...\n');
    expect(result.stderr).toBe('');
  });

  test.each([1, 70, 127])('migration failure %i stops before server startup', (status) => {
    const result = fixture({ statuses: { migrate: status }, stderr: { migrate: 'synthetic migration failure' } }).run('production');
    expect(result.status).toBe(status);
    expect(stages(result)).toEqual(['migrate']);
    expect(result.stdout).not.toContain('Starting Prism');
    expect(result.stderr).toBe('synthetic migration failure\n');
  });

  test.each([23, 137])('preserves final server failure status %i', (status) => {
    const result = fixture({ statuses: { server: status }, stderr: { server: 'synthetic server failure' } }).run('production');
    expect(result.status).toBe(status);
    expect(stages(result)).toEqual(['migrate', 'server']);
    expect(result.stderr).toBe('synthetic server failure\n');
  });

  test('missing node stops at migration with command-not-found status', () => {
    const result = fixture({ omit: ['node'] }).run('production');
    expect(result.status).toBe(127);
    expect(stages(result)).toEqual([]);
    expect(result.stdout).not.toContain('Starting Prism');
    expect(result.stderr).toContain('node: not found');
  });

  test('forwards both successful command output streams', () => {
    const result = fixture({ stdout: { migrate: 'synthetic migrated', server: 'synthetic listening' }, stderr: { migrate: 'synthetic warning', server: 'synthetic runtime warning' } }).run('production');
    expect(result.stdout).toBe('[entrypoint] Running database migrations...\nsynthetic migrated\n[entrypoint] Starting Prism...\nsynthetic listening\n');
    expect(result.stderr).toBe('synthetic warning\nsynthetic runtime warning\n');
  });

  test.each([['SIGTERM', 143, 'term'], ['SIGINT', 130, 'int']] as const)('exec preserves PID and delivers %s directly to server', async (signal, status, record) => {
    const created = fixture({ hold: 'server' });
    const running = created.start('production');
    try {
      const event = await running.event('server');
      expect(event.pid).toBe(running.child.pid);
      expect(running.child.kill(signal)).toBe(true);
      const result = await running.completed;
      expect(result.status).toBe(status);
      expect(result.signal).toBeNull();
      expect(created.signals()).toEqual([`${record}:${event.pid}`]);
      expect(stages(result)).toEqual(['migrate', 'server']);
    } finally {
      await running.stop();
    }
  });
});
