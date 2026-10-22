import { buildShoppingAttributionView } from '../../lib/burn4-shopping-attribution';
import { allFilters, snapshot } from './burn4-fixtures';

describe('list-scoped contributor projection', () => {
  it('keeps supplied row order and independent full/matched totals', () => {
    const view = buildShoppingAttributionView(snapshot(), allFilters);
    expect(view.rows.map(row => row.id)).toEqual(['milk', 'bread', 'rice', 'soap', 'tea']);
    expect(view.full).toEqual({ total: 5, checked: 2, open: 3 });
    expect(view.matched).toEqual(view.full);
    expect(view.unassigned).toEqual({ total: 2, checked: 1, open: 1 });
    expect(view.contributors.map(person => person.id)).toEqual(['all', 'unassigned', 'zero', 'former']);
  });

  it.each(['all', 'unassigned'])('treats reserved-looking identity %s as an exact member', memberId => {
    const view = buildShoppingAttributionView(snapshot(), { contributor: { kind: 'member', memberId }, checked: 'all' });
    expect(view.rows.map(row => row.id)).toEqual([memberId === 'all' ? 'milk' : 'bread']);
    expect(view.full.total).toBe(5);
  });

  it.each([
    ['all', 'open', ['milk', 'rice', 'tea']],
    ['all', 'checked', ['bread', 'soap']],
    ['unassigned', 'all', ['soap', 'tea']],
    ['unassigned', 'checked', ['soap']],
    ['unassigned', 'open', ['tea']],
  ])('intersects contributor %s and status %s', (kind, checked, expected) => {
    const view = buildShoppingAttributionView(snapshot(), { contributor: { kind }, checked });
    expect(view.rows.map(row => row.id)).toEqual(expected);
    expect(view.matched.total).toBe(expected.length);
    expect(view.full.checked).toBe(2);
  });

  it('does not conflate equal member names', () => {
    const view = buildShoppingAttributionView(snapshot(), allFilters);
    expect(view.contributors.slice(0, 2).map(person => [person.id, person.name, person.counts.total]))
      .toEqual([['all', 'Robin', 1], ['unassigned', 'Robin', 1]]);
  });

  it('uses the current roster label and retains supplied removed-roster attribution', () => {
    const current = buildShoppingAttributionView(snapshot(), allFilters);
    expect(current.rows[0]?.contributor).toEqual({ id: 'all', name: 'Robin', current: true });
    const input = snapshot();
    const removed = buildShoppingAttributionView({ ...input, members: [] }, allFilters);
    expect(removed.rows[0]?.contributor).toEqual({ id: 'all', name: 'Earlier Robin', current: false });
    expect(removed.rows[2]?.contributor?.name).toBe('Casey');
  });

  it('does not reconstruct NULL attribution from a roster or an earlier projection', () => {
    const input = snapshot();
    buildShoppingAttributionView(input, allFilters);
    const erased = buildShoppingAttributionView({ ...input, items: [{ ...input.items[0], addedBy: null }] }, allFilters);
    expect(erased.rows[0]?.contributor).toBeNull();
    expect(erased.unassigned.total).toBe(1);
  });

  it('distinguishes unavailable identity from missing identity and keeps stale filters explicit', () => {
    const input = snapshot();
    const view = buildShoppingAttributionView({ ...input, items: [
      { id: 'x', listId: 'groceries', name: 'Spice', checked: false, addedBy: { id: 'unknown' } },
      { id: 'y', listId: 'groceries', name: 'Salt', checked: false },
    ] }, { contributor: { kind: 'member', memberId: 'stale' }, checked: 'open' });
    expect(view.rows).toEqual([]);
    expect(view.unassigned.total).toBe(1);
    expect(view.contributors.find(person => person.id === 'unknown')).toMatchObject({ name: 'Unavailable member', current: false });
    expect(view.contributors.find(person => person.id === 'stale')).toMatchObject({ name: 'Unavailable member', counts: { total: 0 } });
  });

  it('counts members before status filtering and includes roster members with no items', () => {
    const view = buildShoppingAttributionView(snapshot(), { contributor: { kind: 'member', memberId: 'unassigned' }, checked: 'open' });
    expect(view.matched).toEqual({ total: 0, checked: 0, open: 0 });
    expect(view.contributors[1]?.counts).toEqual({ total: 1, checked: 1, open: 0 });
    expect(view.contributors[2]?.counts.total).toBe(0);
  });

  it('has honest zero counts for an empty or unrelated list', () => {
    const input = snapshot();
    const view = buildShoppingAttributionView({ ...input, list: { id: 'empty', name: 'Empty' } }, allFilters);
    expect(view.rows).toEqual([]);
    expect(view.full).toEqual({ total: 0, checked: 0, open: 0 });
    expect(view.contributors.map(person => person.id)).toEqual(['all', 'unassigned', 'zero']);
  });

  it('returns frozen allowlisted copies and never reads unknown metadata', () => {
    const input = snapshot();
    const item = Object.freeze({ ...input.items[0], get privateMetadata() { throw new Error('Should not be read'); } });
    const source = Object.freeze({ ...input, list: Object.freeze(input.list), members: Object.freeze(input.members), items: Object.freeze([item]) });
    const first = buildShoppingAttributionView(source, Object.freeze(allFilters));
    const second = buildShoppingAttributionView(source, allFilters);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.rows[0]).toEqual({ id: 'milk', name: 'Milk', checked: false, contributor: { id: 'all', name: 'Robin', current: true } });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.rows)).toBe(true);
    expect(Object.isFrozen(first.rows[0]?.contributor)).toBe(true);
    expect(Object.isFrozen(first.filters.contributor)).toBe(true);
    expect(input.items[0]?.name).toBe('Milk');
  });

  it('chooses the first supplied label consistently when an unavailable ID repeats', () => {
    const input = snapshot();
    const view = buildShoppingAttributionView({ ...input, items: [
      { id: 'a', listId: 'groceries', name: 'A', checked: false, addedBy: { id: 'former', name: 'First' } },
      { id: 'b', listId: 'groceries', name: 'B', checked: true, addedBy: { id: 'former', name: 'Later' } },
    ] }, allFilters);
    expect(view.rows.map(row => row.contributor?.name)).toEqual(['First', 'First']);
    expect(view.contributors.find(person => person.id === 'former')?.counts.total).toBe(2);
  });
});

