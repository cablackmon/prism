import { cleanup, fixture, invocation, operations } from './burn4-fixture';

afterEach(cleanup);

describe('Alexa preparation through real isolated PowerShell', () => {
  test('substitutes every placeholder without changing the synthetic source or adding bytes', () => {
    const project = fixture();
    const original = project.read('alexa/skill.json');
    const result = project.run();
    expect(result.status).toBe(0);
    expect(result.trace?.error).toBeNull();
    expect(project.read('alexa/.deploy/skill.json')).toBe(original.replaceAll('prism.example.com', 'fixture.example.invalid'));
    expect(project.read('alexa/skill.json')).toBe(original);
    expect(result.stderr).toBe('');
  });

  test('preserves a manifest without a trailing newline', () => {
    const project = fixture();
    project.write('alexa/skill.json', '{"endpoint":"prism.example.com"}');
    expect(project.run().status).toBe(0);
    expect(project.read('alexa/.deploy/skill.json')).toBe('{"endpoint":"fixture.example.invalid"}');
  });

  test('preserves UTF-8 content and CRLF in synthetic metadata and models', () => {
    const project = fixture();
    project.write('alexa/skill.json', '{"title":"café 水","host":"prism.example.com"}\r\n');
    project.write('alexa/interactionModels/custom/with spaces.json', '{"value":"café 水"}\r\n');
    expect(project.run().status).toBe(0);
    expect(project.read('alexa/.deploy/skill.json')).toBe('{"title":"café 水","host":"fixture.example.invalid"}\r\n');
    expect(project.read('alexa/.deploy/interactionModels/custom/with spaces.json')).toBe('{"value":"café 水"}\r\n');
  });

  test('leaves a manifest with no matching placeholder unchanged', () => {
    const project = fixture();
    const body = '{"synthetic":true}\n';
    project.write('alexa/skill.json', body);
    expect(project.run().status).toBe(0);
    expect(project.read('alexa/.deploy/skill.json')).toBe(body);
  });

  test('creates the staging directory and invokes only ask with exact targets after copying models', () => {
    const project = fixture();
    const result = project.run();
    expect(result.status).toBe(0);
    expect(operations(result)).toEqual(['exists', 'mkdir', 'read', 'write', 'exists', 'copy', 'push', 'ask', 'pop']);
    expect(invocation(result)).toEqual({ operation: 'ask', path: project.path('alexa/.deploy'), arguments: ['deploy', '--target', 'skill', '--target', 'model'] });
    expect(project.read('alexa/.deploy/interactionModels/custom/en-US.json')).toBe(project.read('alexa/interactionModels/custom/en-US.json'));
    expect(result.trace?.caller).toBe(project.caller);
    expect(result.trace?.after).toBe(project.caller);
    expect(project.exists('caller/.deploy')).toBe(false);
  });

  test('reuses an existing deployment directory while preserving unrelated staged files', () => {
    const project = fixture();
    project.write('alexa/.deploy/keep.txt', 'synthetic keep');
    const result = project.run();
    expect(result.status).toBe(0);
    expect(operations(result)).not.toContain('mkdir');
    expect(project.read('alexa/.deploy/keep.txt')).toBe('synthetic keep');
  });

  test('removes stale nested models and mirrors changed models on a later preparation', () => {
    const project = fixture();
    expect(project.run().status).toBe(0);
    project.write('alexa/.deploy/interactionModels/deep/stale.json', 'stale');
    project.remove('alexa/interactionModels/custom/en-US.json');
    project.write('alexa/interactionModels/new/deep/model.json', '{"revision":2}');
    const result = project.run({ hostname: 'second.example.invalid' });
    expect(result.status).toBe(0);
    expect(operations(result)).toEqual(['exists', 'read', 'write', 'exists', 'remove', 'copy', 'push', 'ask', 'pop']);
    expect(project.exists('alexa/.deploy/interactionModels/deep/stale.json')).toBe(false);
    expect(project.exists('alexa/.deploy/interactionModels/custom/en-US.json')).toBe(false);
    expect(project.read('alexa/.deploy/interactionModels/new/deep/model.json')).toBe('{"revision":2}');
    expect(project.read('alexa/.deploy/skill.json')).toContain('second.example.invalid');
  });

  test('replaces a stale model destination file with the source model directory', () => {
    const project = fixture();
    project.write('alexa/.deploy/interactionModels', 'stale file');
    const result = project.run();
    expect(result.status).toBe(0);
    expect(operations(result)).toContain('remove');
    expect(project.read('alexa/.deploy/interactionModels/custom/en-US.json')).toContain('synthetic model');
  });

  test('copies an empty model directory without inventing model files', () => {
    const project = fixture();
    project.remove('alexa/interactionModels/custom/en-US.json');
    const result = project.run();
    expect(result.status).toBe(0);
    expect(project.exists('alexa/.deploy/interactionModels/custom')).toBe(true);
    expect(project.exists('alexa/.deploy/interactionModels/custom/en-US.json')).toBe(false);
  });

  test('isolates simultaneous preparation and native command traces in separate fixtures', async () => {
    const first = fixture();
    const second = fixture();
    const results = await Promise.all([first.runAsync({ hostname: 'one.example.invalid', nativeStatus: 0 }), second.runAsync({ hostname: 'two.example.invalid', nativeStatus: 0 })]);
    expect(results.map(result => result.status)).toEqual([0, 0]);
    expect(first.read('alexa/.deploy/skill.json')).toContain('one.example.invalid');
    expect(second.read('alexa/.deploy/skill.json')).toContain('two.example.invalid');
    expect(first.read('native-cwd.txt').trim()).toBe(first.path('alexa/.deploy'));
    expect(second.read('native-cwd.txt').trim()).toBe(second.path('alexa/.deploy'));
  });

  test('runs the native zero-status fake with exact arguments and the staged working directory', () => {
    const project = fixture();
    const result = project.run({ nativeStatus: 0 });
    expect(result.status).toBe(0);
    expect(result.trace).toBeNull();
    expect(project.read('native-args.txt').trim().split('\n')).toEqual(['deploy', '--target', 'skill', '--target', 'model']);
    expect(project.read('native-cwd.txt').trim()).toBe(project.path('alexa/.deploy'));
  });
});
