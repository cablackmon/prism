import { createHarness, deferred, id, otherId, reply, textReply } from './burn4-mcp-harness';
import type { Reply } from './burn4-mcp-harness';

test.each([
  { label: 'object', data: { value: 1, nested: { ok: true } }, structured: { value: 1, nested: { ok: true } } },
  { label: 'array', data: [{ id: 'synthetic' }, 3], structured: { items: [{ id: 'synthetic' }, 3] } },
  { label: 'empty array', data: [], structured: { items: [] } },
  { label: 'null', data: null, structured: { value: null } },
  { label: 'number', data: 42, structured: { value: 42 } },
  { label: 'boolean', data: false, structured: { value: false } },
  { label: 'string', data: 'hello', structured: { value: 'hello' } },
])('serializes $label as both legacy content and structured output', async ({ data, structured }) => {
  const h = createHarness();
  h.queue(reply(data));
  const output = await h.call('list_family');
  expect(output.structuredContent).toEqual(structured);
  expect(output.content).toEqual([{ type: 'text', text: JSON.stringify(data, null, 2) }]);
});

test.each(['service ready', '{broken', '', '   '])('preserves non-JSON response text %j', async text => {
  const h = createHarness();
  h.queue(textReply(text));
  const output = await h.call('get_weather');
  expect(output.structuredContent).toEqual({ value: text });
  expect(output.content[0]!.text).toBe(JSON.stringify(text));
});

test('accepts an empty successful DELETE response', async () => {
  const h = createHarness();
  h.queue(textReply('', true, 204));
  const output = await h.call('delete_task', { id });
  expect(output.structuredContent).toEqual({ value: '' });
  expect(h.requests[0]!.body).toBeUndefined();
});

test.each([
  { name: 'list_family', args: {}, method: 'GET', path: '/api/family' },
  { name: 'create_task', args: { title: 'Read' }, method: 'POST', path: '/api/tasks' },
  { name: 'update_task', args: { id, completed: true }, method: 'PUT', path: `/api/tasks/${id}` },
  { name: 'delete_task', args: { id }, method: 'DELETE', path: `/api/tasks/${id}` },
])('reports HTTP failures for $method with status, route and public response text', async ({ name, args, method, path }) => {
  const h = createHarness();
  h.queue(textReply('fixture rejected', false, 503));
  await expect(h.call(name, args)).rejects.toThrow(`Prism API ${method} ${path} → 503: fixture rejected`);
  expect(h.requests).toHaveLength(1);
});

test('preserves an HTTP error JSON body in the thrown message', async () => {
  const h = createHarness();
  h.queue(reply({ error: 'fixture validation' }, false, 422));
  await expect(h.call('list_family')).rejects.toThrow('422: {"error":"fixture validation"}');
});

test('does not retry a rejected transport and remains usable afterward', async () => {
  const h = createHarness();
  h.queue(new Error('fixture transport unavailable'), reply({ recovered: true }));
  await expect(h.call('list_family')).rejects.toThrow('fixture transport unavailable');
  expect(h.requests).toHaveLength(1);
  expect((await h.call('list_family')).structuredContent).toEqual({ recovered: true });
  expect(h.requests).toHaveLength(2);
});

test('propagates response stream read rejection', async () => {
  const h = createHarness();
  h.queue({ ok: true, status: 200, text: async () => { throw new Error('fixture body read failed'); } });
  await expect(h.call('list_family')).rejects.toThrow('fixture body read failed');
  expect(h.requests).toHaveLength(1);
});

test('concurrent updates retain separate routing IDs, bodies and reversed response order', async () => {
  const first = deferred<Reply>();
  const second = deferred<Reply>();
  const bothStarted = deferred<void>();
  let started = 0;
  const h = createHarness({ fetchReply: () => {
    started += 1;
    if (started === 2) bothStarted.resolve(undefined);
    return started === 1 ? first.promise : second.promise;
  } });
  const firstCall = h.call('update_task', { id, title: 'first' });
  const secondCall = h.call('update_task', { id: otherId, title: 'second' });
  await bothStarted.promise;
  expect(h.requests.map(r => [r.url, JSON.parse(r.body!)])).toEqual([
    [`https://offline.invalid/api/tasks/${id}`, { title: 'first' }],
    [`https://offline.invalid/api/tasks/${otherId}`, { title: 'second' }],
  ]);
  second.resolve(reply({ order: 2 }));
  expect((await secondCall).structuredContent).toEqual({ order: 2 });
  first.resolve(reply({ order: 1 }));
  expect((await firstCall).structuredContent).toEqual({ order: 1 });
});

test('one concurrent rejection does not replace a successful result', async () => {
  const failed = deferred<Reply>();
  const successful = deferred<Reply>();
  const h = createHarness();
  h.queue(failed.promise, successful.promise);
  const rejected = h.call('list_family');
  const resolved = h.call('get_points');
  const assertion = expect(rejected).rejects.toThrow('fixture isolated failure');
  failed.reject(new Error('fixture isolated failure'));
  successful.resolve(reply({ points: 7 }));
  await assertion;
  expect((await resolved).structuredContent).toEqual({ points: 7 });
  expect(h.requests.map(r => new URL(r.url).pathname)).toEqual(['/api/family', '/api/points']);
});

test('separate VM instances retain their own base URLs and request queues', async () => {
  const a = createHarness({ baseUrl: 'https://one.invalid/root/' });
  const b = createHarness({ baseUrl: 'https://two.invalid/' });
  a.queue(reply({ instance: 1 }));
  b.queue(reply({ instance: 2 }));
  const [first, second] = await Promise.all([a.call('list_family'), b.call('list_family')]);
  expect(first.structuredContent).toEqual({ instance: 1 });
  expect(second.structuredContent).toEqual({ instance: 2 });
  expect(a.requests[0]!.url).toBe('https://one.invalid/root/api/family');
  expect(b.requests[0]!.url).toBe('https://two.invalid/api/family');
});

test.each([
  { baseUrl: null },
  { baseUrl: '' },
  { authenticated: false },
  { baseUrl: null, authenticated: false },
])('missing required synthetic configuration exits before constructing a server: %j', async options => {
  const h = createHarness(options);
  await expect(h.ready).rejects.toThrow('Fixture exit 1');
  expect(h.stderr).toEqual(['Error: PRISM_BASE_URL and PRISM_API_TOKEN environment variables are required.\n']);
  expect(h.identities).toHaveLength(0);
  expect(h.tools.size).toBe(0);
  expect(h.stats()).toEqual({ connections: 0, transportCreations: 0 });
  expect(h.requests).toHaveLength(0);
});

test('propagates a fake stdio connection failure without sending HTTP requests', async () => {
  const h = createHarness({ connectError: new Error('fixture stdio failed') });
  await expect(h.ready).rejects.toThrow('fixture stdio failed');
  expect(h.stats()).toEqual({ connections: 1, transportCreations: 1 });
  expect(h.requests).toHaveLength(0);
});
