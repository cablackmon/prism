import { replies, runStep, type Reply } from './burn4-workflow-harness';

describe('fresh-install health polling from unchanged workflow shell', () => {
  test.each([1, 2, 30])('stops on successful health probe %i', attempt => {
    const result = runStep('install', 'Wait for services', {
      curl: [...replies(attempt - 1, { code: 22 }), { stdout: '{"status":"ok"}' }],
      sleep: [{ args: ['10'] }, ...replies(attempt - 1, { args: ['2'] })],
    });
    expect(result.status).toBe(0);
    expect(result.calls.filter(call => call.command === 'curl')).toHaveLength(attempt);
    expect(result.calls.filter(call => call.command === 'sleep').map(call => call.args)).toEqual([
      ['10'], ...Array.from({ length: attempt - 1 }, () => ['2']),
    ]);
    expect(result.stdout).toContain('Health check passed!');
    expect(result.stdout).not.toContain(`Attempt ${attempt}/30`);
    expect(result.calls.filter(call => call.command === 'curl').every(call => JSON.stringify(call.args) === JSON.stringify(['-sf', 'http://localhost:3000/api/health']))).toBe(true);
  });

  test('distinguishes connection failure from HTTP failure and retries both', () => {
    const result = runStep('install', 'Wait for services', {
      curl: [{ code: 7 }, { code: 22 }, {}], sleep: [{}, {}, {}],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Attempt 1/30');
    expect(result.stdout).toContain('Attempt 2/30');
    expect(result.stdout).not.toContain('Attempt 3/30');
  });

  test('propagates failure of the initial sleep without probing', () => {
    const result = runStep('install', 'Wait for services', { sleep: [{ code: 51 }] });
    expect(result.status).toBe(51);
    expect(result.calls).toEqual([{ command: 'sleep', args: ['10'] }]);
  });

  test('propagates failure of a retry sleep without more health probes', () => {
    const result = runStep('install', 'Wait for services', {
      curl: [{ code: 7 }], sleep: [{}, { code: 52 }],
    });
    expect(result.status).toBe(52);
    expect(result.calls.filter(call => call.command === 'curl')).toHaveLength(1);
  });
});

describe('screenshot readiness slice from unchanged workflow shell', () => {
  test.each([1, 2, 80])('accepts readiness at attempt %i after confirming health', attempt => {
    const result = runStep('screenshots', 'Boot app and capture screenshots', {
      curl: [...replies(attempt - 1, { code: 7 }), {}, {}],
      sleep: replies(attempt - 1, { args: ['3'] }),
    });
    expect(result.status).toBe(0);
    expect(result.calls.filter(call => call.command === 'curl')).toHaveLength(attempt + 1);
    expect(result.calls.filter(call => call.command === 'sleep')).toHaveLength(attempt - 1);
    expect(result.calls.filter(call => call.command === 'tail')).toHaveLength(0);
    expect(result.stdout).toContain('App is up.');
  });

  test('fails after eighty unsuccessful attempts plus the final confirmation', () => {
    const result = runStep('screenshots', 'Boot app and capture screenshots', {
      curl: replies(81, { code: 7 }), sleep: replies(80, { args: ['3'] }),
      tail: [{ args: ['-60', '/tmp/dev.log'], stdout: 'Synthetic startup error\n' }],
    });
    expect(result.status).toBe(1);
    expect(result.calls.filter(call => call.command === 'curl')).toHaveLength(81);
    expect(result.calls.filter(call => call.command === 'sleep')).toHaveLength(80);
    expect(result.stdout).toContain('App failed to start.');
    expect(result.stdout).toContain('Synthetic startup error');
    expect(result.stdout).not.toContain('App is up.');
  });

  test('accepts success on the final confirmation after all loop probes fail', () => {
    const result = runStep('screenshots', 'Boot app and capture screenshots', {
      curl: [...replies(80, { code: 22 }), {}], sleep: replies(80, {}),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('App is up.');
    expect(result.stdout).not.toContain('App failed to start.');
  });

  test('rejects failed final confirmation after initial readiness', () => {
    const result = runStep('screenshots', 'Boot app and capture screenshots', {
      curl: [{}, { code: 22 }], tail: [{ stdout: 'Synthetic restart\n' }],
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('App is up.');
    expect(result.stdout).toContain('Synthetic restart');
    expect(result.calls.map(call => call.command)).toEqual(['curl', 'curl', 'tail']);
  });

  test('propagates sleep failure while waiting', () => {
    const result = runStep('screenshots', 'Boot app and capture screenshots', {
      curl: [{ code: 7 }], sleep: [{ code: 53 }],
    });
    expect(result.status).toBe(53);
    expect(result.calls.map(call => call.command)).toEqual(['curl', 'sleep']);
  });

  test('propagates log-tail failure after readiness exhaustion', () => {
    const result = runStep('screenshots', 'Boot app and capture screenshots', {
      curl: replies(81, { code: 7 }), sleep: replies(80, {}), tail: [{ code: 54 }],
    });
    expect(result.status).toBe(54);
    expect(result.calls.at(-1)?.command).toBe('tail');
  });

  test.each([7, 22])('suppresses curl output for status %i', code => {
    const reply: Reply = { code, stdout: 'Synthetic body', stderr: 'Synthetic connection error' };
    const result = runStep('screenshots', 'Boot app and capture screenshots', {
      curl: [reply, {}, {}], sleep: [{}],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('Synthetic body');
    expect(result.stderr).toBe('');
  });
});
