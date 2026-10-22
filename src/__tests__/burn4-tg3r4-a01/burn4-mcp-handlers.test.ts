import { createHarness, end, id, otherId, reply, start } from './burn4-mcp-harness';

type Case = { name: string; args: Record<string, unknown>; method: string; path: string; body?: Record<string, unknown> };
const cases: Case[] = [
  { name: 'list_chores', args: {}, method: 'GET', path: '/api/chores' },
  { name: 'create_chore', args: { title: 'Clean', category: 'cleaning', frequency: 'daily' }, method: 'POST', path: '/api/chores', body: { title: 'Clean', category: 'cleaning', frequency: 'daily', pointValue: 0, requiresApproval: false } },
  { name: 'update_chore', args: { id, title: 'Updated', assignedTo: null, enabled: false, nextDueTime: null }, method: 'PUT', path: `/api/chores/${id}`, body: { title: 'Updated', assignedTo: null, enabled: false, nextDueTime: null } },
  { name: 'delete_chore', args: { id }, method: 'DELETE', path: `/api/chores/${id}` },
  { name: 'complete_chore', args: { id, userId: otherId }, method: 'POST', path: `/api/chores/${id}/complete`, body: { userId: otherId } },
  { name: 'list_tasks', args: {}, method: 'GET', path: '/api/tasks?limit=50&offset=0' },
  { name: 'create_task', args: { title: 'Read', listId: null }, method: 'POST', path: '/api/tasks', body: { title: 'Read', listId: null } },
  { name: 'update_task', args: { id, assignedTo: null, dueDate: null, priority: null, completed: false, listId: null }, method: 'PUT', path: `/api/tasks/${id}`, body: { assignedTo: null, dueDate: null, priority: null, completed: false, listId: null } },
  { name: 'delete_task', args: { id }, method: 'DELETE', path: `/api/tasks/${id}` },
  { name: 'list_events', args: { startDate: start, endDate: end }, method: 'GET', path: `/api/events?${new URLSearchParams({ startDate: start, endDate: end, limit: '100' })}` },
  { name: 'create_event', args: { title: 'Walk', startTime: start, endTime: end }, method: 'POST', path: '/api/events', body: { title: 'Walk', startTime: start, endTime: end, allDay: false } },
  { name: 'update_event', args: { id, title: 'Walk later', allDay: false }, method: 'PUT', path: `/api/events/${id}`, body: { title: 'Walk later', allDay: false } },
  { name: 'delete_event', args: { id }, method: 'DELETE', path: `/api/events/${id}` },
  { name: 'list_shopping_lists', args: {}, method: 'GET', path: '/api/shopping-lists' },
  { name: 'list_shopping_items', args: {}, method: 'GET', path: '/api/shopping-items?' },
  { name: 'add_shopping_item', args: { name: 'Oats', listId: id }, method: 'POST', path: '/api/shopping-items', body: { name: 'Oats', listId: id, recurring: false } },
  { name: 'update_shopping_item', args: { id, checked: false, quantity: '0' }, method: 'PUT', path: `/api/shopping-items/${id}`, body: { checked: false, quantity: '0' } },
  { name: 'delete_shopping_item', args: { id }, method: 'DELETE', path: `/api/shopping-items/${id}` },
  { name: 'list_messages', args: {}, method: 'GET', path: '/api/messages?limit=20' },
  { name: 'post_message', args: { content: 'Practice at five', authorId: id }, method: 'POST', path: '/api/messages', body: { content: 'Practice at five', authorId: id, pinned: false, important: false } },
  { name: 'delete_message', args: { id }, method: 'DELETE', path: `/api/messages/${id}` },
  { name: 'list_family', args: {}, method: 'GET', path: '/api/family' },
  { name: 'list_meals', args: {}, method: 'GET', path: '/api/meals?' },
  { name: 'create_meal', args: { name: 'Soup', date: '2026-10-21' }, method: 'POST', path: '/api/meals', body: { name: 'Soup', date: '2026-10-21' } },
  { name: 'delete_meal', args: { id }, method: 'DELETE', path: `/api/meals/${id}` },
  { name: 'list_goals', args: {}, method: 'GET', path: '/api/goals' },
  { name: 'create_goal', args: { title: 'Book', targetPoints: 25 }, method: 'POST', path: '/api/goals', body: { title: 'Book', targetPoints: 25, recurring: false } },
  { name: 'get_weather', args: {}, method: 'GET', path: '/api/weather' },
  { name: 'list_recipes', args: {}, method: 'GET', path: '/api/recipes' },
  { name: 'import_recipe_url', args: { url: 'https://recipes.invalid/soup?q=one%20pot' }, method: 'POST', path: '/api/recipes/import-url', body: { url: 'https://recipes.invalid/soup?q=one%20pot' } },
  { name: 'list_maintenance', args: {}, method: 'GET', path: '/api/maintenance' },
  { name: 'create_maintenance_item', args: { title: 'Filter' }, method: 'POST', path: '/api/maintenance', body: { title: 'Filter' } },
  { name: 'get_points', args: {}, method: 'GET', path: '/api/points' },
];

