/** @jest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { useLocationSearch, type LocationCandidate } from '@/lib/hooks/useLocationSearch';
import { deferred, installFetch, response } from './burn4-browser-fakes';

const first: LocationCandidate = { displayName: 'Synthetic City, AA', lat: 12.5, lon: -45.25 };
const second: LocationCandidate = { displayName: 'Synthetic Harbor, BB', lat: -2.75, lon: 9.5 };
let fetchMock: jest.Mock;
let restoreFetch: () => void;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-21T13:30:00.000Z'));
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings' && !init) return response({ settings: {} });
    throw new Error(`Unexpected offline request: ${url}`);
  });
  restoreFetch = installFetch(fetchMock);
});
afterEach(() => {
  cleanup();
  restoreFetch();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function mount() {
  const hook = renderHook(() => useLocationSearch());
  await act(async () => {});
  return hook;
}

async function search(hook: Awaited<ReturnType<typeof mount>>, query: string) {
  act(() => hook.result.current.setQuery(query));
  await act(async () => { jest.advanceTimersByTime(350); });
}

describe('location initialization and legacy migration', () => {
  test('empty settings start with idle public state and no automatic writes', async () => {
    const { result } = await mount();
    expect(result.current).toMatchObject({
      query: '', savedName: null, candidates: [], searching: false, saving: false,
    });
    expect(fetchMock.mock.calls).toEqual([['/api/settings']]);
  });

  test.each([
    [{ displayName: 'Modern location', zipCode: '00000', city: 'Legacy city' }, 'Modern location'],
    [{ zipCode: '00000', city: 'Legacy city', state: 'AA' }, '00000'],
    [{ city: 'Legacy city', state: 'AA' }, 'Legacy city, AA'],
    [{ city: 'Legacy city' }, 'Legacy city'],
    [{ state: 'AA' }, 'AA'],
    [{}, null],
  ])('saved location %j loads as %j without rewriting settings', async (location, expected) => {
    fetchMock.mockResolvedValue(response({ settings: { location } }));
    expect((await mount()).result.current.savedName).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('failed settings status is not parsed and leaves the picker usable', async () => {
    const failed = response({ settings: { location: { displayName: 'Do not load' } } }, 503);
    fetchMock.mockResolvedValue(failed);
    const { result } = await mount();
    expect(result.current.savedName).toBeNull();
    expect(failed.json).not.toHaveBeenCalled();
    act(() => result.current.setQuery('x'));
    expect(result.current.query).toBe('x');
  });

  test.each(['network', 'json'])('settings %s rejection leaves the initial state intact', async failure => {
    if (failure === 'network') fetchMock.mockRejectedValue(new Error('Synthetic settings unavailable'));
    else {
      const malformed = response(null);
      malformed.json.mockRejectedValue(new Error('Synthetic invalid JSON'));
      fetchMock.mockResolvedValue(malformed);
    }
    expect((await mount()).result.current).toMatchObject({ savedName: null, searching: false, saving: false });
  });
});

describe('debounced location queries', () => {
  test('exactly two characters unlock search while empty and one-character queries remain inert', async () => {
    const hook = await mount();
    fetchMock.mockResolvedValueOnce(response({ results: [first] }));
    act(() => hook.result.current.setQuery(''));
    await act(async () => { jest.advanceTimersByTime(350); });
    act(() => hook.result.current.setQuery('S'));
    await act(async () => { jest.advanceTimersByTime(350); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.setQuery('Sy'));
    await act(async () => { jest.advanceTimersByTime(349); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/location-search?q=Sy');
    expect(hook.result.current.candidates).toEqual([first]);
  });

  test('encodes the query and waits the full debounce interval before showing pending state', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const hook = await mount();
    fetchMock.mockImplementationOnce(() => pending.promise);
    const query = 'Synthetic café & river/?';
    act(() => hook.result.current.setQuery(query));
    await act(async () => { jest.advanceTimersByTime(349); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.searching).toBe(false);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/location-search?q=${encodeURIComponent(query)}`);
    expect(hook.result.current.searching).toBe(true);
    await act(async () => { pending.resolve(response({ results: [first, second] })); });
    expect(hook.result.current.candidates).toEqual([first, second]);
    expect(hook.result.current.searching).toBe(false);
  });

  test('editing before the deadline cancels the earlier query and uses a new full interval', async () => {
    const hook = await mount();
    fetchMock.mockResolvedValue(response({ results: [second] }));
    act(() => hook.result.current.setQuery('Old city'));
    await act(async () => { jest.advanceTimersByTime(300); });
    act(() => hook.result.current.setQuery('New city'));
    await act(async () => { jest.advanceTimersByTime(349); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(fetchMock.mock.calls).toEqual([['/api/settings'], ['/api/location-search?q=New%20city']]);
    expect(hook.result.current.candidates).toEqual([second]);
  });

  test('queries below two characters clear candidates and never schedule a request', async () => {
    const hook = await mount();
    fetchMock.mockResolvedValue(response({ results: [first] }));
    await search(hook, 'City');
    expect(hook.result.current.candidates).toEqual([first]);
    act(() => hook.result.current.setQuery('x'));
    expect(hook.result.current.candidates).toEqual([]);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('unmount cancels a scheduled search before it reaches fetch', async () => {
    const hook = await mount();
    act(() => hook.result.current.setQuery('Never requested'));
    hook.unmount();
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a successful response without results clears the previous result list', async () => {
    const hook = await mount();
    fetchMock.mockResolvedValueOnce(response({ results: [first] })).mockResolvedValueOnce(response({}));
    await search(hook, 'Old city');
    expect(hook.result.current.candidates).toEqual([first]);
    await search(hook, 'New city');
    expect(hook.result.current.candidates).toEqual([]);
    expect(hook.result.current.searching).toBe(false);
  });

  test.each(['network', 'json'])('search %s rejection clears busy state and permits retry', async failure => {
    const hook = await mount();
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('Synthetic search unavailable'));
    else {
      const malformed = response(null);
      malformed.json.mockRejectedValue(new Error('Synthetic invalid search JSON'));
      fetchMock.mockResolvedValueOnce(malformed);
    }
    await search(hook, 'Failed city');
    expect(hook.result.current.searching).toBe(false);
    fetchMock.mockResolvedValueOnce(response({ results: [second] }));
    await search(hook, 'Retry city');
    expect(hook.result.current).toMatchObject({ candidates: [second], searching: false });
  });

  test.failing('KNOWN GAP: older search responses overwrite results for the current query', async () => {
    const hook = await mount();
    const older = deferred<ReturnType<typeof response>>();
    const newer = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    await search(hook, 'Older city');
    await search(hook, 'Newer city');
    await act(async () => { newer.resolve(response({ results: [second] })); });
    expect(hook.result.current.candidates).toEqual([second]);
    await act(async () => { older.resolve(response({ results: [first] })); });
    expect(hook.result.current.query).toBe('Newer city');
    expect(hook.result.current.candidates).toEqual([second]);
  });

  test.failing('KNOWN GAP: clearing a query does not invalidate its pending search response', async () => {
    const hook = await mount();
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    await search(hook, 'Old city');
    act(() => hook.result.current.setQuery(''));
    expect(hook.result.current.candidates).toEqual([]);
    await act(async () => { pending.resolve(response({ results: [first] })); });
    expect(hook.result.current.query).toBe('');
    expect(hook.result.current.candidates).toEqual([]);
  });
});

describe('location select and clear actions', () => {
  test('select optimistically updates the name, clears search, and PATCHes only candidate fields', async () => {
    const hook = await mount();
    fetchMock.mockResolvedValueOnce(response({ results: [first] }));
    await search(hook, 'City');
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    const candidate = { ...first, providerInternalId: 'must-not-persist' };
    const before = { ...candidate };
    let saving!: Promise<void>;
    act(() => { saving = hook.result.current.select(candidate); });
    expect(hook.result.current).toMatchObject({ savedName: first.displayName, query: '', candidates: [], saving: true });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'location', value: { lat: first.lat, lon: first.lon, displayName: first.displayName } }),
    });
    await act(async () => { pending.resolve(response({})); await saving; });
    expect(hook.result.current.saving).toBe(false);
    expect(candidate).toEqual(before);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('clear removes the saved name immediately and persists explicit null', async () => {
    fetchMock.mockResolvedValueOnce(response({ settings: { location: { displayName: 'Stored city' } } }));
    const hook = await mount();
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    let saving!: Promise<void>;
    act(() => { saving = hook.result.current.clear(); });
    expect(hook.result.current.savedName).toBeNull();
    expect(hook.result.current.saving).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'location', value: null }),
    });
    await act(async () => { pending.resolve(response({})); await saving; });
    expect(hook.result.current.saving).toBe(false);
  });

  test.each(['select', 'clear'] as const)('%s rejection settles saving and the action can be retried', async action => {
    const hook = await mount();
    fetchMock.mockRejectedValueOnce(new Error('Synthetic settings write failed'));
    await act(async () => {
      if (action === 'select') await hook.result.current.select(first);
      else await hook.result.current.clear();
    });
    expect(hook.result.current.saving).toBe(false);
    fetchMock.mockResolvedValueOnce(response({}));
    await act(async () => {
      if (action === 'select') await hook.result.current.select(second);
      else await hook.result.current.clear();
    });
    expect(hook.result.current.saving).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('selection and clear handlers remain stable across query renders', async () => {
    const hook = await mount();
    const { select, clear } = hook.result.current;
    act(() => hook.result.current.setQuery('x'));
    expect(hook.result.current.select).toBe(select);
    expect(hook.result.current.clear).toBe(clear);
  });
});
