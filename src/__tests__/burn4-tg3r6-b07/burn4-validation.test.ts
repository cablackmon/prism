import { replies, runStep } from './burn4-workflow-harness';

const containers = ['prism-app', 'prism-db', 'prism-redis'];
const running = containers.map((name, index) => `fake${index} image Up 1 second ${name}`).join('\n');

describe('fresh-install container checks', () => {
  test('checks all required containers with native grep', () => {
    const result = runStep('install', 'Verify containers', { docker: replies(4, { stdout: running }) });
    expect(result.status).toBe(0);
    expect(result.calls).toEqual(Array.from({ length: 4 }, () => ({ command: 'docker', args: ['ps'] })));
  });

  test.each(containers)('rejects missing required container %s', missing => {
    const result = runStep('install', 'Verify containers', {
      docker: replies(4, { stdout: containers.filter(name => name !== missing).join('\n') }),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${missing} not running!`);
    expect(result.calls).toHaveLength(containers.indexOf(missing) + 2);
  });

  test('rejects an empty running-container listing', () => {
    const result = runStep('install', 'Verify containers', { docker: replies(2, {}) });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('prism-app not running!');
  });

  test('propagates failure of the display-only docker invocation', () => {
    const result = runStep('install', 'Verify containers', { docker: [{ code: 62, stderr: 'Synthetic daemon unavailable' }] });
    expect(result.status).toBe(62);
    expect(result.calls).toHaveLength(1);
    expect(result.stderr).toContain('Synthetic daemon unavailable');
  });

  test('rejects a daemon failure while checking required containers', () => {
    const result = runStep('install', 'Verify containers', {
      docker: [{ stdout: running }, { code: 63, stderr: 'Synthetic daemon unavailable' }],
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('prism-app not running!');
  });

  test('detects a required container disappearing after the first listing', () => {
    const result = runStep('install', 'Verify containers', {
      docker: [{ stdout: running }, { stdout: running }, { stdout: 'prism-app\nprism-redis' }],
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('prism-db not running!');
  });
});

describe('fresh-install endpoint and page checks', () => {
  test('passes a successful health command and prints confirmation', () => {
    const result = runStep('install', 'Test health endpoint', { curl: [{ args: ['-sf', 'http://localhost:3000/api/health'], stdout: 'ok' }] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Health endpoint OK');
  });

  test.each([7, 22])('fails the health step for curl status %i', code => {
    const result = runStep('install', 'Test health endpoint', { curl: [{ code }] });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('Health endpoint OK');
  });

  test.each(['<title>Prism</title>', '<html>\n<h1>Prism dashboard</h1>\n</html>'])('accepts expected brand in page content %s', stdout => {
    const result = runStep('install', 'Test page loads', { curl: [{ args: ['-sf', 'http://localhost:3000'], stdout }] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Page loads correctly');
  });

  test.each(['', '<h1>Other app</h1>', '<h1>prism</h1>'])('rejects content missing exact brand %s', stdout => {
    const result = runStep('install', 'Test page loads', { curl: [{ stdout }] });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Page doesn't contain expected content");
  });

  test('propagates curl failure even when its partial page contains Prism', () => {
    const result = runStep('install', 'Test page loads', { curl: [{ code: 22, stdout: '<title>Prism</title>' }] });
    expect(result.status).toBe(22);
    expect(result.stdout).not.toContain('Page loads correctly');
  });
});

describe('fresh-install delegated commands remain inert', () => {
  test.each([0, 65])('propagates direct installer status %i', code => {
    const result = runStep('install', 'Run fresh install', { 'install.sh': [{ code, args: [] }] });
    expect(result.status).toBe(code);
    expect(result.calls).toEqual([{ command: 'install.sh', args: [] }]);
  });

  test('selects only fixture shell scripts for chmod', () => {
    const result = runStep('install', 'Make scripts executable', { chmod: [{ args: ['+x', 'scripts/install.sh'] }] });
    expect(result.status).toBe(0);
  });

  test('propagates chmod failure', () => {
    expect(runStep('install', 'Make scripts executable', { chmod: [{ code: 66 }] }).status).toBe(66);
  });

  test.each([0, 67])('propagates database command status %i', code => {
    const result = runStep('install', 'Check database', {
      docker: [{ code, args: ['exec', 'prism-db', 'psql', '-U', 'prism', '-d', 'prism', '-c', 'SELECT COUNT(*) FROM users;'] }],
    });
    expect(result.status).toBe(code);
    expect(result.calls).toHaveLength(1);
  });

  test('requests app, database and redis failure logs in that order', () => {
    const result = runStep('install', 'Show logs on failure', { docker: replies(3, { stdout: 'Synthetic log\n' }) });
    expect(result.status).toBe(0);
    expect(result.calls.map(call => call.args)).toEqual([
      ['logs', 'prism-app', '--tail', '100'], ['logs', 'prism-db', '--tail', '50'], ['logs', 'prism-redis', '--tail', '50'],
    ]);
  });

  test.each([0, 1, 2])('stops failure-log collection at failed command %i', index => {
    const result = runStep('install', 'Show logs on failure', { docker: [...replies(index, {}), { code: 68 }] });
    expect(result.status).toBe(68);
    expect(result.calls).toHaveLength(index + 1);
  });

  test.each([
    ['Install dependencies', ['ci']], ['Type check', ['run', 'type-check']],
    ['Lint', ['run', 'lint']], ['Build', ['run', 'build']],
  ])('runs the exact inert build command for %s', (name, args) => {
    const result = runStep('install', name as string, { npm: [{ args: args as string[] }] });
    expect(result.status).toBe(0);
  });

  test.each(['Install dependencies', 'Type check', 'Lint', 'Build'])('propagates npm failure from %s', name => {
    expect(runStep('install', name, { npm: [{ code: 69 }] }).status).toBe(69);
  });
});