describe('all registered MCP handlers', () => {
  test('registers the complete documented tool surface and connects once', async () => {
    const h = createHarness();
    await h.ready;
    expect([...h.tools.keys()].sort()).toEqual(cases.map(c => c.name).sort());
    expect(h.tools.size).toBe(33);
    expect([...h.tools.values()].every(tool => tool.description.length > 0)).toBe(true);
    expect(h.identities).toEqual([{ name: 'prism', version: '1.0.0' }]);
    expect(h.stats()).toEqual({ connections: 1, transportCreations: 1 });
    expect(h.transports).toHaveLength(1);
    expect(h.requests).toHaveLength(0);
  });

  test.each(cases)('$name maps its minimal input to the expected HTTP request', async ({ name, args, method, path, body }) => {
    const h = createHarness();
    const data = { source: name, saved: true };
    h.queue(reply(data));
    const output = await h.call(name, args);
    expect(h.requests).toHaveLength(1);
    const request = h.requests[0]!;
    expect(request.url).toBe(`https://offline.invalid${path}`);
    expect(request.method).toBe(method);
    expect(request.body === undefined ? undefined : JSON.parse(request.body)).toEqual(body);
    expect(output.structuredContent).toEqual(data);
    expect(output.content).toEqual([{ type: 'text', text: JSON.stringify(data, null, 2) }]);
  });
});

const filterCases = [
  { name: 'list_chores', args: { assignedTo: id, enabled: false, includeFuture: true }, query: { assignedTo: id, enabled: 'false', includeFuture: 'true' } },
  { name: 'list_chores', args: { enabled: true, includeFuture: false }, query: { enabled: 'true' } },
  { name: 'list_tasks', args: { userId: id, completed: false, priority: 'high', dueBefore: end, dueAfter: start, limit: 100, offset: 4 }, query: { userId: id, completed: 'false', priority: 'high', dueBefore: end, dueAfter: start, limit: '100', offset: '4' } },
  { name: 'list_tasks', args: { completed: true, limit: 1, offset: 0 }, query: { completed: 'true', limit: '1', offset: '0' } },
  { name: 'list_events', args: { startDate: start, endDate: end, calendarId: id, limit: 500 }, query: { startDate: start, endDate: end, calendarId: id, limit: '500' } },
  { name: 'list_shopping_items', args: { listId: id, checked: false }, query: { listId: id, checked: 'false' } },
  { name: 'list_shopping_items', args: { checked: true }, query: { checked: 'true' } },
  { name: 'list_messages', args: { limit: 100, pinned: false, includeExpired: true }, query: { limit: '100', pinned: 'false', includeExpired: 'true' } },
  { name: 'list_messages', args: { limit: 1, pinned: true, includeExpired: false }, query: { limit: '1', pinned: 'true' } },
  { name: 'list_meals', args: { startDate: '2026-10-21', endDate: '2026-10-31' }, query: { startDate: '2026-10-21', endDate: '2026-10-31' } },
] satisfies Array<{ name: string; args: Record<string, unknown>; query: Record<string, string> }>;

test.each(filterCases)('$name preserves explicit filter values $args', async ({ name, args, query }) => {
  const h = createHarness();
  await h.call(name, args);
  const url = new URL(h.requests[0]!.url);
  expect(Object.fromEntries(url.searchParams)).toEqual(query);
  expect(h.requests[0]!.body).toBeUndefined();
});

const fullBodyCases = [
  { name: 'create_chore', body: { title: 'Wash', description: 'Use gentle cycle', category: 'laundry', frequency: 'custom', assignedTo: id, pointValue: 1000, requiresApproval: true, customIntervalDays: 365, nextDue: '2028-02-29', nextDueTime: '23:59' } },
  { name: 'update_chore', body: { title: 'Sweep', category: 'other', frequency: 'weekly', description: '', assignedTo: otherId, pointValue: 0, requiresApproval: false, enabled: true, nextDue: '2026-12-31', nextDueTime: '00:00' }, update: true },
  { name: 'create_task', body: { title: 'Study', description: 'Read chapter', assignedTo: id, dueDate: start, priority: 'low', listId: otherId } },
  { name: 'update_task', body: { title: 'Study more', description: '', assignedTo: otherId, dueDate: end, priority: 'medium', completed: true, listId: id }, update: true },
  { name: 'create_event', body: { title: 'Hike', startTime: start, endTime: end, description: 'Bring water', location: 'Trail & pond', allDay: true, calendarSourceId: id, color: '#a1B2c3', createdBy: otherId } },
  { name: 'update_event', body: { title: 'Later hike', startTime: start, endTime: end, description: '', location: '', allDay: true, color: '#000000' }, update: true },
  { name: 'add_shopping_item', body: { name: 'Flour', listId: id, quantity: '1', unit: 'bag', category: 'Baking', notes: 'Whole grain', recurring: true } },
  { name: 'update_shopping_item', body: { name: 'Flour', checked: true, quantity: '2', unit: 'bag', category: 'Baking', notes: '' }, update: true },
  { name: 'post_message', body: { content: 'Reminder', authorId: id, pinned: true, important: true, expiresAt: end } },
  { name: 'create_meal', body: { name: 'Stew', date: '2026-10-21', mealType: 'dinner', notes: 'Batch cook', recipeId: id } },
  { name: 'create_goal', body: { title: 'Trip', description: 'Day trip', targetPoints: 200, assignedTo: id, reward: 'Museum', recurring: true } },
  { name: 'create_maintenance_item', body: { title: 'Filter', description: 'Replace filter', dueDate: '2026-11-01', frequency: 'quarterly' } },
] satisfies Array<{ name: string; body: Record<string, unknown>; update?: boolean }>;

test.each(fullBodyCases)('$name forwards every declared body field and removes routing ID', async ({ name, body, update }) => {
  const h = createHarness();
  await h.call(name, update ? { id, ...body } : body);
  expect(JSON.parse(h.requests[0]!.body!)).toEqual(body);
  expect(JSON.parse(h.requests[0]!.body!)).not.toHaveProperty('id');
});

test('unknown client fields are removed by the declared Zod input object', async () => {
  const h = createHarness();
  await h.call('create_task', { title: 'Read', unexpected: 'discard me' });
  expect(JSON.parse(h.requests[0]!.body!)).toEqual({ title: 'Read' });
});
