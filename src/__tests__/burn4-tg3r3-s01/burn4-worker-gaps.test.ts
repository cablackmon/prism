import { createHarness } from './burn4-worker-harness';

/** Intended assertions stay uninverted. Lane-local probes remove only .failing. */
describe('collector KNOWN GAP regressions', () => {
  test.failing('KNOWN GAP: JSON null crashes check-in validation instead of returning 400', async () => {
    const h = createHarness();
    const response = await h.run(h.request('/', 'POST', null)).catch((error: unknown) => {
      if (typeof error !== 'object' || error === null || !('message' in error)
        || error.message !== "Cannot read properties of null (reading 'id')") throw error;
      return undefined;
    });
    expect(response?.status).toBe(400);
  });

  test.failing('KNOWN GAP: edge cache read failure rejects an already recorded check-in', async () => {
    const h = createHarness();
    const problem = new Error('fixture cache read failure');
    h.cache.match.mockRejectedValueOnce(problem);
    const response = await h.run().catch((error: unknown) => { if (error !== problem) throw error; return undefined; });
    expect(await response?.json()).toEqual({ ok: true, latestVersion: null });
  });

  test.failing('KNOWN GAP: release fetch rejection rejects an already recorded check-in', async () => {
    const h = createHarness();
    const problem = new Error('fixture origin unavailable');
    h.origin.mockRejectedValueOnce(problem);
    const response = await h.run().catch((error: unknown) => { if (error !== problem) throw error; return undefined; });
    expect(await response?.json()).toEqual({ ok: true, latestVersion: null });
  });

  test.failing('KNOWN GAP: cache write failure discards a successfully fetched release and check-in response', async () => {
    const h = createHarness();
    const problem = new Error('fixture cache write failure');
    h.cache.put.mockRejectedValueOnce(problem);
    const response = await h.run().catch((error: unknown) => { if (error !== problem) throw error; return undefined; });
    expect(await response?.json()).toEqual({ ok: true, latestVersion: '1.20.0' });
  });
});
