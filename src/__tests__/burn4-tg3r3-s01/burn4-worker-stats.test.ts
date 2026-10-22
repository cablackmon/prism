import { createHarness, deferred, fixedNow } from './burn4-worker-harness';

describe('collector aggregate dispatch with opaque authorization comparison', () => {
  test('an absent stats gate is unauthorized without touching D1', async () => {
    const h = createHarness();
    const response = await h.run(h.request('/stats', 'GET'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.origin).not.toHaveBeenCalled();
  });

  test('different opaque symbols are unauthorized without touching D1', async () => {
    const h = createHarness();
    h.mismatchStats();
    const response = await h.run(h.request('/stats', 'GET'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(h.prepare).not.toHaveBeenCalled();
  });

  test('maps all nine concurrent aggregates to response fields and preserves grouping SQL', async () => {
    const h = createHarness();
    h.authorizeStats();
    const counts = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
    const groups = [deferred<{ results: unknown }>(), deferred<{ results: unknown }>(), deferred<{ results: unknown }>(), deferred<{ results: unknown }>()];
    for (const count of counts) h.database.first.mockReturnValueOnce(count.promise);
    for (const group of groups) h.database.all.mockReturnValueOnce(group.promise);
    let finished = false;
    const pending = h.run(h.request('/stats', 'GET')).then((response) => { finished = true; return response; });
    expect(h.calls).toHaveLength(9);
    expect(h.calls.filter((call) => call.operation === 'first').map((call) => call.column)).toEqual(['n', 'n', 'n', 'n', 'n']);
    expect(h.calls.map((call) => call.sql.replace(/\s+/g, ' '))).toEqual([
      'SELECT COUNT(*) AS n FROM checkins',
      "SELECT COUNT(*) AS n FROM checkins WHERE last_seen >= datetime('now','-7 days')",
      "SELECT COUNT(*) AS n FROM checkins WHERE last_seen >= datetime('now','-30 days')",
      "SELECT COUNT(*) AS n FROM checkins WHERE first_seen >= datetime('now','-7 days')",
      "SELECT COUNT(*) AS n FROM checkins WHERE first_seen >= datetime('now','-30 days')",
      "SELECT version, COUNT(*) AS n FROM checkins WHERE last_seen >= datetime('now','-30 days') GROUP BY version ORDER BY n DESC",
      "SELECT deployment, COUNT(*) AS n FROM checkins WHERE last_seen >= datetime('now','-30 days') GROUP BY deployment ORDER BY n DESC",
      "SELECT COALESCE(arch,'unknown') AS arch, COUNT(*) AS n FROM checkins WHERE last_seen >= datetime('now','-30 days') GROUP BY COALESCE(arch,'unknown') ORDER BY n DESC",
      "SELECT strftime('%Y-%W', first_seen) AS week, COUNT(*) AS n FROM checkins GROUP BY week ORDER BY week",
    ]);
    const results = [
      [{ version: '1.0', n: 8 }], [{ deployment: 'ha', n: 7 }], [{ arch: 'unknown', n: 6 }], [{ week: '2026-11', n: 5 }],
    ];
    for (const [index, count] of counts.entries()) count.resolve(100 + index);
    for (let index = 0; index < groups.length - 1; index++) groups[index]?.resolve({ results: results[index] });
    await Promise.resolve();
    expect(finished).toBe(false);
    groups[3]?.resolve({ results: results[3] });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      totalInstalls: 100, activeInstalls7d: 101, activeInstalls30d: 102, newInstalls7d: 103, newInstalls30d: 104,
      byVersion: results[0], byDeployment: results[1], byArch: results[2], newInstallsByWeek: results[3], generatedAt: fixedNow,
    });
    expect(h.origin).not.toHaveBeenCalled();
    expect(h.cache.match).not.toHaveBeenCalled();
  });

  test('returns zero counts and empty groups for an empty database', async () => {
    const h = createHarness();
    h.authorizeStats();
    expect(await (await h.run(h.request('/stats', 'GET'))).json()).toEqual({
      totalInstalls: 0, activeInstalls7d: 0, activeInstalls30d: 0, newInstalls7d: 0, newInstalls30d: 0,
      byVersion: [], byDeployment: [], byArch: [], newInstallsByWeek: [], generatedAt: fixedNow,
    });
  });

  test.each(['first', 'all'])('propagates an aggregate %s rejection rather than reporting partial counts', async (phase) => {
    const h = createHarness();
    h.authorizeStats();
    const problem = new Error('fixture aggregate failure');
    if (phase === 'first') h.database.first.mockRejectedValueOnce(problem);
    else h.database.all.mockRejectedValueOnce(problem);
    await expect(h.run(h.request('/stats', 'GET'))).rejects.toBe(problem);
    expect(h.calls).toHaveLength(9);
    expect(h.origin).not.toHaveBeenCalled();
    expect(Object.values(h.logs).every((log) => log.mock.calls.length === 0)).toBe(true);
  });
});
