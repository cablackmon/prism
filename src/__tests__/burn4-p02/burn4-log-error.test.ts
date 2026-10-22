import { logger } from './burn4-log-error-fixture';

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

  test('omits the prefix for absent or empty request IDs', () => {
    const f = logger('production');
    f.log('Synthetic context', new Error('First synthetic failure'));
    f.log('Synthetic context', new Error('Second synthetic failure'), '');
    expect(f.errorLog.mock.calls).toEqual([
      ['Synthetic context', 'First synthetic failure'],
      ['Synthetic context', 'Second synthetic failure'],
    ]);
  });

  test('production converts strings, scalars and ordinary records into log strings', () => {
    const f = logger('production');
    const values = ['Synthetic string failure', undefined, null, 42, false, { reason: 'Synthetic failure' }];
    values.forEach((value) => f.log('Synthetic context', value));
    expect(f.errorLog.mock.calls).toEqual([
      ['Synthetic context', 'Synthetic string failure'],
      ['Synthetic context', 'undefined'],
      ['Synthetic context', 'null'],
      ['Synthetic context', '42'],
      ['Synthetic context', 'false'],
      ['Synthetic context', '[object Object]'],
    ]);
  });

  test('preserves the Error object for development diagnostics', () => {
    const f = logger('development');
    const error = new Error('Synthetic failure');
    f.log('Synthetic context', error, 'synthetic-request-42');
    expect(f.errorLog).toHaveBeenCalledWith('[synthetic-request-42] Synthetic context', error);
    expect(f.errorLog.mock.calls[0]?.[1]).toBe(error);
  });

  test('supports missing runtime mode using only synthetic settings', () => {
    const f = logger();
    const error = new Error('Synthetic failure');
    f.log('Synthetic context', error);
    expect(f.errorLog).toHaveBeenCalledWith('Synthetic context', error);
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

  test.failing('KNOWN GAP: production logger throws for non-Error objects without a primitive conversion', () => {
    const f = logger('production');
    const diagnostics: unknown = Object.assign(Object.create(null), { reason: 'Synthetic failure' });
    expect(() => f.log('Synthetic context', diagnostics)).not.toThrow();
    expect(f.errorLog).toHaveBeenCalledTimes(1);
  });
});
