/** @jest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { getMobileLayout, useMobileLayout } from '@/lib/hooks/useMobileLayout';
import { loadHiddenCards, saveHiddenCards, useMobileCardOrder } from '@/components/dashboard/useMobileCardOrder';

const layoutKey = 'prism-mobile-layout';
const orderKey = 'prism-mobile-card-order';
const hiddenKey = 'prism-mobile-hidden-cards';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

describe('mobile layout preference lifecycle', () => {
  test('defaults to rows and persists both transitions across unmount and remount', () => {
    const first = renderHook(() => useMobileLayout());
    expect(first.result.current.layout).toBe('rows');
    expect(getMobileLayout()).toBe('rows');
    act(() => { first.result.current.setLayout('tiles'); });
    expect(first.result.current.layout).toBe('tiles');
    expect(localStorage.getItem(layoutKey)).toBe('tiles');
    expect(getMobileLayout()).toBe('tiles');
    first.unmount();
    const second = renderHook(() => useMobileLayout());
    expect(second.result.current.layout).toBe('tiles');
    act(() => { second.result.current.setLayout('rows'); });
    expect(second.result.current.layout).toBe('rows');
    expect(getMobileLayout()).toBe('rows');
    expect(localStorage.getItem(layoutKey)).toBe('rows');
  });

  test.each(['TILES', 'invalid', 'true', ''])('falls back to rows for the unsupported stored value %j', (value) => {
    localStorage.setItem(layoutKey, value);
    const { result } = renderHook(() => useMobileLayout());
    expect(result.current.layout).toBe('rows');
    expect(getMobileLayout()).toBe('rows');
  });

  test('keeps the chosen layout after an unrelated rerender', () => {
    const { result, rerender } = renderHook(() => useMobileLayout());
    const setter = result.current.setLayout;
    act(() => { result.current.setLayout('tiles'); });
    localStorage.setItem(layoutKey, 'rows');
    rerender();
    expect(result.current.layout).toBe('tiles');
    expect(result.current.setLayout).toBe(setter);
    expect(getMobileLayout()).toBe('rows');
  });

  test.failing('KNOWN GAP: the standalone mobile-layout getter throws when browser storage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    let observed: unknown;
    try { observed = getMobileLayout(); } catch (error) { observed = error; }
    expect(observed).toBe('rows');
  });
});

describe('mobile card order migration and saves', () => {
  test('keeps known stored ordering, drops retired cards, and appends newly introduced defaults once', () => {
    const baseline = renderHook(() => useMobileCardOrder());
    const defaults = [...baseline.result.current.order];
    baseline.unmount();
    localStorage.setItem(orderKey, JSON.stringify(['tasks', 'retired-card', 'weather']));
    const { result } = renderHook(() => useMobileCardOrder());
    expect(result.current.order.slice(0, 2)).toEqual(['tasks', 'weather']);
    expect(result.current.order).not.toContain('retired-card');
    expect(new Set(result.current.order)).toEqual(new Set(defaults));
    expect(result.current.order).toHaveLength(defaults.length);
    expect(result.current.order.indexOf('calendar')).toBeGreaterThan(1);
    expect(localStorage.getItem(orderKey)).toBe(JSON.stringify(['tasks', 'retired-card', 'weather']));
  });

  test.each(['{broken', '{}', 'null', '"weather"'])('recovers from an unusable stored order %s', (stored) => {
    const baseline = renderHook(() => useMobileCardOrder());
    const defaults = [...baseline.result.current.order];
    baseline.unmount();
    localStorage.setItem(orderKey, stored);
    const { result } = renderHook(() => useMobileCardOrder());
    expect(result.current.order).toEqual(defaults);
  });

  test('recovers the default order when storage reads throw', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    const { result } = renderHook(() => useMobileCardOrder());
    expect(result.current.order).toEqual(expect.arrayContaining(['weather', 'calendar', 'tasks']));
    expect(new Set(result.current.order).size).toBe(result.current.order.length);
  });

  test('saves a user reorder without mutating the supplied array and restores it on remount', () => {
    const first = renderHook(() => useMobileCardOrder());
    const reorder = [...first.result.current.order].reverse();
    const supplied = [...reorder];
    act(() => { first.result.current.setOrder(reorder); });
    expect(first.result.current.order).toEqual(supplied);
    expect(reorder).toEqual(supplied);
    expect(localStorage.getItem(orderKey)).toBe(JSON.stringify(supplied));
    first.unmount();
    const second = renderHook(() => useMobileCardOrder());
    expect(second.result.current.order).toEqual(supplied);
  });

  test.failing('KNOWN GAP: a stored duplicate card is retained during mobile-order migration', () => {
    localStorage.setItem(orderKey, JSON.stringify(['tasks', 'tasks', 'weather']));
    const { result } = renderHook(() => useMobileCardOrder());
    expect(result.current.order.slice(0, 1)).toEqual(['tasks']);
    expect(result.current.order.filter((id) => id === 'tasks')).toHaveLength(1);
  });
});

describe('hidden mobile card storage', () => {
  test('round-trips a changed hidden-card list and an explicit empty list without mutating inputs', () => {
    const hidden = ['weather', 'calendar'];
    saveHiddenCards(hidden);
    expect(hidden).toEqual(['weather', 'calendar']);
    expect(localStorage.getItem(hiddenKey)).toBe(JSON.stringify(hidden));
    expect(loadHiddenCards()).toEqual(hidden);
    const loaded = loadHiddenCards();
    loaded.push('tasks');
    expect(loadHiddenCards()).toEqual(hidden);
    saveHiddenCards([]);
    expect(loadHiddenCards()).toEqual([]);
    expect(localStorage.getItem(hiddenKey)).toBe('[]');
  });

  test('uses default hidden cards for missing, corrupt, and inaccessible storage', () => {
    const defaults = [...loadHiddenCards()];
    expect(defaults).toContain('clock');
    expect(defaults).toContain('photos');
    localStorage.setItem(hiddenKey, 'broken json');
    expect(loadHiddenCards()).toEqual(defaults);
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    expect(loadHiddenCards()).toEqual(defaults);
  });

  test.failing('KNOWN GAP: non-array JSON hidden-card preferences bypass the default fallback', () => {
    const defaults = [...loadHiddenCards()];
    localStorage.setItem(hiddenKey, JSON.stringify({ weather: true }));
    expect(loadHiddenCards()).toEqual(defaults);
  });

  test.failing('KNOWN GAP: mutating the default hidden-card result corrupts later independent loads', () => {
    const first = loadHiddenCards();
    const original = [...first];
    try {
      first.push('calendar');
      expect(loadHiddenCards()).toEqual(original);
    } finally {
      first.splice(0, first.length, ...original);
    }
  });
});
