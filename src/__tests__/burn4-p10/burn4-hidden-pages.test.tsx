/** @jest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { useHiddenPages } from '@/lib/hooks/useHiddenPages';
import { ALL_NAV_ITEMS } from '@/lib/constants/navItems';
import { deferred, response, settle } from './burn4-harness';

const cacheKey = 'prism:hidden-pages';
const originalFetch = globalThis.fetch;
let fetchMock: jest.MockedFunction<typeof fetch>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = jest.fn().mockResolvedValue(response({ settings: {} }));
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe('hidden page reads and navigation filters', () => {
  test('uses cached choices before the server settles, then replaces and persists them', async () => {
    localStorage.setItem(cacheKey, JSON.stringify(['/calendar']));
    const read = deferred<Response>();
    fetchMock.mockReturnValueOnce(read.promise);
    const { result } = renderHook(() => useHiddenPages());
    expect(result.current.hiddenPages).toEqual(['/calendar']);
    expect(result.current.loaded).toBe(false);
    expect(result.current.isPageHidden('/calendar')).toBe(true);
    await act(async () => {
      read.resolve(response({ settings: { hiddenPages: ['/photos', '/tasks'] } }));
    });
    expect(result.current.hiddenPages).toEqual(['/photos', '/tasks']);
    expect(result.current.loaded).toBe(true);
    expect(result.current.isPageHidden('/calendar')).toBe(false);
    expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(['/photos', '/tasks']));
    expect(fetchMock).toHaveBeenCalledWith('/api/settings');
  });

  test('falls back to no hidden pages when cache JSON is corrupt', async () => {
    localStorage.setItem(cacheKey, '[broken JSON');
    const { result } = renderHook(() => useHiddenPages());
    expect(result.current.hiddenPages).toEqual([]);
    await settle();
    expect(result.current.loaded).toBe(true);
    expect(result.current.filterNavItems(ALL_NAV_ITEMS)).toEqual(ALL_NAV_ITEMS);
  });

  test('continues loading server settings when local cache reads are unavailable', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    fetchMock.mockResolvedValueOnce(response({ settings: { hiddenPages: ['/recipes'] } }));
    const { result } = renderHook(() => useHiddenPages());
    await settle();
    expect(result.current).toMatchObject({ loaded: true, hiddenPages: ['/recipes'] });
    expect(result.current.isPageHidden('/recipes')).toBe(true);
  });

  test.each([
    ['missing settings', {}],
    ['missing hiddenPages', { settings: {} }],
    ['non-array hiddenPages', { settings: { hiddenPages: { '/tasks': true } } }],
  ])('preserves cached choices for %s', async (_case, body) => {
    localStorage.setItem(cacheKey, JSON.stringify(['/tasks']));
    fetchMock.mockResolvedValueOnce(response(body));
    const { result } = renderHook(() => useHiddenPages());
    await settle();
    expect(result.current).toMatchObject({ hiddenPages: ['/tasks'], loaded: true });
    expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(['/tasks']));
  });

  test.each(['http', 'network', 'json'])('settles loaded and preserves the cache on a %s failure', async (failure) => {
    localStorage.setItem(cacheKey, JSON.stringify(['/shopping']));
    if (failure === 'http') fetchMock.mockResolvedValueOnce(response({}, false));
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline read'));
    if (failure === 'json') fetchMock.mockResolvedValueOnce({
      ok: true, json: jest.fn().mockRejectedValue(new SyntaxError('invalid settings JSON')),
    } as unknown as Response);
    const { result } = renderHook(() => useHiddenPages());
    await settle();
    expect(result.current).toMatchObject({ hiddenPages: ['/shopping'], loaded: true });
    expect(result.current.isPageHidden('/shopping')).toBe(true);
  });

  test('keeps dashboard and settings visible, preserves input ordering and objects, and does not mutate inputs', async () => {
    fetchMock.mockResolvedValueOnce(response({ settings: { hiddenPages: ['/', '/settings', '/tasks'] } }));
    const { result } = renderHook(() => useHiddenPages());
    await settle();
    const items = [...ALL_NAV_ITEMS];
    const before = [...items];
    const visible = result.current.filterNavItems(items);
    expect(visible.map((item) => item.href)).toEqual(items.filter((item) => item.href !== '/tasks').map((item) => item.href));
    expect(result.current.isPageHidden('/')).toBe(false);
    expect(result.current.isPageHidden('/settings')).toBe(false);
    expect(result.current.isPageHidden('/tasks')).toBe(true);
    expect(result.current.isPageHidden('/unknown')).toBe(false);
    expect(visible[0]).toBe(items[0]);
    expect(items).toEqual(before);
    expect(result.current.hiddenPages).toEqual(['/', '/settings', '/tasks']);
  });

  test.failing('KNOWN GAP: valid JSON cache values that are not arrays bypass the cache fallback', async () => {
    localStorage.setItem(cacheKey, JSON.stringify('/calendar'));
    const { result } = renderHook(() => useHiddenPages());
    await settle();
    expect(result.current.hiddenPages).toEqual([]);
  });
});

describe('hidden page writes and races', () => {
  test('updates navigation and cache immediately, then writes the exact settings payload', async () => {
    const { result } = renderHook(() => useHiddenPages());
    await settle();
    const write = deferred<Response>();
    fetchMock.mockReturnValueOnce(write.promise);
    let completion!: Promise<void>;
    act(() => { completion = result.current.setHiddenPages(['/meals', '/photos']); });
    expect(result.current.hiddenPages).toEqual(['/meals', '/photos']);
    expect(result.current.isPageHidden('/meals')).toBe(true);
    expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(['/meals', '/photos']));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'hiddenPages', value: ['/meals', '/photos'] }),
    });
    await act(async () => { write.resolve(response({})); await completion; });
  });

  test('retains an optimistic offline preference and permits removing all hidden pages', async () => {
    const { result } = renderHook(() => useHiddenPages());
    await settle();
    fetchMock.mockRejectedValueOnce(new Error('offline patch'));
    await act(async () => { await result.current.setHiddenPages(['/tasks']); });
    expect(result.current.isPageHidden('/tasks')).toBe(true);
    expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(['/tasks']));
    await act(async () => { await result.current.setHiddenPages([]); });
    expect(result.current.filterNavItems(ALL_NAV_ITEMS)).toEqual(ALL_NAV_ITEMS);
    expect(localStorage.getItem(cacheKey)).toBe('[]');
  });

  test('a later mount reads the latest cached choice while its settings fetch is pending', async () => {
    const first = renderHook(() => useHiddenPages());
    await settle();
    await act(async () => { await first.result.current.setHiddenPages(['/travel']); });
    fetchMock.mockReturnValueOnce(deferred<Response>().promise);
    const second = renderHook(() => useHiddenPages());
    expect(second.result.current.isPageHidden('/travel')).toBe(true);
    expect(second.result.current.loaded).toBe(false);
  });

  test.failing('KNOWN GAP: an initial settings response overwrites a newer local hidden-page choice', async () => {
    const oldRead = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldRead.promise);
    const { result } = renderHook(() => useHiddenPages());
    await act(async () => { await result.current.setHiddenPages(['/tasks']); });
    expect(result.current.isPageHidden('/tasks')).toBe(true);
    await act(async () => { oldRead.resolve(response({ settings: { hiddenPages: [] } })); });
    expect(result.current.isPageHidden('/tasks')).toBe(true);
    expect(localStorage.getItem(cacheKey)).toBe(JSON.stringify(['/tasks']));
  });

  test.failing('KNOWN GAP: a cache write failure prevents saving hidden pages to the server', async () => {
    const { result } = renderHook(() => useHiddenPages());
    await settle();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage full'); });
    fetchMock.mockClear();
    let failure: unknown;
    await act(async () => {
      try { await result.current.setHiddenPages(['/tasks']); } catch (error) { failure = error; }
    });
    expect(result.current.isPageHidden('/tasks')).toBe(true);
    expect({ failure, writes: fetchMock.mock.calls }).toEqual({
      failure: undefined,
      writes: [['/api/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'hiddenPages', value: ['/tasks'] }),
      }]],
    });
  });

  test.failing('KNOWN GAP: mounted navigation consumers do not receive changes from the settings consumer', async () => {
    const settings = renderHook(() => useHiddenPages());
    const navigation = renderHook(() => useHiddenPages());
    await settle();
    await act(async () => { await settings.result.current.setHiddenPages(['/tasks']); });
    expect(settings.result.current.isPageHidden('/tasks')).toBe(true);
    expect(navigation.result.current.isPageHidden('/tasks')).toBe(true);
  });
});
