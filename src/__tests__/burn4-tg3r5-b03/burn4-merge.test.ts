import { archive, merge, mergeSource } from './burn4-harness';

const day = (timestamp: string, count: number, uniques: number) => ({ timestamp, count, uniques });

describe('unchanged traffic history merge', () => {
  test('extracts the executable heredoc rather than a copied implementation', () => {
    expect(mergeSource).toMatch(/^import json, os, sys\n/);
    expect(mergeSource).toContain("def load(path, default):");
    expect(mergeSource).toContain("def load_api(path):");
    expect(mergeSource).not.toContain('PYEOF');
  });

  test('creates a first archive when every endpoint is empty', () => {
    const result = merge();
    expect(result.error).toBeNull();
    expect(result.history).toEqual({ views: {}, clones: {}, referrers: [], referrer_history: {}, window_uniques: {}, updated_at: '2026-10-22T02:00:00Z' });
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('Days tracked: 0  |  Total views: 0  |  Total unique: 0\n');
    expect(result.events).toContainEqual(['makedirs', 'traffic', true]);
    expect(result.clockCalls).toBe(2);
  });

  test('merges views and clones independently and captures rolling uniques', () => {
    const result = merge({
      views: { count: 99, uniques: 12, views: [day('2026-10-21T00:00:00Z', 16, 7)] },
      clones: { count: 17, uniques: 8, clones: [day('2026-10-20T00:00:00Z', 3, 2)] },
    });
    expect(result.error).toBeNull();
    expect(result.history?.views).toEqual({ '2026-10-21': { count: 16, uniques: 7 } });
    expect(result.history?.clones).toEqual({ '2026-10-20': { count: 3, uniques: 2 } });
    expect(result.history?.window_uniques).toEqual({ '2026-10-22': 12 });
    expect(result.stdout).toContain('Total views: 16  |  Total unique: 7');
  });

  test.each(['views', 'clones'] as const)('%s updates overlap while retaining old days and the other series', series => {
    const previous = archive();
    const result = merge({ history: previous, [series]: { [series]: [day('2020-01-01T13:59:59Z', 20, 6), day('2026-10-20T00:00:00Z', 8, 5)] } });
    expect(result.error).toBeNull();
    expect(result.history?.[series]).toEqual({ '2020-01-01': { count: 20, uniques: 6 }, '2026-10-20': { count: 8, uniques: 5 } });
    expect(result.history?.[series === 'views' ? 'clones' : 'views']).toEqual(previous[series === 'views' ? 'clones' : 'views']);
  });

  test.each(['views', 'clones'] as const)('%s duplicates collapse by calendar date with last incoming value winning', series => {
    const result = merge({ [series]: { [series]: [day('2026-10-21T00:00:00Z', 1, 1), day('2026-10-21T21:00:00Z', 9, 4)] } });
    expect(result.error).toBeNull();
    expect(result.history?.[series]).toEqual({ '2026-10-21': { count: 9, uniques: 4 } });
  });

  test('retains archive entries well outside the current 14-day API window', () => {
    const previous = archive();
    const result = merge({ history: previous, views: { views: [day('2026-10-22T00:00:00Z', 2, 1)] } });
    expect(result.history?.views['2020-01-01']).toEqual(previous.views['2020-01-01']);
    expect(result.history?.clones).toEqual(previous.clones);
    expect(result.history?.window_uniques).toEqual(previous.window_uniques);
    expect(result.history?.referrer_history).toEqual(previous.referrer_history);
  });

  test('legacy archives gain only the missing history maps without losing unknown metadata', () => {
    const result = merge({ history: { views: {}, clones: {}, referrers: [], note: 'synthetic archive metadata' } });
    expect(result.error).toBeNull();
    expect(result.history).toMatchObject({ views: {}, clones: {}, referrers: [], window_uniques: {}, referrer_history: {}, note: 'synthetic archive metadata' });
  });

  test.each([0, 1, 83])('stores rolling-window uniques including %i without substituting daily totals', uniques => {
    const result = merge({ history: archive(), views: { uniques, views: [day('2026-10-21T00:00:00Z', 8, 6)] } });
    expect(result.history?.window_uniques).toEqual({ '2020-01-01': 3, '2026-10-22': uniques });
    expect(result.stdout).toContain('Total unique: 9');
  });

  test('a newer same-day rolling snapshot replaces the earlier one', () => {
    const first = merge({ views: { uniques: 8 } });
    const second = merge({ history: first.history, views: { uniques: 11 } });
    expect(second.history?.window_uniques).toEqual({ '2026-10-22': 11 });
  });

  test('missing top-level uniques retains an existing same-day snapshot', () => {
    const result = merge({ history: archive({ window_uniques: { '2026-10-22': 9 } }), views: { views: [] } });
    expect(result.history?.window_uniques).toEqual({ '2026-10-22': 9 });
  });

  test('writes daily maps in sorted order regardless of archive/API insertion order', () => {
    const result = merge({
      history: archive({ views: { '2026-10-20': { count: 1, uniques: 1 }, '2020-01-01': { count: 2, uniques: 1 } } }),
      views: { views: [day('2026-10-22T00:00:00Z', 3, 2), day('2026-10-19T00:00:00Z', 4, 2)] },
    });
    expect(Object.keys(result.history?.views ?? {})).toEqual(['2020-01-01', '2026-10-19', '2026-10-20', '2026-10-22']);
    expect(result.historyText).toMatch(/^\{\n  "clones": \{/);
    expect(result.historyText).toContain('\n    "2026-10-19": {\n      "count": 4,\n      "uniques": 2\n    }');
  });

  test('uses UTC for the capture day and updated timestamp', () => {
    const result = merge({ ticks: ['2026-10-21T23:30:00-05:00'], views: { uniques: 4 } });
    expect(result.history?.window_uniques).toEqual({ '2026-10-22': 4 });
    expect(result.history?.updated_at).toBe('2026-10-22T04:30:00Z');
  });

  test('records each clock call independently when a merge crosses UTC midnight', () => {
    const result = merge({ ticks: ['2026-10-21T23:59:59+00:00', '2026-10-22T00:00:00+00:00'], views: { uniques: 4 } });
    expect(result.history?.window_uniques).toEqual({ '2026-10-21': 4 });
    expect(result.history?.updated_at).toBe('2026-10-22T00:00:00Z');
  });

  test('successive days retain previous snapshots and do not double-count overlapping daily data', () => {
    const first = merge({ views: { uniques: 5, views: [day('2026-10-21T00:00:00Z', 10, 5)] } });
    const second = merge({ history: first.history, ticks: ['2026-10-23T02:00:00+00:00'], views: { uniques: 7, views: [day('2026-10-21T00:00:00Z', 10, 5), day('2026-10-22T00:00:00Z', 8, 4)] } });
    expect(second.history?.window_uniques).toEqual({ '2026-10-22': 5, '2026-10-23': 7 });
    expect(second.stdout).toBe('Days tracked: 2  |  Total views: 18  |  Total unique: 9\n');
  });

  test('preserves zero-valued daily rows', () => {
    const result = merge({ views: { views: [day('2026-10-21T00:00:00Z', 0, 0)] }, clones: { clones: [day('2026-10-21T00:00:00Z', 0, 0)] } });
    expect(result.history?.views['2026-10-21']).toEqual({ count: 0, uniques: 0 });
    expect(result.history?.clones['2026-10-21']).toEqual({ count: 0, uniques: 0 });
  });

  test('keeps a literal timestamp date prefix rather than converting per-day timezones', () => {
    const result = merge({ views: { views: [day('2026-10-21T23:30:00-05:00', 1, 1)] } });
    expect(result.history?.views).toEqual({ '2026-10-21': { count: 1, uniques: 1 } });
  });
});

describe('referrer retention and serialization', () => {
  const list = [{ referrer: 'example.test', count: 12, uniques: 7 }, { referrer: 'Unicode 雪 and "quotes"', count: 3, uniques: 2 }];

  test('stores the latest list and adds the current-day snapshot without dropping old days', () => {
    const result = merge({ history: archive(), referrers: list });
    expect(result.error).toBeNull();
    expect(result.history?.referrers).toEqual(list);
    expect(result.history?.referrer_history).toEqual({ '2020-01-01': archive().referrers, '2026-10-22': list });
  });

  test('replaces the complete same-day list on a subsequent successful fetch', () => {
    const first = merge({ referrers: list });
    const next = [{ referrer: 'replacement.test', count: 2, uniques: 1 }];
    const second = merge({ history: first.history, referrers: next });
    expect(second.history?.referrers).toEqual(next);
    expect(second.history?.referrer_history).toEqual({ '2026-10-22': next });
  });

  test('a legitimate empty list clears the current table but keeps good historical snapshots', () => {
    const previous = archive({ referrer_history: { '2026-10-22': list } });
    const result = merge({ history: previous, referrers: [] });
    expect(result.history?.referrers).toEqual([]);
    expect(result.history?.referrer_history).toEqual(previous.referrer_history);
  });

  test.each([{}, null, false, 7, 'not a list'])('non-list referrers %p do not enter the historical map', referrers => {
    const previous = archive();
    const result = merge({ history: previous, referrers });
    expect(result.error).toBeNull();
    expect(result.history?.referrer_history).toEqual(previous.referrer_history);
  });

  test('preserves referrer ordering and numeric fields without recomputing API counts', () => {
    const result = merge({ referrers: list });
    expect(result.history?.referrers).toEqual(list);
    expect(result.history?.referrer_history['2026-10-22']).toEqual(list);
    expect(JSON.parse(result.historyText ?? '{}').referrers).toEqual(list);
  });
});
