import { mkdirSync, readdirSync } from 'node:fs';
import { call, cleanup, fixture, messages, operations, type Stage } from './burn4-fixture';

afterEach(cleanup);

describe('unchanged HTTPS setup orchestration with inert mkcert', () => {
  test('orders lookup, install, directory creation, generation and root discovery', () => {
    const result = fixture().run();
    expect(result.status).toBe(0);
    expect(operations(result)).toEqual(['lookup', 'install', 'mkdir', 'push', 'generate', 'pop', 'caroot', 'join']);
  });

  test('passes generation options and each hostname as separate arguments', () => {
    const result = fixture().run();
    expect(call(result, 'lookup')?.arguments).toEqual(['mkcert']);
    expect(call(result, 'install')?.arguments).toEqual(['-install']);
    expect(call(result, 'generate')?.arguments).toEqual([
      '-cert-file', 'prism.crt', '-key-file', 'prism.key', 'fixture.example.invalid', 'localhost', '127.0.0.1',
    ]);
    expect(call(result, 'caroot')?.arguments).toEqual(['-CAROOT']);
  });

  test.each(['first.example.invalid second.example.invalid', 'localhost'])('preserves source domain splitting for %s', server => {
    const result = fixture().run({ server });
    expect(result.status).toBe(0);
    expect(call(result, 'generate')?.arguments.slice(4)).toEqual([...server.split(' '), 'localhost', '127.0.0.1']);
  });

  test('creates only the fixture directory and generates from that directory', () => {
    const item = fixture();
    const result = item.run();
    expect(call(result, 'mkdir')?.arguments).toEqual([item.certDirectory, 'Directory', 'True']);
    expect(call(result, 'generate')?.cwd).toBe(item.certDirectory);
    expect(readdirSync(item.certDirectory)).toEqual([]);
    expect(result.trace.caller).toBe(item.caller);
    expect(result.trace.after).toBe(item.caller);
    expect(result.trace.stackDepth).toBe(0);
  });

  test('force-creates an already existing fixture directory without material files', () => {
    const item = fixture();
    mkdirSync(item.certDirectory);
    const result = item.run();
    expect(result.status).toBe(0);
    expect(readdirSync(item.certDirectory)).toEqual([]);
  });

  test('builds only a root-certificate pathname and prints the supplied synthetic hostname', () => {
    const item = fixture();
    const result = item.run({ server: 'alternate.example.invalid' });
    expect(call(result, 'join')?.arguments).toEqual([item.caDirectory, 'rootCA.pem']);
    expect(call(result, 'caroot')?.cwd).toBe(item.caller);
    expect(messages(result)).toContain(`CA cert is at: ${item.caDirectory}/rootCA.pem`);
    expect(messages(result)).toContain('https://alternate.example.invalid');
    expect(operations(result)).not.toContain('read');
  });

  test('missing tool exits before installation, directory changes or completion', () => {
    const item = fixture();
    const result = item.run({ missingTool: true });
    expect(result.status).toBe(1);
    expect(operations(result)).toEqual(['lookup']);
    expect(messages(result)).toContain('mkcert not found');
    expect(messages(result)).not.toContain('Done.');
    expect(result.trace.after).toBe(item.caller);
    expect(result.trace.stackDepth).toBe(0);
  });

  test.each([null, ''])('mandatory hostname binding rejects %s before command lookup', server => {
    const result = fixture().run({ server });
    expect(result.status).toBe(1);
    expect(result.trace.error).toMatch(/mandatory|empty|ServerIP/i);
    expect(result.trace.calls).toEqual([]);
  });

  const stages: Stage[] = ['install', 'mkdir', 'push', 'generate', 'pop', 'caroot', 'join'];
  test.each(stages)('a terminating %s failure stops later orchestration and Done output', fault => {
    const item = fixture();
    const result = item.run({ fault });
    const order = ['lookup', ...stages];
    expect(result.trace.error).toBe(`Injected fixture failure: ${fault}`);
    expect(result.status).toBe(1);
    expect(operations(result)).toEqual(order.slice(0, order.indexOf(fault) + 1));
    expect(messages(result)).not.toContain('Done.');
    if (['install', 'mkdir', 'push', 'caroot', 'join'].includes(fault)) {
      expect(result.trace.after).toBe(item.caller);
      expect(result.trace.stackDepth).toBe(0);
    }
    if (['install', 'mkdir', 'push', 'generate', 'pop'].includes(fault)) {
      expect(messages(result)).not.toContain('Certificate written');
    }
  });

  test('separate concurrent invocations isolate hostnames, traces and directory stacks', async () => {
    const first = fixture();
    const second = fixture();
    const [one, two] = await Promise.all([
      first.runAsync({ server: 'first.example.invalid' }),
      second.runAsync({ server: 'second.example.invalid' }),
    ]);
    expect(one.status).toBe(0);
    expect(two.status).toBe(0);
    expect(call(one, 'generate')?.arguments).toContain('first.example.invalid');
    expect(call(two, 'generate')?.arguments).toContain('second.example.invalid');
    expect(messages(one)).not.toContain('second.example.invalid');
    expect(messages(two)).not.toContain('first.example.invalid');
    expect(one.trace.after).toBe(first.caller);
    expect(two.trace.after).toBe(second.caller);
    expect(readdirSync(first.certDirectory)).toEqual([]);
    expect(readdirSync(second.certDirectory)).toEqual([]);
  });
});
