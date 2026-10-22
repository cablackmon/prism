import { Harness } from './burn4-harness';

const scenarios = [
  'shopping page loads with header',
  'shopping items display in categories or columns',
  'checking an item updates progress',
  'shopping mode can be entered and exited',
  'progress bar reflects checked items',
  'add list button is visible',
];

describe('Shopping original scenario behavior', () => {
  test.each(scenarios)('%s uses authenticated isolated fixtures', async (name) => {
    const h = new Harness('shopping');
    await h.hook('beforeAll');
    expect(h.pages[1]?.closed).toBe(true);
    await h.run(name);
    expect(h.events).toContain('goto:/shopping');
    expect(h.events).toContain('login:adult-a');
    expect(h.events).toContain('logout:adult-a');
    expect(h.page.actor).toBe('');
    expect(h.calls).toEqual([]);
    if (name === scenarios[2]) {
      expect(h.events).toContain('click:items');
      expect(h.items.get('baseline-item')?.checked).toBe(false);
      expect(h.events.filter((event) => event === 'reset:items')).toHaveLength(2);
    }
    if (name === scenarios[3]) {
      expect(h.events.filter((event) => event.startsWith('click:'))).toEqual(['click:entry', 'click:exit']);
      expect(h.page.mode).toBe(false);
    }
  });

  test('setup resets shopping state before roster discovery', async () => {
    const h = new Harness('shopping');
    const item = h.items.get('baseline-item');
    if (!item) throw new Error('Synthetic fixture absent');
    item.checked = true;
    await h.hook('beforeAll');
    expect(h.items.get('baseline-item')?.checked).toBe(false);
    expect(h.events.indexOf('reset:items')).toBeLessThan(h.events.indexOf('roster:parent'));
  });

  test('header mismatch is detected', async () => {
    const h = new Harness('shopping', { header: 'Unexpected route' });
    await h.ready();
    await expect(h.invoke(scenarios[0]!)).rejects.toMatchObject({ matcherResult: expect.any(Object) });
  });

  test('column layout works without category columns', async () => {
    const h = new Harness('shopping', { categories: 0, columns: 2 });
    await h.ready();
    await expect(h.invoke(scenarios[1]!)).resolves.toBeUndefined();
  });

  test('empty layout is detected', async () => {
    const h = new Harness('shopping', { categories: 0, columns: 0 });
    await h.ready();
    await expect(h.invoke(scenarios[1]!)).rejects.toMatchObject({ matcherResult: expect.any(Object) });
  });

  test('unchanged progress after a click is detected', async () => {
    const h = new Harness('shopping', { stuckProgress: true });
    await h.ready();
    await expect(h.invoke(scenarios[2]!)).rejects.toMatchObject({ matcherResult: expect.any(Object) });
    expect(h.events).toContain('click:items');
  });

  test('missing exit control after entry is detected', async () => {
    const h = new Harness('shopping', { modeExit: false });
    await h.ready();
    await expect(h.invoke(scenarios[3]!)).rejects.toMatchObject({ matcherResult: expect.any(Object) });
    expect(h.page.mode).toBe(true);
  });

  test('missing progress is detected', async () => {
    const h = new Harness('shopping', { progressVisible: false });
    await h.ready();
    await expect(h.invoke(scenarios[4]!)).rejects.toMatchObject({ matcherResult: expect.any(Object) });
  });

  test('New List is an accepted alternative to Add List', async () => {
    const h = new Harness('shopping', { addList: false, newList: true });
    await h.ready();
    await expect(h.invoke(scenarios[5]!)).resolves.toBeUndefined();
  });

  test('both absent list controls are detected', async () => {
    const h = new Harness('shopping', { addList: false, newList: false });
    await h.ready();
    await expect(h.invoke(scenarios[5]!)).rejects.toMatchObject({ matcherResult: expect.any(Object) });
  });

  test('unknown routes, request methods and selectors fail closed', async () => {
    const h = new Harness('shopping');
    await h.ready();
    await expect(h.page.goto('https://forbidden.invalid')).rejects.toThrow('Denied synthetic navigation');
    await expect(h.request(h.page, 'GET', '/api/unknown')).rejects.toThrow('Denied synthetic route');
    await expect(h.request(h.page, 'PUT', '/api/shopping-items')).rejects.toThrow('Denied synthetic route');
    expect(() => h.page.locator('unknown')).toThrow('Denied synthetic selector');
    expect(h.calls).toEqual([]);
  });
});
