import { deferred, fixtureParent, flush, loadSpec } from './burn4-harness';

const widgets = 'dashboard renders widgets after login';
const sidebar = 'sidebar nav links navigate to correct pages';
const direct = 'direct URL routing works for feature pages';
const home = 'dashboard home link returns to dashboard';

describe('dashboard callback resources and meaningful UI oracles', () => {
  test('setup resets fixtures, awaits parent lookup and closes its owned page before login', async () => {
    const wait = deferred();
    const spec = loadSpec('dashboard', { holdAt: 'parent-lookup', hold: wait.promise });
    let complete = false;
    const setup = spec.hook('beforeAll').then(() => { complete = true; });
    await flush();
    expect(complete).toBe(false);
    expect(spec.events.map((event) => event.kind)).toEqual(['reset', 'new-page', 'parent-lookup']);
    expect(spec.closed).toBe(false);
    wait.resolve();
    await setup;
    expect(spec.closed).toBe(true);
    await spec.hook('beforeEach');
    expect(spec.events.at(-1)).toEqual({ kind: 'login', detail: fixtureParent.name });
    expect(spec.sessionRole).toBe('parent');
    await spec.hook('afterEach');
    expect(spec.sessionRole).toBeUndefined();
  });

  test.each(['reset', 'new-page', 'parent-lookup', 'close'])('setup propagates %s failure without running later setup actions', async (failAt) => {
    const spec = loadSpec('dashboard', { failAt });
    await expect(spec.hook('beforeAll')).rejects.toBe(spec.failure);
    const order = ['reset', 'new-page', 'parent-lookup', 'close'];
    expect(spec.events.map((event) => event.kind)).toEqual(order.slice(0, order.indexOf(failAt) + 1));
  });

  test.each(['login', 'logout'])('the %s hook awaits and propagates dependency failure', async (failAt) => {
    const wait = deferred();
    const spec = loadSpec('dashboard', { holdAt: failAt, hold: wait.promise });
    await spec.hook('beforeAll');
    if (failAt === 'logout') await spec.hook('beforeEach');
    let complete = false;
    const pending = spec.hook(failAt === 'login' ? 'beforeEach' : 'afterEach').then(() => { complete = true; });
    await flush();
    expect(complete).toBe(false);
    wait.resolve();
    await pending;
    const rejected = loadSpec('dashboard', { failAt });
    await rejected.hook('beforeAll');
    await expect(rejected.hook(failAt === 'login' ? 'beforeEach' : 'afterEach')).rejects.toBe(rejected.failure);
  });

  test('widget callback accepts a populated dashboard after navigation settles', async () => {
    const spec = loadSpec('dashboard');
    await spec.run(widgets);
    expect(spec.currentPath).toBe('/');
    expect(spec.events.map((event) => event.kind)).toEqual(['goto', 'load-state', 'visible:main', 'visible:[data-widget]', 'count:[data-widget]']);
  });

  test.each(['main', '[data-widget]'])('widget callback rejects an invisible %s instead of passing a shell', async (selector) => {
    const spec = loadSpec('dashboard', { visible: { [selector]: false } });
    await expect(spec.run(widgets)).rejects.toThrow('Expected visible locator');
    expect(spec.events.some((event) => event.kind === 'count:[data-widget]')).toBe(false);
  });

  test('widget callback rejects an empty widget collection', async () => {
    const spec = loadSpec('dashboard', { counts: { '[data-widget]': 0 } });
    await expect(spec.run(widgets)).rejects.toThrow('Expected greater value');
  });

  test('all route callbacks reach their intended destination on successful navigation', async () => {
    const spec = loadSpec('dashboard');
    await spec.run(sidebar);
    expect(spec.events.filter((event) => event.kind.startsWith('click:')).map((event) => event.kind)).toEqual(['click:/calendar', 'click:/tasks', 'click:/shopping']);
    expect(spec.currentPath).toBe('/shopping');
    await spec.run(direct);
    expect(spec.currentPath).toBe('/chores');
    await spec.run(home);
    expect(spec.currentPath).toBe('/');
  });

  test.each([['/calendar', 'click:/tasks'], ['/tasks', 'click:/shopping']] as const)('an unrelated %s destination stops later sidebar interactions', async (destination, forbiddenNext) => {
    const spec = loadSpec('dashboard', { destinations: { [destination]: '/unrelated' } });
    await expect(spec.run(sidebar)).rejects.toThrow('Destination did not match');
    expect(spec.events.some((event) => event.kind === forbiddenNext)).toBe(false);
  });

  test.each(['goto', 'load-state', 'click:/calendar', 'click:/tasks', 'click:/shopping'])('sidebar propagates %s failure and does no later work', async (failAt) => {
    const spec = loadSpec('dashboard', { failAt });
    await expect(spec.run(sidebar)).rejects.toBe(spec.failure);
    expect(spec.events.at(-1)?.kind).toBe(failAt);
  });

  test('direct routing rejects wrong route and missing main separately', async () => {
    const wrong = loadSpec('dashboard', { destinations: { '/chores': '/unrelated' } });
    await expect(wrong.run(direct)).rejects.toThrow('Destination did not match');
    expect(wrong.events.some((event) => event.kind === 'visible:main')).toBe(false);
    const invisible = loadSpec('dashboard', { visible: { main: false } });
    await expect(invisible.run(direct)).rejects.toThrow('Expected visible locator');
  });

  test('home link callback rejects a destination without a trailing root marker', async () => {
    const spec = loadSpec('dashboard', { destinations: { '/': '/unrelated' } });
    await expect(spec.run(home)).rejects.toThrow('Destination did not match');
  });
});
