import { NextResponse } from 'next/server';
import {
  POST, committedCounts, createdAt, invalidateMock, listId, noBodyRequest, otherId,
  payload, rateLimitMock, request, requireAuthMock, reset, state, streamRequest,
  unreadableRequest, userId,
} from './burn4-harness';

beforeEach(reset);

function expectNoWrites() {
  expect(state.transactions).toBe(0);
  expect(committedCounts()).toEqual([0, 0]);
  expect(invalidateMock).not.toHaveBeenCalled();
}

test('passes through auth denial before reading body or charging rate', async () => {
  const denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  state.auth = denied;
  const probe = unreadableRequest();
  expect(await POST(probe.request)).toBe(denied);
  expect(probe.bodyRead).not.toHaveBeenCalled();
  expect(rateLimitMock).not.toHaveBeenCalled();
  expectNoWrites();
});

test.each([
  { role: 'guest' as const },
  { role: 'parent' as const, scopes: [] },
  { role: 'parent' as const, scopes: ['voice'] },
  { role: 'parent' as const, scopes: ['canManageRecipes'] },
])('denies insufficient authority before reading the body: %j', async auth => {
  state.auth = { userId, ...auth };
  const probe = unreadableRequest();
  expect((await POST(probe.request)).status).toBe(403);
  expect(probe.bodyRead).not.toHaveBeenCalled();
  expect(rateLimitMock).not.toHaveBeenCalled();
  expectNoWrites();
});

test.each([
  { role: 'parent' as const },
  { role: 'child' as const },
  { role: 'parent' as const, scopes: ['*'] },
  { role: 'parent' as const, scopes: ['voice', '*'] },
])('accepts family writers or full API authority: %j', async auth => {
  state.auth = { userId, ...auth };
  expect((await POST(request())).status).toBe(201);
  expect(committedCounts()).toEqual([1, 1]);
  expect(requireAuthMock).toHaveBeenCalledTimes(1);
});

test('charges a 200-item request once under the bounded batch policy', async () => {
  const response = await POST(request(payload(Array.from({ length: 200 }, (_, i) => ({ name: `Item ${i}` })))));
  expect(response.status).toBe(201);
  expect(rateLimitMock).toHaveBeenCalledTimes(1);
  expect(rateLimitMock).toHaveBeenCalledWith(userId, 'shopping-item-batches', 30, 60);
  expect(committedCounts()).toEqual([200, 200]);
  expect(invalidateMock).toHaveBeenCalledTimes(1);
});

test('passes through rate denial without reading body or writing', async () => {
  const denied = NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: { 'retry-after': '60' } });
  state.limited = denied;
  const probe = unreadableRequest();
  expect(await POST(probe.request)).toBe(denied);
  expect(probe.bodyRead).not.toHaveBeenCalled();
  expect(rateLimitMock).toHaveBeenCalledTimes(1);
  expectNoWrites();
});

test.each(['authError', 'rateError'] as const)('sanitizes %s infrastructure errors without body work', async kind => {
  state[kind] = true;
  const probe = unreadableRequest();
  const response = await POST(probe.request);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Failed to create shopping item batch' });
  expect(probe.bodyRead).not.toHaveBeenCalled();
  expectNoWrites();
});

test.each(['text/plain', 'application/xml', 'application/problem+json', ''])('rejects wrong media type %j', async media => {
  expect((await POST(request(payload(), media))).status).toBe(415);
  expectNoWrites();
});

test('accepts JSON media type with charset and mixed case', async () => {
  expect((await POST(request(payload(), ' Application/JSON ; charset=utf-8'))).status).toBe(201);
});

test.each(['{', '', 'null', '[]', '123', 'true'])('rejects malformed JSON or root %j', async text => {
  const probe = streamRequest([new TextEncoder().encode(text)]);
  expect((await POST(probe.request)).status).toBe(400);
  expectNoWrites();
});

test('rejects a missing request body', async () => {
  expect((await POST(noBodyRequest())).status).toBe(400);
  expectNoWrites();
});

test('handles body transport errors as invalid input without persistence', async () => {
  const probe = streamRequest([], { rejectRead: true });
  expect((await POST(probe.request)).status).toBe(400);
  expectNoWrites();
});

