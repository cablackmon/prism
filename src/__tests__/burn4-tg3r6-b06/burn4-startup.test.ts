import { runSlice, type RuntimeResult } from './burn4-runtime';

function isolated(result: RuntimeResult): void {
  expect(result.stderr).toBe('');
  expect(result.events.some(event => event.startsWith('blocked-'))).toBe(false);
}

describe('HA schema and app startup slices with inert commands', () => {
  test('existing schema skips base apply and migrates before replacing the shell', () => {
    const result = runSlice('schema');
    isolated(result);
    expect(result.status).toBe(0);
    expect(result.events).toEqual([
      'probe', 'log', 'log', 'app-directory', 'migrate',
      'log', 'replace-shell', 'listener-configured', 'server',
    ]);
  });

  test('absent schema is applied once before migrations and the server', () => {
    const result = runSlice('schema', { probe: 'absent' });
    isolated(result);
    expect(result.status).toBe(0);
    expect(result.events).toEqual([
      'probe', 'log', 'apply-schema', 'log', 'app-directory', 'migrate',
      'log', 'replace-shell', 'listener-configured', 'server',
    ]);
  });

  test('schema application failure prevents migrations and server start', () => {
    const result = runSlice('schema', { probe: 'absent', schemaFailure: true });
    isolated(result);
    expect(result.status).toBe(31);
    expect(result.events).toEqual(['probe', 'log', 'apply-schema']);
  });

  test('migration failure after an existing schema prevents server start', () => {
    const result = runSlice('schema', { migrationFailure: true });
    isolated(result);
    expect(result.status).toBe(35);
    expect(result.events).toEqual(['probe', 'log', 'log', 'app-directory', 'migrate']);
  });

  test('migration failure after base apply still prevents server start', () => {
    const result = runSlice('schema', { probe: 'absent', migrationFailure: true });
    isolated(result);
    expect(result.status).toBe(35);
    expect(result.events).toEqual(['probe', 'log', 'apply-schema', 'log', 'app-directory', 'migrate']);
  });

  test('server failure propagates through the inert shell replacement', () => {
    const result = runSlice('schema', { serverFailure: true });
    isolated(result);
    expect(result.status).toBe(37);
    expect(result.events.at(-1)).toBe('server');
    expect(result.events).toContain('listener-configured');
  });

  test('probe failure currently attempts the base schema and starts the server', () => {
    const result = runSlice('schema', { probe: 'error' });
    isolated(result);
    expect(result.status).toBe(0);
    expect(result.events).toContain('apply-schema');
    expect(result.events).toContain('server');
  });

  test.failing('KNOWN GAP: schema probe errors are treated as a fresh database', () => {
    const result = runSlice('schema', { probe: 'error' });
    isolated(result);
    expect(result.events).not.toContain('apply-schema');
    expect(result.status).not.toBe(0);
    expect(result.events).not.toContain('migrate');
    expect(result.events).not.toContain('server');
  });

  test('a failed probe with partial stdout is also treated as a fresh database', () => {
    const result = runSlice('schema', { probe: 'partialError' });
    isolated(result);
    expect(result.status).toBe(0);
    expect(result.events).toContain('apply-schema');
  });

  test('an empty successful probe output currently takes the fresh-schema path', () => {
    const result = runSlice('schema', { probe: 'empty' });
    isolated(result);
    expect(result.status).toBe(0);
    expect(result.events).toContain('apply-schema');
  });

  test('working-directory failure skips migration but currently starts the server', () => {
    const result = runSlice('schema', { cdFailure: true });
    isolated(result);
    expect(result.status).toBe(0);
    expect(result.events).not.toContain('migrate');
    expect(result.events).toContain('server');
  });

  test.failing('KNOWN GAP: failed app-directory change starts the server without migrations', () => {
    const result = runSlice('schema', { cdFailure: true });
    isolated(result);
    expect(result.events).not.toContain('server');
    expect(result.status).not.toBe(0);
  });
});
