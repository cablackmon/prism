import { closeDashboards, dashboard, deferred, history, loaded, reply, sources, type Reply } from './burn4-harness';

afterEach(closeDashboards);

describe.each(sources)('%s loading and boundaries', source => {
  it('initializes immediately with one remote request and a visible loading status', async () => {
    const pending = deferred<Reply>();
    const page = dashboard(source, [() => pending.promise]);
    expect(page.fetchCalls).toEqual([{
      url: 'https://raw.githubusercontent.com/sandydargoport/prism/traffic-data/traffic/history.json',
      options: { cache: 'no-store' },
    }]);
    expect(page.text('updated')).toBe('Fetching traffic data…');
    expect(page.charts).toEqual([]);
    pending.resolve(reply(history()));
    await page.initial;
    expect(page.errors).toEqual([]);
    expect(page.fetchCalls).toHaveLength(1);
  });

  it('does not expose process, require, network constructors or timer execution to source', async () => {
    const page = await loaded(source);
    for (const name of ['process', 'require', 'XMLHttpRequest', 'WebSocket']) expect(page.runtimeHas(name)).toBe(false);
    expect(page.charts).toHaveLength(1);
    expect(page.fetchCalls).toHaveLength(1);
  });

  it.each([
    { label: 'network rejection', remote: new Error('offline') },
    { label: 'remote 404', remote: reply({}, { ok: false, status: 404 }) },
    { label: 'remote 503', remote: reply({}, { ok: false, status: 503 }) },
  ])('falls back to local history after $label', async ({ remote }) => {
    const page = dashboard(source, [remote, reply(history())]);
    await page.initial;
    expect(page.fetchCalls[1]).toEqual({ url: 'history.json' });
    expect(page.text('totalViews')).toBe('25');
    expect(page.charts).toHaveLength(1);
    expect(page.errors).toEqual([]);
    if (!(remote instanceof Error)) expect(remote.json).not.toHaveBeenCalled();
  });

  it('shows a distinct fallback status while the local request remains pending', async () => {
    const pending = deferred<Reply>();
    const entered = deferred<void>();
    const page = dashboard(source, [new Error('offline'), () => { entered.resolve(undefined); return pending.promise; }]);
    await entered.promise;
    expect(page.text('updated')).toBe('Remote fetch failed, trying local copy…');
    expect(page.fetchCalls).toHaveLength(2);
    pending.resolve(reply(history()));
    await page.initial;
    expect(page.text('updated')).toBe('Updated 2026-01-03T12:00:00.000Z');
  });

  it.each([
    { label: 'local rejection', local: new Error('local offline'), message: 'local offline' },
    { label: 'local string rejection', local: () => Promise.reject('plain failure'), message: 'plain failure' },
    { label: 'local HTTP error', local: reply({}, { ok: false, status: 500 }), message: 'local fetch 500' },
  ])('reports and logs $label after both locations fail', async ({ local, message }) => {
    const page = dashboard(source, [new Error('remote offline'), local]);
    await page.initial;
    expect(page.text('updated')).toBe(`Failed to load: Could not load history.json: ${message}`);
    expect(page.errors).toHaveLength(1);
    expect(page.errors[0]?.[0]).toBe('[traffic page]');
    expect(page.charts).toEqual([]);
  });

  it('reports remote JSON parse failures without silently consuming another response', async () => {
    const remote = reply(undefined, { jsonError: new SyntaxError('invalid remote JSON') });
    const page = dashboard(source, [remote, reply(history())]);
    await page.initial;
    expect(page.text('updated')).toBe('Failed to load: invalid remote JSON');
    expect(page.fetchCalls).toHaveLength(1);
    expect(remote.json).toHaveBeenCalledTimes(1);
    expect(page.charts).toEqual([]);
  });

  it('reports a local JSON parse failure after fetch fallback', async () => {
    const page = dashboard(source, [new Error('remote down'), reply(undefined, { jsonError: new SyntaxError('invalid local JSON') })]);
    await page.initial;
    expect(page.text('updated')).toBe('Failed to load: invalid local JSON');
    expect(page.fetchCalls).toHaveLength(2);
    expect(page.errors).toHaveLength(1);
  });

  it('reports a string JSON rejection through the final failure fallback', async () => {
    const page = dashboard(source, [reply(undefined, { jsonError: 'parse unavailable' })]);
    await page.initial;
    expect(page.text('updated')).toBe('Failed to load: parse unavailable');
    expect(page.errors[0]?.[1]).toBe('parse unavailable');
  });

  it.each([
    { label: 'null archive', data: null },
    { label: 'missing views', data: { updated_at: '2026-01-01' } },
    { label: 'null views', data: { views: null } },
    { label: 'null view row', data: history({ views: { '2026-01-01': null } as unknown as ReturnType<typeof history>['views'] }) },
  ])('surfaces $label before constructing a chart', async ({ data }) => {
    const page = await loaded(source, data);
    expect(page.text('updated')).toMatch(/^Failed to load:/);
    expect(page.errors).toHaveLength(1);
    expect(page.charts).toEqual([]);
    expect(page.fetchCalls).toHaveLength(1);
  });

  it.each([
    { label: 'non-array current referrals', data: history({ referrers: {} as never }) },
    { label: 'non-iterable historical referrals', data: history({ referrer_history: { '2026-01-01': {} as never } }) },
  ])('reports $label after chart construction', async ({ data }) => {
    const page = await loaded(source, data);
    expect(page.text('updated')).toMatch(/^Failed to load:/);
    expect(page.errors).toHaveLength(1);
    expect(page.charts).toHaveLength(1);
  });

  it('reports a chart dependency failure after totals, before referral rendering', async () => {
    const chartError = new Error('chart unavailable');
    const page = dashboard(source, [reply(history())], { chartError });
    await page.initial;
    expect(page.text('updated')).toBe('Failed to load: chart unavailable');
    expect(page.text('totalViews')).toBe('25');
    expect(page.rows('referrersTable')).toEqual([]);
    expect(page.errors[0]?.[1]).toBe(chartError);
  });

  it('sets status as literal text without creating markup', async () => {
    const page = await loaded(source);
    page.setStatus('<b>status</b>');
    expect(page.text('updated')).toBe('<b>status</b>');
    expect(page.document.querySelector('#updated b')).toBeNull();
  });

  it('ignores status updates when the status element is absent', async () => {
    const page = dashboard(source, [new Error('remote'), new Error('local')], { removeStatus: true });
    expect(() => page.setStatus('pending')).not.toThrow();
    await expect(page.initial).resolves.toBeUndefined();
    expect(page.errors).toHaveLength(1);
    expect(page.text('updated')).toBeNull();
  });

  it('can invoke main again with a new response and new totals', async () => {
    const page = dashboard(source, [reply(history()), reply(history({ views: {} }))]);
    await page.initial;
    await page.reload();
    expect(page.fetchCalls).toHaveLength(2);
    expect(page.text('totalViews')).toBe('0');
    expect(page.charts).toHaveLength(2);
  });

  it('isolates concurrent full-page reloads that complete in reverse order', async () => {
    const first = deferred<Reply>();
    const second = deferred<Reply>();
    const a = dashboard(source, [() => first.promise]);
    const b = dashboard(source, [() => second.promise]);
    second.resolve(reply(history({ views: {} })));
    await b.initial;
    expect(b.text('totalViews')).toBe('0');
    expect(a.text('updated')).toBe('Fetching traffic data…');
    first.resolve(reply(history()));
    await a.initial;
    expect(a.text('totalViews')).toBe('25');
    expect(b.text('totalViews')).toBe('0');
    expect(a.charts).toHaveLength(1);
    expect(b.charts).toHaveLength(1);
    expect(a.document).not.toBe(b.document);
  });

  it('keeps a failed concurrent page independent from a successful page', async () => {
    const failed = dashboard(source, [new Error('remote down'), new Error('local down')]);
    const good = dashboard(source, [reply(history())]);
    await Promise.all([failed.initial, good.initial]);
    expect(failed.charts).toEqual([]);
    expect(failed.errors).toHaveLength(1);
    expect(good.charts).toHaveLength(1);
    expect(good.errors).toEqual([]);
    expect(good.text('updated')).toBe('Updated 2026-01-03T12:00:00.000Z');
  });

  it('allows concurrent main calls to settle without sharing queued response objects', async () => {
    const a = deferred<Reply>();
    const b = deferred<Reply>();
    const page = dashboard(source, [() => a.promise, () => b.promise]);
    const second = page.reload();
    b.resolve(reply(history({ views: {} })));
    await second;
    expect(page.text('totalViews')).toBe('0');
    a.resolve(reply(history()));
    await page.initial;
    expect(page.text('totalViews')).toBe('25');
    expect(page.fetchCalls).toHaveLength(2);
    expect(page.charts).toHaveLength(2);
    expect(page.errors).toEqual([]);
  });
});
