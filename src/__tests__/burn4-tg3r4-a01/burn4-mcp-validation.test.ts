import { createHarness, end, id, start } from './burn4-mcp-harness';

type InvalidCase = { name: string; args: Record<string, unknown>; reason: string };
const invalid: InvalidCase[] = [
  { name: 'list_chores', args: { assignedTo: 'broken' }, reason: 'malformed user UUID' },
  { name: 'list_chores', args: { enabled: 'false' }, reason: 'string boolean' },
  { name: 'list_chores', args: { includeFuture: 1 }, reason: 'numeric boolean' },
  { name: 'create_chore', args: { title: '', category: 'cleaning', frequency: 'daily' }, reason: 'empty title' },
  { name: 'create_chore', args: { title: 'x'.repeat(256), category: 'cleaning', frequency: 'daily' }, reason: 'oversized title' },
  { name: 'create_chore', args: { title: 'Clean', category: 'unknown', frequency: 'daily' }, reason: 'unknown category' },
  { name: 'create_chore', args: { title: 'Clean', category: 'cleaning', frequency: 'hourly' }, reason: 'unknown frequency' },
  { name: 'create_chore', args: { title: 'Clean', category: 'cleaning', frequency: 'daily', pointValue: -1 }, reason: 'negative points' },
  { name: 'create_chore', args: { title: 'Clean', category: 'cleaning', frequency: 'daily', pointValue: 1001 }, reason: 'points above maximum' },
  { name: 'create_chore', args: { title: 'Clean', category: 'cleaning', frequency: 'daily', pointValue: 0.5 }, reason: 'fractional points' },
  { name: 'create_chore', args: { title: 'Clean', category: 'cleaning', frequency: 'custom', customIntervalDays: 0 }, reason: 'interval below minimum' },
  { name: 'create_chore', args: { title: 'Clean', category: 'cleaning', frequency: 'custom', customIntervalDays: 366 }, reason: 'interval above maximum' },
  { name: 'create_chore', args: { title: 'Clean', category: 'cleaning', frequency: 'daily', nextDue: '10/21/2026' }, reason: 'wrong date shape' },
  { name: 'create_chore', args: { title: 'Clean', category: 'cleaning', frequency: 'daily', nextDueTime: '9:00' }, reason: 'wrong clock shape' },
  { name: 'update_chore', args: { id, title: null }, reason: 'null title' },
  { name: 'update_chore', args: { id, pointValue: -1 }, reason: 'negative updated points' },
  { name: 'update_chore', args: { id, nextDue: null }, reason: 'null nonnullable date' },
  { name: 'delete_chore', args: { id: 'bad' }, reason: 'malformed chore UUID' },
  { name: 'complete_chore', args: { id }, reason: 'missing completing user' },
  { name: 'complete_chore', args: { id, userId: 'bad' }, reason: 'malformed completing user' },
  { name: 'list_tasks', args: { limit: 0 }, reason: 'task limit below minimum' },
  { name: 'list_tasks', args: { limit: 101 }, reason: 'task limit above maximum' },
  { name: 'list_tasks', args: { limit: 1.5 }, reason: 'fractional task limit' },
  { name: 'list_tasks', args: { offset: -1 }, reason: 'negative offset' },
  { name: 'list_tasks', args: { dueBefore: '2026-10-21' }, reason: 'date without datetime' },
  { name: 'list_tasks', args: { dueAfter: '2026-02-30T10:00:00Z' }, reason: 'impossible ISO date' },
  { name: 'list_tasks', args: { priority: 'urgent' }, reason: 'unknown priority' },
  { name: 'create_task', args: {}, reason: 'missing task title' },
  { name: 'create_task', args: { title: 'Study', assignedTo: null }, reason: 'null creation assignee' },
  { name: 'update_task', args: { id, completed: 'true' }, reason: 'invalid completion boolean' },
  { name: 'delete_task', args: {}, reason: 'missing task UUID' },
  { name: 'list_events', args: { startDate: start }, reason: 'missing range end' },
  { name: 'list_events', args: { startDate: start, endDate: end, limit: 501 }, reason: 'event limit above maximum' },
  { name: 'create_event', args: { title: 'Walk', startTime: start, endTime: end, color: '#123' }, reason: 'short color' },
  { name: 'create_event', args: { title: 'Walk', startTime: start, endTime: end, color: '#GGGGGG' }, reason: 'invalid hex color' },
  { name: 'create_event', args: { title: 'Walk', startTime: start, endTime: end, location: 'x'.repeat(256) }, reason: 'oversized location' },
  { name: 'update_event', args: { id, startTime: 'tomorrow' }, reason: 'invalid event datetime' },
  { name: 'delete_event', args: { id: 2 }, reason: 'nonstring event UUID' },
  { name: 'list_shopping_items', args: { listId: 'bad' }, reason: 'invalid list UUID' },
  { name: 'add_shopping_item', args: { name: 'Oats' }, reason: 'missing shopping list' },
  { name: 'add_shopping_item', args: { name: '', listId: id }, reason: 'empty item name' },
  { name: 'update_shopping_item', args: { id, checked: null }, reason: 'null checked state' },
  { name: 'delete_shopping_item', args: { id: 'bad' }, reason: 'invalid item UUID' },
  { name: 'list_messages', args: { limit: 101 }, reason: 'message limit above maximum' },
  { name: 'list_messages', args: { limit: 0 }, reason: 'message limit below minimum' },
  { name: 'post_message', args: { content: 'x'.repeat(1001), authorId: id }, reason: 'oversized message' },
  { name: 'post_message', args: { content: '', authorId: id }, reason: 'empty message' },
  { name: 'post_message', args: { content: 'Reminder' }, reason: 'missing message author' },
  { name: 'post_message', args: { content: 'Reminder', authorId: id, expiresAt: 'later' }, reason: 'invalid expiration' },
  { name: 'delete_message', args: { id: 'bad' }, reason: 'invalid message UUID' },
  { name: 'list_meals', args: { startDate: '2026-1-01' }, reason: 'unpadded meal date' },
  { name: 'create_meal', args: { name: 'Soup', date: '2026-10-21', mealType: 'brunch' }, reason: 'unknown meal type' },
  { name: 'create_meal', args: { name: 'Soup' }, reason: 'missing meal date' },
  { name: 'delete_meal', args: { id: 'bad' }, reason: 'invalid meal UUID' },
  { name: 'create_goal', args: { title: 'Trip', targetPoints: 0 }, reason: 'zero goal target' },
  { name: 'create_goal', args: { title: 'Trip', targetPoints: 1.5 }, reason: 'fractional goal target' },
  { name: 'import_recipe_url', args: { url: 'not a URL' }, reason: 'malformed recipe URL' },
  { name: 'create_maintenance_item', args: { title: 'Filter', frequency: 'weekly' }, reason: 'unsupported maintenance frequency' },
  { name: 'create_maintenance_item', args: { title: 'Filter', dueDate: 'next week' }, reason: 'invalid maintenance date shape' },
];