describe('bounded generic validation', () => {
  const invalidSnapshots: readonly [string, () => unknown][] = [
    ['null', () => null],
    ['array', () => []],
    ['missing list', () => ({ items: [], members: [] })],
    ['blank list name', () => ({ ...snapshot(), list: { id: 'x', name: ' ' } })],
    ['long list name', () => ({ ...snapshot(), list: { id: 'x', name: 'a'.repeat(101) } })],
    ['nonarray items', () => ({ ...snapshot(), items: {} })],
    ['nonarray members', () => ({ ...snapshot(), members: null })],
    ['null item', () => ({ ...snapshot(), items: [null] })],
    ['duplicate item IDs across lists', () => ({ ...snapshot(), items: [snapshot().items[0], snapshot().items[0]] })],
    ['duplicate roster IDs', () => ({ ...snapshot(), members: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] })],
    ['blank identity', () => ({ ...snapshot(), members: [{ id: ' ', name: 'A' }] })],
    ['surrounding identity whitespace', () => ({ ...snapshot(), members: [{ id: ' a', name: 'A' }] })],
    ['long identity', () => ({ ...snapshot(), members: [{ id: 'a'.repeat(129), name: 'A' }] })],
    ['long member name', () => ({ ...snapshot(), members: [{ id: 'a', name: 'a'.repeat(101) }] })],
    ['blank item name', () => ({ ...snapshot(), items: [{ ...snapshot().items[0], name: '' }] })],
    ['long item name', () => ({ ...snapshot(), items: [{ ...snapshot().items[0], name: 'a'.repeat(256) }] })],
    ['truthy checked', () => ({ ...snapshot(), items: [{ ...snapshot().items[0], checked: 1 }] })],
    ['array contributor', () => ({ ...snapshot(), items: [{ ...snapshot().items[0], addedBy: [] }] })],
    ['missing contributor ID', () => ({ ...snapshot(), items: [{ ...snapshot().items[0], addedBy: { name: 'A' } }] })],
    ['null contributor name', () => ({ ...snapshot(), items: [{ ...snapshot().items[0], addedBy: { id: 'a', name: null } }] })],
    ['throwing known field', () => ({ ...snapshot(), get list() { throw new Error('caller diagnostic'); } })],
  ];
  it.each(invalidSnapshots)('rejects %s without echoing caller data', (_, input) => {
    expect(() => buildShoppingAttributionView(input(), allFilters)).toThrow('Invalid shopping attribution data.');
  });

  it.each([null, [], {}, { contributor: null, checked: 'all' }, { contributor: { kind: 'other' }, checked: 'all' },
    { contributor: { kind: 'member' }, checked: 'all' }, { contributor: { kind: 'all' }, checked: 'other' }])('rejects malformed filters %#', filters => {
    expect(() => buildShoppingAttributionView(snapshot(), filters)).toThrow('Invalid shopping attribution data.');
  });

  it('accepts exact string/count limits with a modest bounded fixture', () => {
    const input = {
      list: { id: 'a'.repeat(128), name: 'A'.repeat(100) },
      members: Array.from({ length: 256 }, (_, i) => ({ id: `m${i}`, name: 'A'.repeat(100) })),
      items: Array.from({ length: 2000 }, (_, i) => ({ id: `i${i}`, listId: 'a'.repeat(128), name: 'B'.repeat(255), checked: false })),
    };
    expect(buildShoppingAttributionView(input, allFilters).full.total).toBe(2000);
  });

  it.each(['items', 'members'])('rejects over-limit %s before visiting entries', key => {
    const value = new Array(key === 'items' ? 2001 : 257).fill(null);
    expect(() => buildShoppingAttributionView({ ...snapshot(), [key]: value }, allFilters)).toThrow('Invalid shopping attribution data.');
  });

  it('enforces an aggregate text budget even below row and string maxima', () => {
    const input = {
      ...snapshot(),
      items: Array.from({ length: 1700 }, (_, i) => ({
        id: `i${i}`.padEnd(128, 'i'), listId: 'groceries', name: 'A'.repeat(255), checked: false,
        addedBy: { id: `p${i}`.padEnd(128, 'p'), name: 'B'.repeat(100) },
      })),
    };
    expect(() => buildShoppingAttributionView(input, allFilters)).toThrow('Invalid shopping attribution data.');
  });
});
