import { call, cleanup, fixture, messages, operations } from './burn4-fixture';

afterEach(cleanup);

describe('confirmed HTTPS setup defects', () => {
  test.failing('KNOWN GAP: nonzero native CA installation status does not stop generation', () => {
    const result = fixture().run({ nativeFailure: 'install' });
    expect(call(result, 'install')?.arguments).toEqual(['-install']);
    expect(call(result, 'install')?.status).toBe(9);
    expect(operations(result)).not.toContain('generate');
  });

  test.failing('KNOWN GAP: nonzero native generation status still announces a written certificate', () => {
    const result = fixture().run({ nativeFailure: 'generate' });
    expect(call(result, 'generate')?.arguments[0]).toBe('-cert-file');
    expect(call(result, 'generate')?.status).toBe(9);
    expect(messages(result)).not.toContain('Certificate written');
  });

  test.failing('KNOWN GAP: nonzero native CA-root status still announces completion', () => {
    const result = fixture().run({ nativeFailure: 'caroot' });
    expect(call(result, 'caroot')?.arguments).toEqual(['-CAROOT']);
    expect(call(result, 'caroot')?.status).toBe(9);
    expect(messages(result)).not.toContain('Done.');
  });

  test.failing('KNOWN GAP: terminating generation failure leaks the pushed working directory', () => {
    const item = fixture();
    const result = item.run({ fault: 'generate' });
    expect(result.trace.error).toBe('Injected fixture failure: generate');
    expect(result.status).toBe(1);
    expect(messages(result)).not.toContain('Done.');
    expect(result.trace.after).toBe(item.caller);
  });
});
