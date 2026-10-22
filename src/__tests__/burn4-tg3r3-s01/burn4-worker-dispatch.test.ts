import { createHarness } from './burn4-worker-harness';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

function assertCors(response: Response) {
  for (const [name, value] of Object.entries(cors)) expect(response.headers.get(name)).toBe(value);
  expect(response.headers.has('set-cookie')).toBe(false);
}

describe('collector dispatch and privacy boundaries', () => {
  test.each(['/', '/stats', '/health', '/missing'])('OPTIONS %s is a body-free preflight', async (path) => {
    const h = createHarness();
    const request = h.request(path, 'OPTIONS');
    const response = await h.run(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    assertCors(response);
    expect(request.json).not.toHaveBeenCalled();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.origin).not.toHaveBeenCalled();
  });

  test.each(['GET', 'POST', 'DELETE'])('%s /health returns ok without reading a request body', async (method) => {
    const h = createHarness();
    const request = h.request('/health', method);
    const response = await h.run(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    assertCors(response);
    expect(request.json).not.toHaveBeenCalled();
    expect(h.prepare).not.toHaveBeenCalled();
  });

  test.each([
    ['GET', '/'], ['PUT', '/v1/checkin'], ['POST', '/stats'], ['GET', '/missing'], ['POST', '/v1/checkin/'],
  ])('%s %s returns a CORS JSON 404 without side effects', async (method, path) => {
    const h = createHarness();
    const response = await h.run(h.request(path, method));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ error: 'not found' });
    assertCors(response);
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.origin).not.toHaveBeenCalled();
  });

  test.each(['/', '/v1/checkin'])('POST %s records a check-in and returns the release', async (path) => {
    const h = createHarness();
    const response = await h.run(h.request(path));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, latestVersion: '1.20.0' });
    assertCors(response);
    expect(h.rows.size).toBe(1);
  });

  test('rejects malformed JSON before any DB or cache access', async () => {
    const h = createHarness();
    const request = h.request();
    request.json = jest.fn(async () => { throw new SyntaxError('fixture malformed JSON'); });
    const response = await h.run(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid json' });
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.cache.match).not.toHaveBeenCalled();
    assertCors(response);
  });

  test.each([{}, [], false, 7, 'fixture', { id: '' }, { id: 0 }, { id: null }])('rejects a missing nonempty string id in %p', async (body) => {
    const h = createHarness();
    const response = await h.run(h.request('/', 'POST', body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing id' });
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.origin).not.toHaveBeenCalled();
    assertCors(response);
  });

  test('drops extra fields and never reads client address, headers, cookies or logs', async () => {
    const h = createHarness();
    const response = await h.run(h.request('/', 'POST', {
      id: 'fixture-install', version: '1.2.3', deployment: 'ha', arch: 'arm64',
      address: 'ignored synthetic field', usage: ['ignored'], arbitrary: { nested: true },
    }));
    expect(response.status).toBe(200);
    expect(h.calls[0]?.bindings).toEqual(['fixture-install', '1.2.3', 'ha', 'arm64', '2026-03-18T12:34:56.000Z']);
    expect(h.calls[0]?.sql).toMatch(/INSERT INTO checkins \(id, version, deployment, arch, first_seen, last_seen\)/);
    expect(h.calls[0]?.sql).not.toMatch(/address|cookie|usage|arbitrary|\bip\b/i);
    expect(Object.values(h.logs).every((log) => log.mock.calls.length === 0)).toBe(true);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(h.origin.mock.calls[0]?.[1]).toEqual({
      headers: { 'User-Agent': 'prism-telemetry-collector', Accept: 'application/vnd.github+json' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
  });
});
