import { POST, listId, payload, request, reset, state, userId } from './burn4-harness';

beforeEach(reset);

test('compiles the real route list query with a UUID predicate, limit and key-share lock', async () => {
  expect((await POST(request())).status).toBe(201);
  const list = state.queries.find(query => query.kind === 'list')!;
  expect(list.sql).toBe('select "id" from "shopping_lists" where "shopping_lists"."id" = $1 limit $2 for key share');
  expect(list.params).toEqual([listId, 1]);
});

test('compiles one parameterized multirow item INSERT and explicit public RETURNING fields', async () => {
  const names = ['Rice', "Beans'); drop table shopping_items; --"];
  expect((await POST(request(payload(names.map(name => ({ name })))))).status).toBe(201);
  const queries = state.queries.filter(query => query.kind === 'items');
  expect(queries).toHaveLength(1);
  const query = queries[0]!;
  expect(query.sql).toMatch(/^insert into "shopping_items" /);
  expect(query.sql.match(/\), \(/g)).toHaveLength(1);
  expect(query.params).toContain(names[0]);
  expect(query.params).toContain(names[1]);
  expect(query.params.filter(param => param === userId)).toHaveLength(2);
  expect(query.sql).not.toContain(names[0]);
  expect(query.sql).not.toContain(names[1]);
  expect(query.sql.split(' returning ')[1]).toBe([
    '"id"', '"list_id"', '"name"', '"quantity"', '"unit"', '"category"', '"checked"',
    '"recurring"', '"recurrence_interval"', '"notes"', '"created_at"',
  ].join(', '));
  expect(query.sql.split(' returning ')[1]).not.toContain('source_id');
  expect(query.sql.split(' returning ')[1]).not.toContain('added_by');
});

test('compiles one parameterized multirow audit INSERT after item identities exist', async () => {
  expect((await POST(request(payload([{ name: 'Rice' }, { name: 'Beans' }])))).status).toBe(201);
  const audits = state.queries.filter(query => query.kind === 'audit');
  expect(audits).toHaveLength(1);
  expect(audits[0]!.sql).toMatch(/^insert into "audit_logs" /);
  expect(audits[0]!.sql.match(/\), \(/g)).toHaveLength(1);
  for (const row of state.committedItems) expect(audits[0]!.params).toContain(row.id);
  expect(audits[0]!.params.filter(value => value === userId)).toHaveLength(2);
  expect(audits[0]!.params).not.toContain('Rice');
  expect(audits[0]!.params).not.toContain('Beans');
  expect(state.events.indexOf('audit')).toBeLessThan(state.events.indexOf('commit'));
  expect(state.events.indexOf('cache')).toBeGreaterThan(state.events.indexOf('commit'));
});

test('keeps nullable defaults, empty text, Unicode and int32 values intact in bound SQL parameters', async () => {
  const response = await POST(request(payload([
    { name: '米 🍚', quantity: 2147483647, unit: '', category: '', notes: '' },
    { name: 'Beans' },
  ])));
  expect(response.status).toBe(201);
  const query = state.queries.find(row => row.kind === 'items')!;
  expect(query.params).toContain('米 🍚');
  expect(query.params).toContain(2147483647);
  expect(query.params.filter(value => value === '')).toHaveLength(3);
  expect(query.params.filter(value => value === false)).toHaveLength(4);
  expect(query.params.filter(value => value === listId)).toHaveLength(2);
  expect(query.sql).toContain('default');
  expect(state.committedItems[1]).toMatchObject({ quantity: null, unit: null,
    category: null, notes: null, recurrenceInterval: null, checked: false, recurring: false });
});
