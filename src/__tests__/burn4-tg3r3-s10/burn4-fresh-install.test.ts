import { cleanFixtures, createFixture } from './burn4-fresh-install-fixture';

afterEach(cleanFixtures);

describe('fresh install confirmation gates', () => {
  test('--yes bypasses the prompt and reaches the successful verifier summary', () => {
    const fixture = createFixture();
    const result = fixture.run();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('This will DELETE');
    expect(result.stdout).toContain('Fresh install test PASSED!');
  });

  test('the exact yes confirmation authorizes cleanup and the fake installer', () => {
    const fixture = createFixture();
    const result = fixture.run([], 'yes\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('This will DELETE');
    expect(fixture.calls().some(call => call.command === 'install.sh')).toBe(true);
  });

  test.each(['no', 'YES'])('confirmation %s aborts before any external command', confirmation => {
    const fixture = createFixture();
    const result = fixture.run([], `${confirmation}\n`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Aborted.');
    expect(fixture.calls()).toEqual([]);
  });

  test('an unknown argument does not bypass the confirmation gate', () => {
    const fixture = createFixture();
    const result = fixture.run(['--unknown'], 'no\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Aborted.');
    expect(fixture.calls()).toEqual([]);
  });

  test('EOF without --yes fails safely before cleanup or installation', () => {
    const fixture = createFixture();
    const result = fixture.run([], '');
    expect(result.status).not.toBe(0);
    expect(fixture.calls()).toEqual([]);
  });
});

describe('fresh install cleanup and installer ordering', () => {
  test('uses modern Compose, cleans up, installs and verifies in order with no env/config files', () => {
    const fixture = createFixture();
    expect(fixture.topLevelFiles()).toEqual(['bin', 'burn4-command.cjs', 'scripts']);
    const result = fixture.run();
    expect(result.status).toBe(0);
    expect(fixture.calls()).toEqual([
      { command: 'docker', args: ['compose', 'version'] },
      { command: 'docker', args: ['compose', 'down', '-v'] },
      { command: 'rm', args: ['-f', '.env'] },
      { command: 'docker', args: ['volume', 'rm', 'prism-postgres-data', 'prism-redis-data', 'prism-photos-cache'] },
      { command: 'install.sh', args: [] },
      { command: 'docker', args: ['ps', '--filter', 'name=prism', '--format', '{{.Names}}'] },
      { command: 'curl', args: ['-sf', 'http://localhost:3000/api/health'] },
      { command: 'docker', args: ['exec', 'prism-db', 'psql', '-U', 'prism', '-d', 'prism', '-t', '-c', 'SELECT COUNT(*) FROM users;'] },
      { command: 'curl', args: ['-sf', 'http://localhost:3000'] },
    ]);
    expect(result.stdout).toContain('Containers: 3 running');
    expect(result.stdout).toContain('Database has 7 user(s)');
    expect(result.stdout).toContain('Database: 7 user(s)');
    expect(fixture.topLevelFiles()).toEqual(['bin', 'burn4-calls.jsonl', 'burn4-command.cjs', 'scripts']);
  });

  test('uses legacy docker-compose when the modern version probe fails', () => {
    const fixture = createFixture({ composeVersionExit: 1 });
    expect(fixture.run().status).toBe(0);
    expect(fixture.calls().slice(0, 2)).toEqual([
      { command: 'docker', args: ['compose', 'version'] },
      { command: 'docker-compose', args: ['down', '-v'] },
    ]);
    expect(fixture.calls().some(call => call.command === 'docker' && call.args[1] === 'down')).toBe(false);
  });

  test.each(['composeDownExit', 'rmExit', 'volumeExit'] as const)(
    'cleanup failure %s is tolerated before installation', key => {
      const fixture = createFixture({ [key]: 13 });
      const result = fixture.run();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Cleanup complete');
      expect(fixture.calls().filter(call => call.command === 'install.sh')).toHaveLength(1);
      expect(result.stdout).toContain('Fresh install test PASSED!');
    },
  );

  test('installer failure stops before container, HTTP and database verification', () => {
    const fixture = createFixture({ installerExit: 17 });
    const result = fixture.run();
    expect(result.status).toBe(17);
    expect(fixture.calls().at(-1)).toEqual({ command: 'install.sh', args: [] });
    expect(result.stdout).not.toContain('Step 3/6');
    expect(result.stdout).not.toContain('Fresh install test PASSED!');
  });
});

describe('fresh install container and health failure boundaries', () => {
  test.each([0, 2])('rejects %i containers before any HTTP or database command', count => {
    const fixture = createFixture({ containersOutput: Array.from({ length: count }, (_, i) => `prism-fixture-${i}\n`).join('') });
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`Expected at least 3 containers, found ${count}`);
    expect(fixture.calls().some(call => call.command === 'curl' || call.args[0] === 'exec')).toBe(false);
  });

  test('accepts more than three containers and includes their count in the summary', () => {
    const fixture = createFixture({ containersOutput: 'prism-web\nprism-db\nprism-redis\nprism-backup\n' });
    const result = fixture.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Containers: 4 running');
  });

  test('a failed container command with no rows is rejected by the count check', () => {
    const fixture = createFixture({ containersOutput: '', containersExit: 19 });
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Expected at least 3 containers, found 0');
    expect(fixture.calls().some(call => call.command === 'curl')).toBe(false);
  });

  test('a failing final container-count filter stops before HTTP verification', () => {
    const fixture = createFixture({ filterFailures: { wc: 16 } });
    const result = fixture.run();
    expect(result.status).toBe(16);
    expect(fixture.calls().some(call => call.command === 'curl')).toBe(false);
    expect(result.stdout).not.toContain('Fresh install test PASSED!');
  });

  test('an empty failed health request stops before the database query and page request', () => {
    const fixture = createFixture({ healthOutput: '', healthExit: 7 });
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Health check failed');
    expect(fixture.calls().at(-1)?.args).toEqual(['-sf', 'http://localhost:3000/api/health']);
    expect(fixture.calls().some(call => call.args[0] === 'exec')).toBe(false);
  });

  test('the literal failed health sentinel is rejected even with a successful curl status', () => {
    const fixture = createFixture({ healthOutput: 'failed', healthExit: 0 });
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Health check failed');
    expect(fixture.calls().some(call => call.args[0] === 'exec')).toBe(false);
  });
});

describe('fresh install database and page behavior', () => {
  test('zero users warns about seeding while allowing page verification and summary', () => {
    const fixture = createFixture({ databaseOutput: ' 0 \n' });
    const result = fixture.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No users found - database may not be seeded');
    expect(result.stdout).toContain('Database: 0 user(s)');
    expect(result.stdout).toContain('Fresh install test PASSED!');
  });

  test('a failing final database filter stops before the page request', () => {
    const fixture = createFixture({ filterFailures: { tr: 23 } });
    const result = fixture.run();
    expect(result.status).toBe(23);
    expect(fixture.calls().some(call => call.command === 'curl'
      && call.args.at(-1) === 'http://localhost:3000')).toBe(false);
    expect(result.stdout).not.toContain('Fresh install test PASSED!');
  });

  test('accepts an html tag without a doctype within the response prefix', () => {
    const fixture = createFixture({ pageOutput: '<html lang="en"><body>fixture page</body></html>' });
    const result = fixture.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Page loads correctly');
  });

  test.each(['', 'unavailable fixture page'])('rejects unexpected page response %j', pageOutput => {
    const fixture = createFixture({ pageOutput });
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Page load failed - unexpected response');
    expect(result.stdout).not.toContain('Fresh install test PASSED!');
  });

  test('rejects a page whose HTML marker is truncated by the 100-byte prefix', () => {
    const fixture = createFixture({ pageOutput: 'x'.repeat(96) + '<html>fixture</html>' });
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Page load failed - unexpected response');
  });

  test('accepts an HTML marker ending exactly at the 100-byte prefix boundary', () => {
    const fixture = createFixture({ pageOutput: 'x'.repeat(95) + '<html>fixture</html>' });
    expect(fixture.run().status).toBe(0);
  });

  test('an empty failed page request is rejected even though head succeeds', () => {
    const fixture = createFixture({ pageOutput: '', pageExit: 7 });
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Page load failed - unexpected response');
    expect(result.stdout).not.toContain('Fresh install test PASSED!');
  });

  test('a failing final page filter propagates its status instead of printing success', () => {
    const fixture = createFixture({ filterFailures: { head: 24 } });
    const result = fixture.run();
    expect(result.status).toBe(24);
    expect(result.stdout).not.toContain('Page loads correctly');
    expect(result.stdout).not.toContain('Fresh install test PASSED!');
  });
});