test.each(invalid)('$name rejects $reason before any HTTP request', async ({ name, args }) => {
  const h = createHarness();
  await expect(h.call(name, args)).rejects.toHaveProperty('name', 'ZodError');
  expect(h.requests).toHaveLength(0);
});

test.each(['cleaning', 'laundry', 'dishes', 'yard', 'pets', 'trash', 'other'])('accepts chore category %s', async category => {
  const h = createHarness();
  await h.call('create_chore', { title: 'Chore', category, frequency: 'daily' });
  expect(JSON.parse(h.requests[0]!.body!).category).toBe(category);
});

test.each(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semi-annually', 'annually', 'custom'])('accepts chore frequency %s', async frequency => {
  const h = createHarness();
  await h.call('create_chore', { title: 'Chore', category: 'other', frequency, customIntervalDays: 1 });
  expect(JSON.parse(h.requests[0]!.body!).frequency).toBe(frequency);
});

test.each(['breakfast', 'lunch', 'dinner', 'snack'])('accepts meal type %s', async mealType => {
  const h = createHarness();
  await h.call('create_meal', { name: 'Toast', date: '2028-02-29', mealType });
  expect(JSON.parse(h.requests[0]!.body!).mealType).toBe(mealType);
});

test.each(['one-time', 'monthly', 'quarterly', 'semi-annually', 'annually'])('accepts maintenance frequency %s', async frequency => {
  const h = createHarness();
  await h.call('create_maintenance_item', { title: 'Filter', frequency });
  expect(JSON.parse(h.requests[0]!.body!).frequency).toBe(frequency);
});