test('rejects malformed UTF-8 instead of replacing bytes in ingredient text', async () => {
  const probe = streamRequest([new Uint8Array([123, 34, 97, 34, 58, 34, 255, 34, 125])]);
  expect((await POST(probe.request)).status).toBe(400);
  expectNoWrites();
});

test.each([undefined, '1', '999999999'])('uses real streamed byte count when Content-Length is %j', async contentLength => {
  const probe = streamRequest([
    new Uint8Array(512 * 1024), new Uint8Array([32]), new Uint8Array([32]),
  ], { contentLength });
  const response = await POST(probe.request);
  expect(response.status).toBe(413);
  expect(probe.cancelled).toHaveBeenCalledTimes(1);
  expectNoWrites();
});

test('accepts exactly 512 KiB including harmless trailing whitespace', async () => {
  const json = JSON.stringify(payload());
  const encoded = new TextEncoder().encode(json + ' '.repeat(512 * 1024 - json.length));
  const probe = streamRequest([encoded.subarray(0, 123), encoded.subarray(123)]);
  expect((await POST(probe.request)).status).toBe(201);
});

test('counts Unicode bytes instead of character count for the stream cap', async () => {
  const text = JSON.stringify(payload([{ name: '米'.repeat(180000) }]));
  expect(text.length).toBeLessThan(512 * 1024);
  const probe = streamRequest([new TextEncoder().encode(text), new Uint8Array([32])]);
  expect((await POST(probe.request)).status).toBe(413);
  expectNoWrites();
});

test.each(['rejectCancel', 'neverCancel'] as const)('overflow response tolerates %s cleanup', async option => {
  const probe = streamRequest([new Uint8Array(512 * 1024 + 1), new Uint8Array([32])], { [option]: true });
  expect((await POST(probe.request)).status).toBe(413);
  expect(probe.cancelled).toHaveBeenCalledTimes(1);
  expectNoWrites();
});

test('decodes fragmented multibyte input and empty chunks without losing text', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify(payload([{ name: '米 ½ cup' }])));
  const chunks = Array.from(encoded, byte => new Uint8Array([byte]));
  chunks.splice(4, 0, new Uint8Array());
  const response = await POST(streamRequest(chunks).request);
  expect(response.status).toBe(201);
  expect((await response.json()).items[0].name).toBe('米 ½ cup');
});

const invalidBodies: [string, unknown][] = [
  ['missing list', { items: [{ name: 'Rice' }] }],
  ['invalid list UUID', { listId: 'wrong', items: [{ name: 'Rice' }] }],
  ['missing items', { listId }],
  ['empty items', payload([])],
  ['201 items', payload(Array.from({ length: 201 }, () => ({ name: 'Rice' })))],
  ['null item', payload([null])],
  ['missing name', payload([{}])],
  ['empty name', payload([{ name: '' }])],
  ['whitespace name', payload([{ name: '\n \t' }])],
  ['overlong name', payload([{ name: 'x'.repeat(256) }])],
  ['nonstring name', payload([{ name: 1 }])],
  ['zero quantity', payload([{ name: 'Rice', quantity: 0 }])],
  ['negative quantity', payload([{ name: 'Rice', quantity: -1 }])],
  ['fractional quantity', payload([{ name: 'Rice', quantity: 1.5 }])],
  ['string quantity', payload([{ name: 'Rice', quantity: '1' }])],
  ['null quantity', payload([{ name: 'Rice', quantity: null }])],
  ['int32 overflow quantity', payload([{ name: 'Rice', quantity: 2147483648 }])],
  ['overlong unit', payload([{ name: 'Rice', unit: 'x'.repeat(51) }])],
  ['overlong category', payload([{ name: 'Rice', category: 'x'.repeat(51) }])],
  ['overlong notes', payload([{ name: 'Rice', notes: 'x'.repeat(501) }])],
  ['nonstring unit', payload([{ name: 'Rice', unit: 3 }])],
  ['null category', payload([{ name: 'Rice', category: null }])],
  ['nonstring notes', payload([{ name: 'Rice', notes: {} }])],
  ['spoofed attribution', payload([{ name: 'Rice', addedBy: otherId }])],
  ['caller item ID', payload([{ name: 'Rice', id: otherId }])],
  ['caller list override', payload([{ name: 'Rice', listId: otherId }])],
  ['caller checked state', payload([{ name: 'Rice', checked: true }])],
  ['caller recurrence', payload([{ name: 'Rice', recurring: true }])],
  ['caller external identity', payload([{ name: 'Rice', externalId: 'not-accepted' }])],
  ['unknown root property', { ...payload(), extra: true }],
  ['last row invalid', payload([{ name: 'Rice' }, { name: '' }])],
  ...(['name', 'unit', 'category', 'notes'] as const).flatMap(field => [
    [`NUL in ${field}`, payload([{ name: 'Rice', [field]: 'bad\0text' }])] as [string, unknown],
    [`lone surrogate in ${field}`, payload([{ name: 'Rice', [field]: 'bad\ud800text' }])] as [string, unknown],
  ]),
];
test.each(invalidBodies)('validates complete payload before any transaction: %s', async (_label, body) => {
  const response = await POST(request(body));
  expect(response.status).toBe(400);
  const result = await response.json();
  expect(result.error).toBe('Validation failed');
  expect(Array.isArray(result.details)).toBe(true);
  expect(result.details.length).toBeGreaterThan(0);
  expectNoWrites();
});

