import { Harness, Options } from './burn4-harness';

const scenarios = [
  'add item via API and verify on page',
  'add item via modal',
  'check and uncheck a shopping item',
  'create a new shopping list',
  'delete a shopping item',
];

describe('Shopping CRUD original callbacks', () => {
  test.each(scenarios)('%s owns and cleans its synthetic records', async (name) => {
    const h = new Harness('shopping-crud');
    await h.hook('beforeAll');
    expect(h.pages[1]?.closed).toBe(true);
    await h.run(name);
    expect([...h.items.keys()]).toEqual(['baseline-item']);
    expect([...h.lists.keys()]).toEqual(['list-a']);
    expect(h.page.actor).toBe('');
    const created = h.calls.filter((call) => call.method === 'POST');
    expect(created).toHaveLength(1);
    expect(created[0]?.actor).toBe('adult-a');
    if (name !== scenarios[3]) expect(created[0]?.data?.listId).toBe('list-a');
    if (name === scenarios[2]) expect(h.calls.filter((call) => call.method === 'PATCH').map((call) => call.data?.checked)).toEqual([true, false]);
    if (name === scenarios[1]) expect(h.events).toContain('modal:fill');
    const cleaned = h.events.filter((event) => event.startsWith('cleanup:'));
    await h.hook('afterEach');
    expect(h.events.filter((event) => event.startsWith('cleanup:'))).toEqual(cleaned);
  });

  test('default list discovery supports bare list arrays', async () => {
    const h = new Harness('shopping-crud', { bareLists: true });
    await h.hook('beforeAll');
    await h.run(scenarios[0]!);
    expect(h.calls.find((call) => call.method === 'POST')?.data?.listId).toBe('list-a');
  });

  test('documented missing-modal fallback creates through API and still cleans up', async () => {
    const h = new Harness('shopping-crud', { addItem: false });
    await h.hook('beforeAll');
    await h.run(scenarios[1]!);
    expect(h.events).not.toContain('modal:fill');
    expect(h.calls.find((call) => call.method === 'POST')?.data?.name).toContain('E2E API Item');
    expect([...h.items.keys()]).toEqual(['baseline-item']);
  });

  const faults: [string, string, Options][] = [
    ['create status', scenarios[0]!, { reply: (call, reply) => call.method === 'POST' ? { ...reply, status: 500 } : reply }],
    ['created item missing from page', scenarios[0]!, { hiddenCreatedItem: true }],
    ['modal stays open', scenarios[1]!, { stuckModal: true }],
    ['check status', scenarios[2]!, { reply: (call, reply) => call.method === 'PATCH' ? { ...reply, status: 500 } : reply }],
    ['check flag', scenarios[2]!, { reply: (call, reply) => call.method === 'PATCH' ? { ...reply, body: { checked: false } } : reply }],
    ['uncheck flag', scenarios[2]!, { reply: (call, reply) => call.method === 'PATCH' && call.data?.checked === false ? { ...reply, body: { checked: true } } : reply }],
    ['new list absent from listing', scenarios[3]!, { reply: (call, reply) => call.method === 'GET' && call.path === '/api/shopping-lists' ? { ...reply, body: { lists: [{ id: 'list-a' }] } } : reply }],
    ['delete status', scenarios[4]!, { reply: (call, reply) => call.method === 'DELETE' ? { ...reply, status: 500 } : reply }],
    ['deleted item remains in listing', scenarios[4]!, { reply: (call, reply) => call.method === 'GET' && call.path.startsWith('/api/shopping-items?') ? { ...reply, body: { items: [{ id: 'created-1' }] } } : reply }],
  ];
  test.each(faults)('%s regression is rejected', async (_label, name, options) => {
    const h = new Harness('shopping-crud', options);
    await h.ready();
    await expect(h.invoke(name)).rejects.toMatchObject({ matcherResult: expect.any(Object) });
    expect(h.calls.some((call) => call.method === 'POST')).toBe(true);
  });

  test('cleanup attempts tracked item before list and logs out after both', async () => {
    const h = new Harness('shopping-crud');
    await h.ready();
    await h.invoke(scenarios[0]!);
    await h.invoke(scenarios[3]!);
    await h.hook('afterEach');
    const cleanupEvents = h.events.filter((event) => event.startsWith('cleanup:') || event.startsWith('logout:'));
    expect(cleanupEvents).toEqual(['cleanup:items:created-1', 'cleanup:lists:created-2', 'logout:adult-a']);
  });
});

test('failed synthetic delete preserves the record for cleanup evidence', async () => {
  const h = new Harness('shopping-crud', { reply: (call, reply) => call.method === 'DELETE' ? { ...reply, status: 500 } : reply });
  await h.ready();
  await h.invoke('add item via API and verify on page');
  const response = await h.page.request.delete('/api/shopping-items/created-1');
  expect(response.ok()).toBe(false);
  expect(h.items.has('created-1')).toBe(true);
});
