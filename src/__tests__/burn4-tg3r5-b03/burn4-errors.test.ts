import { archive, merge } from './burn4-harness';

const update = { timestamp: '2026-10-21T00:00:00Z', count: 6, uniques: 2 };

describe('endpoint failures are isolated', () => {
  test.each(['views', 'clones'] as const)('missing %s input warns and preserves its archive while another endpoint merges', endpoint => {
    const other = endpoint === 'views' ? 'clones' : 'views';
    const previous = archive();
    const result = merge({ history: previous, missing: [endpoint], [other]: { [other]: [update] } });
    expect(result.error).toBeNull();
    expect(result.history?.[endpoint]).toEqual(previous[endpoint]);
    expect(result.history?.[other]['2026-10-21']).toEqual({ count: 6, uniques: 2 });
    expect(result.stderr).toContain(`Warning: could not parse /tmp/${endpoint}.json:`);
  });

  test.each(['views', 'clones', 'referrers'] as const)('malformed %s JSON produces one warning without losing valid daily archives', endpoint => {
    const previous = archive();
    const result = merge({ history: previous, raw: { [endpoint]: '{broken json' } });
    expect(result.error).toBeNull();
    expect(result.stderr.match(/Warning: could not parse/g)).toHaveLength(1);
    expect(result.history?.views).toEqual(previous.views);
    expect(result.history?.clones).toEqual(previous.clones);
    expect(result.history?.referrer_history).toEqual(previous.referrer_history);
  });

  test.each(['views', 'clones', 'referrers'] as const)('a %s read failure is caught at the API boundary', endpoint => {
    const result = merge({ history: archive(), faults: { read: [`/tmp/${endpoint}.json`] } });
    expect(result.error).toBeNull();
    expect(result.stderr).toContain(`Warning: could not parse /tmp/${endpoint}.json: synthetic read failure`);
  });

  test('three unavailable endpoint files retain all archived time series and emit three warnings', () => {
    const previous = archive();
    const result = merge({ history: previous, missing: ['views', 'clones', 'referrers'] });
    expect(result.error).toBeNull();
    expect(result.stderr.match(/Warning: could not parse/g)).toHaveLength(3);
    expect(result.history?.views).toEqual(previous.views);
    expect(result.history?.clones).toEqual(previous.clones);
    expect(result.history?.window_uniques).toEqual(previous.window_uniques);
    expect(result.history?.referrer_history).toEqual(previous.referrer_history);
  });

  test.each(['views', 'clones'] as const)('an empty object/error response for %s retains history', endpoint => {
    const previous = archive();
    const result = merge({ history: previous, [endpoint]: { message: 'synthetic endpoint unavailable' } });
    expect(result.error).toBeNull();
    expect(result.history?.[endpoint]).toEqual(previous[endpoint]);
  });
});

describe('invalid archives and daily rows fail before writing', () => {
  test('malformed archive JSON reports failure and remains byte-identical', () => {
    const raw = '{synthetic invalid archive';
    const result = merge({ raw: { history: raw } });
    expect(result.error?.type).toBe('JSONDecodeError');
    expect(result.historyText).toBe(raw);
    expect(result.events).not.toContainEqual(['open', 'traffic/history.json', 'w']);
    expect(result.stdout).toBe('');
  });

  test.each([null, [], 7, 'archive'])('invalid archive root %p fails without replacing the file', history => {
    const result = merge({ history });
    expect(result.error?.type).toBe('AttributeError');
    expect(result.historyText).toBe(JSON.stringify(history));
    expect(result.events).not.toContainEqual(['open', 'traffic/history.json', 'w']);
  });

  test('archive read failure remains fatal without being mislabeled as an API warning', () => {
    const previous = archive();
    const result = merge({ history: previous, faults: { read: ['traffic/history.json'] } });
    expect(result.error).toEqual({ type: 'OSError', message: 'synthetic read failure' });
    expect(result.stderr).toBe('');
    expect(result.history).toEqual(previous);
  });

  test.each(['views', 'clones'] as const)('a legacy archive missing required %s map fails without replacement', series => {
    const previous: Record<string, unknown> = archive();
    delete previous[series];
    const result = merge({ history: previous, [series]: { [series]: [update] } });
    expect(result.error?.type).toBe('KeyError');
    expect(result.history).toEqual(previous);
    expect(result.events).not.toContainEqual(['open', 'traffic/history.json', 'w']);
  });

  test.each(['views', 'clones'] as const)('%s required row fields are validated by execution before file writes', series => {
    for (const field of ['timestamp', 'count', 'uniques']) {
      const row: Record<string, unknown> = { ...update };
      delete row[field];
      const previous = archive();
      const result = merge({ history: previous, [series]: { [series]: [row] } });
      expect(result.error?.type).toBe('KeyError');
      expect(result.history).toEqual(previous);
      expect(result.events).not.toContainEqual(['open', 'traffic/history.json', 'w']);
    }
  });

  test.each(['views', 'clones'] as const)('%s invalid row shape fails safely before persistence', series => {
    for (const row of [null, false, 7, { ...update, timestamp: null }]) {
      const previous = archive();
      const result = merge({ history: previous, [series]: { [series]: [row] } });
      expect(result.error?.type).toBe('TypeError');
      expect(result.history).toEqual(previous);
      expect(result.events).not.toContainEqual(['open', 'traffic/history.json', 'w']);
    }
  });

  test('directory creation failure retains the old archive and suppresses success summary', () => {
    const previous = archive();
    const result = merge({ history: previous, faults: { mkdir: true } });
    expect(result.error).toEqual({ type: 'OSError', message: 'synthetic directory failure' });
    expect(result.history).toEqual(previous);
    expect(result.stdout).toBe('');
  });

  test('an output-open error retains the old archive and suppresses success summary', () => {
    const previous = archive();
    const result = merge({ history: previous, faults: { open_write: true } });
    expect(result.error).toEqual({ type: 'OSError', message: 'synthetic open failure' });
    expect(result.history).toEqual(previous);
    expect(result.stdout).toBe('');
  });
});