test('accepts every exact field bound, preserving text and maximal int32 quantity', async () => {
  const item = { name: ` ${'x'.repeat(253)} `, quantity: 2147483647,
    unit: 'u'.repeat(50), category: 'c'.repeat(50), notes: 'n'.repeat(500) };
  const response = await POST(request(payload([item])));
  expect(response.status).toBe(201);
  expect((await response.json()).items[0]).toMatchObject(item);
});

test('reports issue paths without reflecting body values', async () => {
  const response = await POST(request(payload([{ name: 'x'.repeat(256) }])));
  expect(await response.json()).toEqual({ error: 'Validation failed', details: [
    { path: ['items', 0, 'name'], code: 'too_big' },
  ] });
});

test('missing list rolls back without item/audit inserts or cache invalidation', async () => {
  state.listExists = false;
  const response = await POST(request());
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Shopping list not found' });
  expect(state.queries.map(q => q.kind)).toEqual(['list']);
  expect(state.rollbacks).toBe(1);
  expect(committedCounts()).toEqual([0, 0]);
  expect(invalidateMock).not.toHaveBeenCalled();
});

test('preserves duplicates, order, scaled text and empty optional fields', async () => {
  const items = [
    { name: ' 2× 米 1/2 cup ', quantity: 2, unit: '', category: '', notes: '' },
    { name: 'Rice' }, { name: 'Rice' },
  ];
  // Assignment limits checkoff, so the route intentionally never reads assignedTo.
  const response = await POST(request(payload(items)));
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.count).toBe(3);
  expect(body.items.map((i: { name: string }) => i.name)).toEqual(items.map(i => i.name));
  expect(body.items[0]).toMatchObject({ ...items[0], checked: false, recurring: false,
    recurrenceInterval: null, createdAt: createdAt.toISOString(), listId });
  expect(body.items[1]).toMatchObject({ quantity: null, unit: null, category: null, notes: null });
  expect(state.committedItems.every(item => item.addedBy === userId)).toBe(true);
  expect(state.committedAudits.map(audit => audit.entityId)).toEqual(body.items.map((i: { id: string }) => i.id));
  expect(state.events).toEqual(['auth', 'rate', 'begin', 'list', 'items', 'audit', 'commit', 'cache']);
  expect(state.queries.find(query => query.kind === 'list')!.sql).not.toContain('assigned_to');
});

test('preserves requested order even when the database returns rows in reverse', async () => {
  state.transformReturned = rows => rows.reverse();
  const response = await POST(request(payload([{ name: 'First' }, { name: 'Second' }])));
  expect(response.status).toBe(201);
  expect((await response.json()).items.map((i: { name: string }) => i.name)).toEqual(['First', 'Second']);
});

test.each(['select', 'item', 'audit', 'commit'] as const)('rolls back a rejected %s stage with no cache work', async stage => {
  state.failure = stage;
  const response = await POST(request(payload([{ name: 'Rice' }, { name: 'Beans' }])));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Failed to create shopping item batch' });
  expect(state.rollbacks).toBe(1);
  expect(state.commits).toBe(0);
  expect(committedCounts()).toEqual([0, 0]);
  expect(invalidateMock).not.toHaveBeenCalled();
});

