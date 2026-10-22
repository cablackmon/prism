import { CHILD_COMPLETE, FixtureSkip, load, PARENT, Source, TITLE } from './burn4-harness';

const sources: Source[] = ['chore-crud', 'chores', 'tasks'];

describe('Offline source registration and lifecycle', () => {
  test.each(sources)('%s registers callbacks without running real dependencies', source => {
    const run = load(source);
    expect(run.events).toEqual([]);
    expect(run.callbacks.size).toBe(5);
    expect(Object.values(run.hooks).map(hooks => hooks.length)).toEqual([1, 1, 1]);
  });

  test.each(sources)('%s setup, login and teardown own their resources', async source => {
    const run = load(source);
    await run.hook('beforeAll');
    await run.hook('beforeEach');
    expect(run.roles.get('test')).toBe('parent');
    await run.hook('afterEach');
    const prefix = source === 'chore-crud' ? [] : [source === 'tasks' ? 'reset-tasks' : 'reset-chores'];
    expect(run.events.map(event => event.kind)).toEqual([
      ...prefix, 'new-page', 'parent-lookup', ...(source === 'chore-crud' ? ['child-lookup'] : []),
      'close', 'login', ...(source === 'chore-crud' ? ['cleanup'] : []), 'logout',
    ]);
    expect(run.events.find(event => event.kind === 'login')).toEqual({ kind: 'login', page: 'test', target: PARENT.name });
    expect(run.events.find(event => event.kind === 'close')).toEqual({ kind: 'close', page: 'setup' });
    expect(run.roles.has('test')).toBe(false);
    if (source === 'chore-crud') expect(run.events.find(event => event.kind === 'cleanup')?.target).toBe(TITLE);
  });

  test.each(sources)('%s propagates browser allocation failure before discovery', async source => {
    const error = new Error('synthetic allocation failure');
    const run = load(source, { newPageError: error });
    await expect(run.hook('beforeAll')).rejects.toBe(error);
    expect(run.events.some(event => event.kind.includes('lookup'))).toBe(false);
    expect(run.events.some(event => event.kind === 'close')).toBe(false);
  });

  test.each<Source>(['chores', 'tasks'])('%s stops before allocation when reset fails', async source => {
    const error = new Error('synthetic reset failure');
    const run = load(source, { resetError: error });
    await expect(run.hook('beforeAll')).rejects.toBe(error);
    expect(run.events).toEqual([{ kind: source === 'tasks' ? 'reset-tasks' : 'reset-chores' }]);
  });

  test.each(sources)('%s propagates close errors before login', async source => {
    const error = new Error('synthetic page close failure');
    const run = load(source, { closeError: error });
    await expect(run.hook('beforeAll')).rejects.toBe(error);
    expect(run.events.filter(event => event.kind === 'close')).toHaveLength(1);
    expect(run.events.some(event => event.kind === 'login')).toBe(false);
  });

  test.each(sources)('%s failed login never installs a session', async source => {
    const error = new Error('synthetic login failure');
    const run = load(source, { loginError: error });
    await run.hook('beforeAll');
    await expect(run.hook('beforeEach')).rejects.toBe(error);
    expect(run.roles.has('test')).toBe(false);
  });

  test.each(sources)('%s propagates logout failure after any cleanup', async source => {
    const error = new Error('synthetic logout failure');
    const run = load(source, { logoutError: error });
    await run.hook('beforeAll');
    await run.hook('beforeEach');
    await expect(run.hook('afterEach')).rejects.toBe(error);
    expect(run.events.at(-1)?.kind).toBe('logout');
    if (source === 'chore-crud') expect(run.events.at(-2)?.kind).toBe('cleanup');
  });

  test('explicit absent child skips mutation and still allows normal teardown', async () => {
    const run = load('chore-crud', { childError: new Error('No child found') });
    await run.hook('beforeAll');
    await run.hook('beforeEach');
    await expect(run.run(CHILD_COMPLETE)).rejects.toEqual(new FixtureSkip('No child user available'));
    expect(run.events.some(event => event.kind === 'post')).toBe(false);
    await run.hook('afterEach');
    expect(run.events.at(-1)?.kind).toBe('logout');
  });

  test('unknown requests, selectors and unavailable locator actions fail closed', async () => {
    const run = load('tasks');
    await expect(run.page.request.get('/external')).rejects.toThrow('Denied request');
    await expect(run.page.request.get('/api/tasks')).rejects.toThrow('Unexpected fake request');
    expect(() => run.page.locator('script')).toThrow('Denied selector');
    expect(() => run.page.getByRole('link', { name: 'Tasks' })).toThrow('Denied role');
    expect(() => run.page.getByRole('button', { name: 'Unknown' })).toThrow('Denied or ambiguous');
    await expect(run.locator('modal').click()).rejects.toThrow('Hidden click');
    await expect(run.locator('header').fill('x')).rejects.toThrow('Denied fill');
  });
});
