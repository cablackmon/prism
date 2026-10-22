import { createHarness, deferred, fixedNow } from './burn4-worker-harness';

describe('collector field normalization and D1 upsert contract', () => {
  test('clamps id, version and architecture before binding and never interpolates input', async () => {
    const h = createHarness();
    const id = "'fixture-" + 'i'.repeat(70);
    const version = 'v'.repeat(40);
    const arch = 'a'.repeat(24);
    await h.run(h.request('/', 'POST', { id, version, arch, deployment: 'Render' }));
    const call = h.calls[0];
    expect(call?.bindings).toEqual([id.slice(0, 64), version.slice(0, 32), 'render', arch.slice(0, 16), fixedNow]);
    expect(call?.sql).not.toContain(id);
    expect(call?.sql).toMatch(/VALUES \(\?1, \?2, \?3, \?4, \?5, \?5\)/);
    expect(call?.sql).toMatch(/ON CONFLICT\(id\) DO UPDATE SET\s+version = \?2, deployment = \?3, arch = \?4, last_seen = \?5/);
    expect(call?.sql.split('DO UPDATE SET')[1]).not.toContain('first_seen');
  });

  test.each([
    ['HA', 'ha'], ['PikaPods', 'pikapods'], ['ReNDer !! / @ Site_2-x', 'rendersite_2-x'],
    ['!!!', 'docker'], ['', 'docker'], [undefined, 'docker'], [null, 'docker'], [false, 'docker'],
    ['a'.repeat(24), 'a'.repeat(16)],
  ])('normalizes deployment %p to %s', async (deployment, expected) => {
    const h = createHarness();
    await h.run(h.request('/', 'POST', { id: 'fixture-install', deployment }));
    expect(h.calls[0]?.bindings[2]).toBe(expected);
  });

  test.each([undefined, null, 4, false, {}, []])('replaces nonstring optional metadata %p with null', async (metadata) => {
    const h = createHarness();
    await h.run(h.request('/', 'POST', { id: 'fixture-install', version: metadata, arch: metadata }));
    expect(h.calls[0]?.bindings).toEqual(['fixture-install', null, 'docker', null, fixedNow]);
  });

  test('preserves empty optional strings and mixed-case architecture', async () => {
    const h = createHarness();
    await h.run(h.request('/', 'POST', { id: 'fixture-install', version: '', arch: 'ARM64' }));
    expect(h.calls[0]?.bindings).toEqual(['fixture-install', '', 'docker', 'ARM64', fixedNow]);
  });

  test('repeated id updates metadata and last_seen while preserving first_seen', async () => {
    const h = createHarness();
    await h.run(h.request('/', 'POST', { id: 'fixture-install', version: '1.0', deployment: 'ha' }));
    h.setNow('2026-03-25T12:34:56.000Z');
    await h.run(h.request('/', 'POST', { id: 'fixture-install', version: '2.0', deployment: 'render', arch: 'arm64' }));
    expect(h.rows.size).toBe(1);
    expect(h.rows.get('fixture-install')).toEqual({
      id: 'fixture-install', version: '2.0', deployment: 'render', arch: 'arm64',
      first_seen: fixedNow, last_seen: '2026-03-25T12:34:56.000Z',
    });
    expect(h.calls.every((call) => call.sql.includes('ON CONFLICT(id) DO UPDATE SET'))).toBe(true);
  });

  test('awaits the D1 write before reading edge cache or returning success', async () => {
    const h = createHarness();
    const write = deferred<unknown>();
    const writeStarted = deferred<void>();
    h.database.run.mockImplementationOnce(() => { writeStarted.resolve(undefined); return write.promise; });
    const pending = h.run();
    await writeStarted.promise;
    expect(h.database.run).toHaveBeenCalledTimes(1);
    expect(h.cache.match).not.toHaveBeenCalled();
    expect(h.origin).not.toHaveBeenCalled();
    write.resolve(undefined);
    expect(await (await pending).json()).toEqual({ ok: true, latestVersion: '1.20.0' });
  });

  test.each(['prepare', 'run'])('propagates D1 %s failure before attempting release lookup', async (phase) => {
    const h = createHarness();
    const problem = new Error(`fixture D1 ${phase} failure`);
    if (phase === 'prepare') h.prepare.mockImplementationOnce(() => { throw problem; });
    else h.database.run.mockRejectedValueOnce(problem);
    await expect(h.run()).rejects.toBe(problem);
    expect(h.rows.size).toBe(0);
    expect(h.cache.match).not.toHaveBeenCalled();
    expect(h.origin).not.toHaveBeenCalled();
    expect(Object.values(h.logs).every((log) => log.mock.calls.length === 0)).toBe(true);
  });

  test('concurrent writes for distinct ids persist independently after their own D1 completion', async () => {
    const h = createHarness();
    const firstWrite = deferred<unknown>();
    h.database.run.mockReturnValueOnce(firstWrite.promise);
    const first = h.run(h.request('/', 'POST', { id: 'fixture-one', version: '1.0' }));
    const second = await h.run(h.request('/', 'POST', { id: 'fixture-two', version: '2.0' }));
    expect(second.status).toBe(200);
    expect(h.rows.has('fixture-one')).toBe(false);
    expect(h.rows.get('fixture-two')?.version).toBe('2.0');
    firstWrite.resolve(undefined);
    expect((await first).status).toBe(200);
    expect([...h.rows.keys()].sort()).toEqual(['fixture-one', 'fixture-two']);
  });
});
