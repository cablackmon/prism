import { cleanup, fixture, invocation, operations } from './burn4-fixture';

afterEach(cleanup);

describe('Alexa failure boundaries with inert commands', () => {
  test.each([null, ''])('rejects absent or empty synthetic hostname %j before writing staging', hostname => {
    const project = fixture();
    const result = project.run({ hostname });
    expect(result.status).toBe(1);
    expect(result.trace?.error).toContain('ALEXA_PRISM_HOSTNAME is not set');
    expect(operations(result)).toEqual([]);
    expect(project.exists('alexa/.deploy')).toBe(false);
  });

  test('direct source invocation returns a failing CLI status for missing hostname', () => {
    const project = fixture();
    const result = project.run({ hostname: null, nativeStatus: 0 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ALEXA_PRISM_HOSTNAME');
    expect(project.exists('native-args.txt')).toBe(false);
    expect(project.exists('alexa/.deploy')).toBe(false);
  });

  test.each(['missing', 'directory'])('does not invoke ask for a %s manifest', kind => {
    const project = fixture();
    project.remove('alexa/skill.json');
    if (kind === 'directory') project.write('alexa/skill.json/nested.txt', 'not a manifest');
    const result = project.run();
    expect(result.status).toBe(1);
    expect(result.trace?.error).toBeTruthy();
    expect(invocation(result)).toBeUndefined();
    expect(operations(result)).not.toContain('copy');
    expect(result.trace?.after).toBe(project.caller);
  });

  test.each(['alexa/.deploy', 'alexa/.deploy/skill.json'])('does not invoke ask when output path %s has the wrong kind', name => {
    const project = fixture();
    if (name.endsWith('skill.json')) project.write(name + '/child.txt', 'fixture');
    else project.write(name, 'not a directory');
    const result = project.run();
    expect(result.status).toBe(1);
    expect(result.trace?.error).toBeTruthy();
    expect(invocation(result)).toBeUndefined();
    expect(result.trace?.after).toBe(project.caller);
  });

  test('aborts before ask when the interaction model source is missing', () => {
    const project = fixture();
    project.remove('alexa/interactionModels');
    const result = project.run();
    expect(result.status).toBe(1);
    expect(operations(result).at(-1)).toBe('copy');
    expect(invocation(result)).toBeUndefined();
  });

  test.each(['mkdir', 'read', 'write', 'remove', 'copy', 'push'])('stops at injected %s failure instead of invoking ask', fault => {
    const project = fixture();
    if (fault === 'remove') project.write('alexa/.deploy/interactionModels/old.json', 'old');
    const result = project.run({ fault });
    expect(result.status).toBe(1);
    expect(result.trace?.error).toBe(`Injected fixture failure: ${fault}`);
    expect(operations(result).at(-1)).toBe(fault);
    expect(invocation(result)).toBeUndefined();
    expect(result.trace?.after).toBe(project.caller);
  });

  test('restores the caller location when the ask fake throws', () => {
    const project = fixture();
    const result = project.run({ ask: 'throw' });
    expect(result.status).toBe(1);
    expect(result.trace?.error).toBe('Injected ask failure');
    expect(invocation(result)?.path).toBe(project.path('alexa/.deploy'));
    expect(operations(result).slice(-3)).toEqual(['push', 'ask', 'pop']);
    expect(result.trace?.after).toBe(project.caller);
  });

  test('restores location after a missing ask command fails resolution', () => {
    const project = fixture();
    const result = project.run({ ask: 'missing' });
    expect(result.status).toBe(1);
    expect(result.trace?.error).toContain('ask');
    expect(invocation(result)).toBeUndefined();
    expect(operations(result).slice(-2)).toEqual(['push', 'pop']);
    expect(result.trace?.after).toBe(project.caller);
  });

  test('surfaces a location restoration failure after ask succeeds', () => {
    const project = fixture();
    const result = project.run({ fault: 'pop' });
    expect(result.status).toBe(1);
    expect(result.trace?.error).toBe('Injected fixture failure: pop');
    expect(operations(result).slice(-2)).toEqual(['ask', 'pop']);
    expect(result.trace?.after).toBe(project.path('alexa/.deploy'));
  });
});
