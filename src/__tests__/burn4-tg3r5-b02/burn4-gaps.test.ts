import { closeDashboards, history, loaded, sources } from './burn4-harness';

afterEach(closeDashboards);

describe.each(sources)('%s concrete referral defects', source => {
  it.failing('KNOWN GAP: current referrer names are parsed as HTML instead of displayed as text', async () => {
    const name = '<b data-burn4="current">search.example</b>';
    const page = await loaded(source, history({ referrers: [{ referrer: name, count: 2, uniques: 1 }] }));
    expect(page.errors).toEqual([]);
    expect(page.rows('referrersTable')).toHaveLength(1);
    const cell = page.document.querySelector('#referrersTable tbody td');
    expect(cell?.textContent).toBe(name);
    expect(cell?.querySelector('[data-burn4]')).toBeNull();
  });

  it.failing('KNOWN GAP: historical referrer names are parsed as HTML instead of displayed as text', async () => {
    const name = '<i data-burn4="historical">archive.example</i>';
    const page = await loaded(source, history({ referrer_history: {
      '2026-01-01': [{ referrer: name, count: 3, uniques: 2 }],
    } }));
    expect(page.errors).toEqual([]);
    expect(page.rows('newReferrersTable')).toHaveLength(1);
    const cell = page.document.querySelector('#newReferrersTable tbody td');
    expect(cell?.textContent).toBe(name);
    expect(cell?.querySelector('[data-burn4]')).toBeNull();
  });
});