test.each([
  ['too few rows', (rows: object[]) => rows.slice(0, 1)],
  ['too many rows', (rows: object[]) => [...rows, rows[0]!]],
  ['duplicate identities', (rows: object[]) => [rows[0]!, rows[0]!]],
  ['foreign identity', (rows: object[]) => [{ ...rows[0], id: otherId }, rows[1]!]],
  ['foreign list', (rows: object[]) => [{ ...rows[0], listId: otherId }, rows[1]!]],
  ['changed name', (rows: object[]) => [{ ...rows[0], name: 'Changed' }, rows[1]!]],
  ['changed quantity', (rows: object[]) => [{ ...rows[0], quantity: 7 }, rows[1]!]],
  ['changed unit', (rows: object[]) => [{ ...rows[0], unit: 'box' }, rows[1]!]],
  ['changed category', (rows: object[]) => [{ ...rows[0], category: 'frozen' }, rows[1]!]],
  ['changed notes', (rows: object[]) => [{ ...rows[0], notes: 'Changed' }, rows[1]!]],
  ['checked true', (rows: object[]) => [{ ...rows[0], checked: true }, rows[1]!]],
  ['recurring true', (rows: object[]) => [{ ...rows[0], recurring: true }, rows[1]!]],
  ['recurrence interval', (rows: object[]) => [{ ...rows[0], recurrenceInterval: 'weekly' }, rows[1]!]],
  ['invalid timestamp', (rows: object[]) => [{ ...rows[0], createdAt: new Date(NaN) }, rows[1]!]],
  ['unexpected private field', (rows: object[]) => [{ ...rows[0], sourceId: 'private' }, rows[1]!]],
] as const)('rolls back malformed RETURNING contract before audit: %s', async (_label, transform) => {
  state.transformReturned = transform;
  expect((await POST(request(payload([{ name: 'Rice' }, { name: 'Beans' }])))).status).toBe(500);
  expect(state.queries.map(q => q.kind)).toEqual(['list', 'items']);
  expect(state.rollbacks).toBe(1);
  expect(committedCounts()).toEqual([0, 0]);
  expect(invalidateMock).not.toHaveBeenCalled();
});

test('postcommit cache failure returns saved rows and a 201 warning without rollback', async () => {
  state.cacheError = true;
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(committedCounts()).toEqual([1, 1]);
  expect(state.commits).toBe(1);
  expect(state.rollbacks).toBe(0);
  expect(invalidateMock).toHaveBeenCalledTimes(1);
  const body = await response.json();
  expect(body.items[0].id).toBe(state.committedItems[0]!.id);
  expect(body.warnings).toEqual([{ code: 'CACHE_INVALIDATION_FAILED',
    message: 'Items were saved. Refresh the list. Do not resubmit this batch.' }]);
});

test('success contains only explicit public fields and one payload-free audit per item', async () => {
  const response = await POST(request(payload([{ name: 'Rice', notes: 'Synthetic note' }])));
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(['count', 'items']);
  expect(Object.keys(body.items[0]).sort()).toEqual([
    'category', 'checked', 'createdAt', 'id', 'listId', 'name', 'notes', 'quantity',
    'recurrenceInterval', 'recurring', 'unit',
  ]);
  expect(state.committedAudits).toEqual([{
    userId, action: 'create', entityType: 'shopping_item', entityId: body.items[0].id,
    summary: 'Added shopping item in batch',
  }]);
});

test('request replay creates distinct item identities and is explicitly not idempotent', async () => {
  const first = await (await POST(request())).json();
  const second = await (await POST(request())).json();
  expect(first.items[0].id).not.toBe(second.items[0].id);
  expect(committedCounts()).toEqual([2, 2]);
});

test('no existing application module was resolved or executed', () => {
  const appFiles = Object.keys(require.cache).filter(path => /\/src\/(lib|types)\//.test(path));
  expect(appFiles).toEqual([]);
});

test('canonicalizes uppercase UUIDs before comparison with PostgreSQL UUID values', async () => {
  const response = await POST(request({ ...payload([{ name: 'Rice 🍚' }]), listId: listId.toUpperCase() }));
  expect(response.status).toBe(201);
  expect((await response.json()).items[0].listId).toBe(listId);
  expect(state.queries[0]!.params[0]).toBe(listId);
});
