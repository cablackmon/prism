import { closeDashboards, history, loaded, sources } from './burn4-harness';

const dash = String.fromCodePoint(0x2014);
afterEach(closeDashboards);

describe.each(sources)('%s presentation', source => {
  it('aggregates view and visitor days separately from clones', async () => {
    const page = await loaded(source);
    expect(page.text('totalViews')).toBe('25');
    expect(page.text('totalUniques')).toBe('7');
    expect(page.text('totalClones')).toBe('5');
    expect(page.text('daysTracked')).toBe('2');
    expect(page.text('updated')).toBe('Updated 2026-01-03T12:00:00.000Z');
  });

  it('formats large totals using the runtime number locale', async () => {
    const page = await loaded(source, history({
      views: { '2026-01-01': { count: 1234567, uniques: 1234 } },
      clones: { '2026-01-01': { count: 9876, uniques: 1 } },
    }));
    expect(page.text('totalViews')).toBe((1234567).toLocaleString());
    expect(page.text('totalUniques')).toBe((1234).toLocaleString());
    expect(page.text('totalClones')).toBe((9876).toLocaleString());
  });

  it('renders a fresh empty archive with zero totals and empty chart', async () => {
    const page = await loaded(source, history({ views: {}, clones: {}, referrers: [] }));
    for (const id of ['totalViews', 'totalUniques', 'totalClones', 'daysTracked']) {
      expect(page.text(id)).toBe('0');
    }
    expect(page.charts[0]?.config.data.labels).toEqual([]);
    expect(page.charts[0]?.config.data.datasets.map(d => d.data)).toEqual([[], [], []]);
    expect(page.text('cumUniqueEstimate')).toBe(dash);
    expect(page.rows('referrersTable')).toEqual([['No referrer data yet']]);
    expect(page.document.getElementById('newReferrersWrap')?.style.display).toBe('none');
    expect(page.errors).toEqual([]);
  });

  it('accepts legacy archives without optional clone or referral fields', async () => {
    const page = await loaded(source, {
      views: { '2026-01-01': { count: 2, uniques: 1 } },
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect(page.text('totalClones')).toBe('0');
    expect(page.text('cumUniqueEstimate')).toBe(dash);
    expect(page.rows('referrersTable')).toEqual([['No referrer data yet']]);
    expect(page.errors).toEqual([]);
  });

  it('treats explicit null optional archive sections as absent', async () => {
    const page = await loaded(source, history({ clones: null as never, referrers: null as never, referrer_history: null as never, window_uniques: null as never }));
    expect(page.text('totalClones')).toBe('0');
    expect(page.text('cumUniqueEstimate')).toBe(dash);
    expect(page.rows('referrersTable')).toEqual([['No referrer data yet']]);
    expect(page.errors).toEqual([]);
  });

  it('renders invalid update timestamps without aborting the remaining content', async () => {
    const page = await loaded(source, history({ updated_at: 'invalid' }));
    expect(page.text('updated')).toBe('Updated Invalid Date');
    expect(page.charts).toHaveLength(1);
    expect(page.errors).toEqual([]);
  });

  it('sorts cross-year and leap-day chart dates while retaining paired values', async () => {
    const page = await loaded(source, history({ views: {
      '2025-01-01': { count: 5, uniques: 4 },
      '2024-12-31': { count: 3, uniques: 2 },
      '2024-02-29': { count: 1, uniques: 1 },
    } }));
    expect(page.charts[0]?.config.data.labels).toEqual(['2024-02-29', '2024-12-31', '2025-01-01']);
    expect(page.charts[0]?.config.data.datasets.map(d => d.data)).toEqual([[1, 3, 5], [1, 2, 4], [null, null, null]]);
  });

  it('constructs one chart on the real canvas with mixed dataset presentation', async () => {
    const page = await loaded(source);
    expect(page.charts).toHaveLength(1);
    const chart = page.charts[0];
    expect(chart?.canvas).toBe(page.document.getElementById('viewsChart'));
    expect(chart?.config.type).toBe('bar');
    expect(chart?.config.data.datasets.map(d => d.label)).toEqual([
      'Total Views', 'Unique Visitors', 'New This Period (14d window Δ)',
    ]);
    expect(chart?.config.data.datasets[2]).toMatchObject({ type: 'line', spanGaps: false });
    expect(chart?.config.options).toMatchObject({ responsive: true, scales: { y: { beginAtZero: true } } });
  });

  it.each<{ name: string; windows: Record<string, number | null>; expected: string }>([
    { name: 'one snapshot', windows: { '2026-01-01': 12 }, expected: '~12' },
    { name: 'zero snapshot', windows: { '2026-01-01': 0 }, expected: '~0' },
    { name: 'null snapshot', windows: { '2026-01-01': null }, expected: '~0' },
    { name: 'thirteen days excluded', windows: { '2026-01-01': 12, '2026-01-14': 20 }, expected: '~12' },
    { name: 'exact fourteen days included', windows: { '2026-01-01': 12, '2026-01-15': 20 }, expected: '~32' },
    { name: 'long gap included', windows: { '2026-01-01': 12, '2026-03-01': 20 }, expected: '~32' },
    { name: 'out-of-order independent anchors', windows: { '2026-01-29': 30, '2026-01-02': 99, '2026-01-15': 20, '2026-01-01': 12, '2026-01-28': 99 }, expected: '~62' },
    { name: 'leap-year fourteen-day interval', windows: { '2024-02-20': 12, '2024-03-05': 20 }, expected: '~32' },
    { name: 'year boundary', windows: { '2025-12-25': 12, '2026-01-08': 20 }, expected: '~32' },
  ])('computes disjoint windows: $name', async ({ windows, expected }) => {
    const page = await loaded(source, history({ window_uniques: windows }));
    expect(page.text('cumUniqueEstimate')).toBe(expected);
  });

  it('uses the previous available window, leaves missing days null and clamps decreases', async () => {
    const views = Object.fromEntries(['01', '02', '03', '04', '05', '06'].map(day => [
      `2026-01-${day}`, { count: 1, uniques: 1 },
    ]));
    const page = await loaded(source, history({
      views,
      window_uniques: { '2026-01-06': 8, '2026-01-04': 7, '2026-01-01': 5, '2026-01-03': 9, '2026-01-05': 7 },
    }));
    expect(page.charts[0]?.config.data.datasets[2]?.data).toEqual([null, null, 4, 0, 0, 1]);
  });

  it('calculates deltas against a snapshot outside the displayed view dates', async () => {
    const page = await loaded(source, history({
      views: { '2026-01-03': { count: 8, uniques: 4 } },
      window_uniques: { '2026-01-01': 5, '2026-01-03': 9 },
    }));
    expect(page.charts[0]?.config.data.datasets[2]?.data).toEqual([4]);
  });

  it('renders current referrals in input order with badge counts', async () => {
    const page = await loaded(source, history({ referrers: [
      { referrer: 'one.example', count: 10, uniques: 6 },
      { referrer: 'two.example', count: 0, uniques: 0 },
    ] }));
    expect(page.rows('referrersTable')).toEqual([['one.example', '10', '6'], ['two.example', '0', '0']]);
    expect([...page.document.querySelectorAll('#referrersTable .badge')].map(el => el.textContent)).toEqual(['10', '0']);
  });

  it('keeps latest referrals independent from first-time discovery history', async () => {
    const page = await loaded(source, history({
      referrers: [{ referrer: 'current.example', count: 9, uniques: 2 }],
      referrer_history: { '2026-01-01': [{ referrer: 'archived.example', count: 3, uniques: 1 }] },
    }));
    expect(page.rows('referrersTable')[0]?.[0]).toBe('current.example');
    expect(page.rows('newReferrersTable')).toEqual([['archived.example', '2026-01-01', '3']]);
    expect(page.document.getElementById('newReferrersWrap')?.style.display).toBe('');
  });

  it('deduplicates historical sources chronologically and preserves first-day counts', async () => {
    const page = await loaded(source, history({ referrer_history: {
      '2026-01-03': [{ referrer: 'repeat.example', count: 99, uniques: 9 }, { referrer: 'new.example', count: 7, uniques: 4 }],
      '2026-01-01': [{ referrer: 'repeat.example', count: 2, uniques: 1 }],
      '2026-01-02': [{ referrer: 'middle.example', count: 5, uniques: 2 }, { referrer: 'repeat.example', count: 10, uniques: 3 }],
    } }));
    expect(page.rows('newReferrersTable')).toEqual([
      ['new.example', '2026-01-03', '7'], ['middle.example', '2026-01-02', '5'], ['repeat.example', '2026-01-01', '2'],
    ]);
  });

  it('deduplicates repeated sources within a day and reverses equal-day discovery order', async () => {
    const page = await loaded(source, history({ referrer_history: { '2026-01-01': [
      { referrer: 'first.example', count: 2, uniques: 1 },
      { referrer: 'first.example', count: 100, uniques: 50 },
      { referrer: 'second.example', count: 3, uniques: 2 },
    ] } }));
    expect(page.rows('newReferrersTable')).toEqual([['second.example', '2026-01-01', '3'], ['first.example', '2026-01-01', '2']]);
  });

  it('treats null and empty historical snapshots as no new sources', async () => {
    const page = await loaded(source, history({ referrer_history: { '2026-01-01': null, '2026-01-02': [] } }));
    expect(page.rows('newReferrersTable')).toEqual([]);
    expect(page.document.getElementById('newReferrersWrap')?.style.display).toBe('none');
    expect(page.errors).toEqual([]);
  });

  it('does not alter the synthetic archive while sorting and discovering sources', async () => {
    const data = history({ window_uniques: { '2026-01-15': 5, '2026-01-01': 3 }, referrer_history: {
      '2026-01-01': [{ referrer: 'stable.example', count: 3, uniques: 1 }],
    } });
    const before = JSON.stringify(data);
    await loaded(source, data);
    expect(JSON.stringify(data)).toBe(before);
  });
});
