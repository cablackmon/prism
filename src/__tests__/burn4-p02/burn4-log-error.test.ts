import { loadUtility } from './burn4-vm-fixture';

type LogErrorModule = typeof import('@/lib/utils/logError');

function logger(mode: string) {
  const harness = loadUtility<LogErrorModule>('logError', { settings: { NODE_ENV: mode } });
  return { ...harness, log: harness.exports.logError };
}

describe('logError with synthetic runtime modes', () => {
  test('production logs only an Error message and never its stack or additional fields', () => {
    const f = logger('production');
    const error = Object.assign(new Error('Synthetic failure'), { query: 'Synthetic internal detail' });
    f.log('Unable to load calendar', error);
    expect(f.errorLog).toHaveBeenCalledWith('Unable to load calendar', 'Synthetic failure');
    expect(f.errorLog.mock.calls[0]).not.toContain(error);
    expect(f.errorLog.mock.calls[0]).not.toContain(error.stack);
  });

  test('production prefixes a supplied request ID for correlation', () => {
    const f = logger('production');
    f.log('Unable to load calendar', new Error('Synthetic failure'), 'synthetic-request-42');
    expect(f.errorLog).toHaveBeenCalledWith('[synthetic-request-42] Unable to load calendar', 'Synthetic failure');
  });

  test.each([undefined, ''])('omits the prefix when the request ID is %s', (requestId) => {
    const f = logger('production');
    f.log('Synthetic context', new Error('Synthetic failure'), requestId);
    expect(f.errorLog).toHaveBeenCalledWith('Synthetic context', 'Synthetic failure');
  });

  test.each([
    ['Synthetic string failure', 'Synthetic string failure'],
    [undefined, 'undefined'],
    [null, 'null'],
    [42, '42'],
    [false, 'false'],
    [{ reason: 'Synthetic failure' }, '[object Object]'],
  ])('production safely converts a non-Error value: %p', (value, expected) => {
    const f = logger('production');
    f.log('Synthetic context', value);
    expect(f.errorLog).toHaveBeenCalledWith('Synthetic context', expected);
  });

  test.each(['development', 'test', ''])('preserves the Error object outside production: %s', (mode) => {
    const f = logger(mode);
    const error = new Error('Synthetic failure');
    f.log('Synthetic context', error, 'synthetic-request-42');
    expect(f.errorLog).toHaveBeenCalledWith('[synthetic-request-42] Synthetic context', error);
    expect(f.errorLog.mock.calls[0]?.[1]).toBe(error);
  });

  test('preserves structured non-Error diagnostics outside production without mutation', () => {
    const f = logger('development');
    const diagnostics = Object.freeze({ reason: 'Synthetic failure', attempts: 2 });
    f.log('Synthetic context', diagnostics);
    expect(f.errorLog).toHaveBeenCalledWith('Synthetic context', diagnostics);
    expect(f.errorLog.mock.calls[0]?.[1]).toBe(diagnostics);
    expect(diagnostics).toEqual({ reason: 'Synthetic failure', attempts: 2 });
  });
});
