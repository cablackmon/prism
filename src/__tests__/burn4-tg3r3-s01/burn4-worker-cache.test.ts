import { createHarness, defaultReleaseUrl, deferred } from './burn4-worker-harness';

describe('collector release cache and failure boundaries', () => {
  test('uses a successful cached release without origin fetch or cache write', async () => {
    const h = createHarness();
    h.stored.set(defaultReleaseUrl, new Response(JSON.stringify({ tag_name: 'v7.8.9' })));
    expect(await (await h.run()).json()).toEqual({ ok: true, latestVersion: '7.8.9' });
    expect(h.cache.match.mock.calls[0]?.[0].url).toBe(defaultReleaseUrl);
    expect(h.origin).not.toHaveBeenCalled();
    expect(h.cache.put).not.toHaveBeenCalled();
  });

  test('caches a clone with a one-hour TTL and preserves the upstream response headers', async () => {
    const h = createHarness();
    h.origin.mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: 'v4.5.6' }), {
      headers: { 'x-fixture-release': 'metadata', 'cache-control': 'no-store' },
    }));
    const response = await h.run();
    expect(await response.json()).toEqual({ ok: true, latestVersion: '4.5.6' });
    const cached = h.stored.get(defaultReleaseUrl);
    expect(cached?.headers.get('cache-control')).toBe('max-age=3600');
    expect(cached?.headers.get('x-fixture-release')).toBe('metadata');
    expect(await cached?.clone().json()).toEqual({ tag_name: 'v4.5.6' });
    expect(h.cache.put.mock.calls[0]?.[0].url).toBe(defaultReleaseUrl);
    expect(await (await h.run(h.request('/', 'POST', { id: 'fixture-two' }))).json())
      .toEqual({ ok: true, latestVersion: '4.5.6' });
    expect(h.origin).toHaveBeenCalledTimes(1);
  });

  test('uses the configured repository as both origin URL and edge key', async () => {
    const h = createHarness();
    h.env.GITHUB_REPO = 'fixture-owner/fixture-repository';
    await h.run();
    const expected = 'https://api.github.com/repos/fixture-owner/fixture-repository/releases/latest';
    expect(h.origin.mock.calls[0]?.[0]).toBe(expected);
    expect(h.cache.match.mock.calls[0]?.[0].url).toBe(expected);
    expect([...h.stored.keys()]).toEqual([expected]);
  });

  test.each([404, 429, 500])('upstream status %i returns a successful check-in with null version and is not cached', async (status) => {
    const h = createHarness();
    h.origin.mockResolvedValueOnce(new Response('fixture unavailable', { status }));
    expect(await (await h.run()).json()).toEqual({ ok: true, latestVersion: null });
    expect(h.rows.size).toBe(1);
    expect(h.cache.put).not.toHaveBeenCalled();
  });

  test.each([
    ['version string without prefix', { tag_name: '2.3.4' }, '2.3.4'],
    ['only first lowercase v removed', { tag_name: 'vv2.3.4' }, 'v2.3.4'],
    ['uppercase prefix preserved', { tag_name: 'V2.3.4' }, 'V2.3.4'],
    ['empty tag preserved', { tag_name: '' }, ''],
    ['missing tag', {}, null], ['numeric tag', { tag_name: 12 }, null], ['null document', null, null],
  ])('handles %s', async (_description, document, expected) => {
    const h = createHarness();
    h.origin.mockResolvedValueOnce(new Response(JSON.stringify(document)));
    expect(await (await h.run()).json()).toEqual({ ok: true, latestVersion: expected });
    expect(h.rows.size).toBe(1);
  });

  test('malformed release JSON returns null after writing the accepted check-in', async () => {
    const h = createHarness();
    h.origin.mockResolvedValueOnce(new Response('{fixture malformed'));
    expect(await (await h.run()).json()).toEqual({ ok: true, latestVersion: null });
    expect(h.rows.size).toBe(1);
  });

  test.each([new Response('{fixture malformed'), new Response('fixture', { status: 503 })])('an unusable cache hit returns null without an origin call', async (response) => {
    const h = createHarness();
    h.stored.set(defaultReleaseUrl, response);
    expect(await (await h.run()).json()).toEqual({ ok: true, latestVersion: null });
    expect(h.origin).not.toHaveBeenCalled();
  });

  test('concurrent cache misses keep both response bodies readable and persist both check-ins', async () => {
    const h = createHarness();
    const firstOrigin = deferred<Response>();
    const secondOrigin = deferred<Response>();
    const bothStarted = deferred<void>();
    h.origin.mockImplementationOnce(() => firstOrigin.promise).mockImplementationOnce(() => {
      bothStarted.resolve(undefined);
      return secondOrigin.promise;
    });
    const first = h.run(h.request('/', 'POST', { id: 'fixture-one' }));
    const second = h.run(h.request('/', 'POST', { id: 'fixture-two' }));
    await bothStarted.promise;
    expect(h.rows.size).toBe(2);
    secondOrigin.resolve(new Response(JSON.stringify({ tag_name: 'v2.0.0' })));
    expect(await (await second).json()).toEqual({ ok: true, latestVersion: '2.0.0' });
    firstOrigin.resolve(new Response(JSON.stringify({ tag_name: 'v1.0.0' })));
    expect(await (await first).json()).toEqual({ ok: true, latestVersion: '1.0.0' });
    expect(h.cache.put).toHaveBeenCalledTimes(2);
    expect(await h.stored.get(defaultReleaseUrl)?.clone().json()).toEqual({ tag_name: 'v1.0.0' });
  });
});
