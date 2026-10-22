/** @jest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { getTimezone, useTimezone } from '@/lib/hooks/useTimezone';
import { browserTimezone, deferred, installFetch, response } from './burn4-browser-fakes';

const key = 'prism:timezone';
const changedEvent = 'prism:timezone-changed';
let fetchMock: jest.Mock;
let restoreFetch: () => void;

beforeEach(() => {
  localStorage.clear();
  browserTimezone('Europe/Berlin');
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
  localStorage.clear();
});

async function mount() {
  const hook = renderHook(() => useTimezone());
  await act(async () => {});
  return hook;
}

describe('synchronous household timezone reads', () => {
  test('a cached zone takes priority over browser detection without an HTTP call', () => {
    localStorage.setItem(key, 'Pacific/Auckland');
    const detection = jest.spyOn(Intl, 'DateTimeFormat');
    expect(getTimezone()).toBe('Pacific/Auckland');
    expect(detection).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('empty or missing cache uses synthetic browser detection', () => {
    expect(getTimezone()).toBe('Europe/Berlin');
    localStorage.setItem(key, '');
    expect(getTimezone()).toBe('Europe/Berlin');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.failing('KNOWN GAP: synchronous timezone reads throw when browser storage is blocked', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Synthetic blocked storage'); });
    let timezone: string | undefined;
    expect(() => { timezone = getTimezone(); }).not.toThrow();
    expect(timezone).toBe('Europe/Berlin');
  });
});

describe('timezone cache and settings reconciliation', () => {
  test('cached timezone is immediate while the authoritative settings read remains pending', async () => {
    localStorage.setItem(key, 'Pacific/Auckland');
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(() => useTimezone());
    expect(result.current).toMatchObject({ timezone: 'Pacific/Auckland', loading: true });
    await act(async () => { pending.resolve(response({ settings: { timezone: 'Asia/Tokyo' } })); });
    expect(result.current).toMatchObject({ timezone: 'Asia/Tokyo', loading: false });
    expect(localStorage.getItem(key)).toBe('Asia/Tokyo');
    expect(fetchMock.mock.calls).toEqual([['/api/settings']]);
  });

  test('the detected zone is used until non-cached settings finish loading', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(() => useTimezone());
    expect(result.current).toMatchObject({ timezone: 'Europe/Berlin', loading: true });
    await act(async () => { pending.resolve(response({ settings: { timezone: 'America/Denver' } })); });
    expect(result.current).toMatchObject({ timezone: 'America/Denver', loading: false });
    expect(localStorage.getItem(key)).toBe('America/Denver');
  });

  test.each([undefined, '', null, false, 12])('missing or invalid server zone %j preserves the synchronous cache', async timezone => {
    localStorage.setItem(key, 'Pacific/Auckland');
    fetchMock.mockResolvedValue(response({ settings: { timezone } }));
    expect((await mount()).result.current).toMatchObject({ timezone: 'Pacific/Auckland', loading: false });
    expect(localStorage.getItem(key)).toBe('Pacific/Auckland');
  });

  test('non-success settings replies are not decoded or cached', async () => {
    const failed = response({ settings: { timezone: 'Asia/Tokyo' } }, 503);
    fetchMock.mockResolvedValue(failed);
    expect((await mount()).result.current).toMatchObject({ timezone: 'Europe/Berlin', loading: false });
    expect(failed.json).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });

  test.each(['network', 'json'])('settings %s rejection ends loading and preserves the cached value', async failure => {
    localStorage.setItem(key, 'Pacific/Auckland');
    if (failure === 'network') fetchMock.mockRejectedValue(new Error('Synthetic settings unavailable'));
    else {
      const malformed = response(null);
      malformed.json.mockRejectedValue(new Error('Synthetic invalid timezone JSON'));
      fetchMock.mockResolvedValue(malformed);
    }
    expect((await mount()).result.current).toMatchObject({ timezone: 'Pacific/Auckland', loading: false });
  });

  test('server data still updates state and ends loading when the cache write is denied', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Synthetic storage quota'); });
    fetchMock.mockResolvedValue(response({ settings: { timezone: 'Asia/Tokyo' } }));
    expect((await mount()).result.current).toMatchObject({ timezone: 'Asia/Tokyo', loading: false });
  });
});

describe('timezone selection and change events', () => {
  test('selection updates state and cache, dispatches the exact value, and persists without waiting for HTTP', async () => {
    const hook = await mount();
    const events: { detail: unknown; cached: string | null }[] = [];
    const listener = (event: Event) => events.push({ detail: (event as CustomEvent).detail, cached: localStorage.getItem(key) });
    window.addEventListener(changedEvent, listener);
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    let save: void;
    try {
      act(() => { save = hook.result.current.setTimezone('Pacific/Auckland'); });
      expect(hook.result.current.timezone).toBe('Pacific/Auckland');
      expect(localStorage.getItem(key)).toBe('Pacific/Auckland');
      expect(events).toEqual([{ detail: 'Pacific/Auckland', cached: 'Pacific/Auckland' }]);
      expect(fetchMock).toHaveBeenLastCalledWith('/api/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'timezone', value: 'Pacific/Auckland' }),
      });
      await act(async () => { pending.resolve(response({})); await save; });
    } finally {
      window.removeEventListener(changedEvent, listener);
    }
    expect(hook.result.current.loading).toBe(false);
  });

  test('a rejected PATCH settles without rejecting the public action and permits a later selection', async () => {
    const hook = await mount();
    const events: string[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent<string>).detail);
    window.addEventListener(changedEvent, listener);
    try {
      fetchMock.mockRejectedValueOnce(new Error('Synthetic timezone write failure'));
      await act(async () => { await hook.result.current.setTimezone('Asia/Tokyo'); });
      fetchMock.mockResolvedValueOnce(response({}));
      await act(async () => { await hook.result.current.setTimezone('Pacific/Auckland'); });
      expect(events).toEqual(['Asia/Tokyo', 'Pacific/Auckland']);
      expect(hook.result.current.timezone).toBe('Pacific/Auckland');
      expect(localStorage.getItem(key)).toBe('Pacific/Auckland');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener(changedEvent, listener);
    }
  });

  test('the selection callback remains stable after API reconciliation and local changes', async () => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(() => useTimezone());
    const setter = result.current.setTimezone;
    await act(async () => { pending.resolve(response({ settings: { timezone: 'Asia/Tokyo' } })); });
    expect(result.current.setTimezone).toBe(setter);
    fetchMock.mockResolvedValueOnce(response({}));
    await act(async () => { await result.current.setTimezone('Pacific/Auckland'); });
    expect(result.current.setTimezone).toBe(setter);
  });

  test.failing('KNOWN GAP: delayed initial settings overwrite a timezone selected while loading', async () => {
    const initial = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => initial.promise).mockResolvedValueOnce(response({}));
    const { result } = renderHook(() => useTimezone());
    await act(async () => { await result.current.setTimezone('Pacific/Auckland'); });
    expect(result.current.timezone).toBe('Pacific/Auckland');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { initial.resolve(response({ settings: { timezone: 'America/Denver' } })); });
    expect(result.current.loading).toBe(false);
    expect(result.current.timezone).toBe('Pacific/Auckland');
    expect(localStorage.getItem(key)).toBe('Pacific/Auckland');
  });

  test.failing('KNOWN GAP: denied timezone cache writes prevent API persistence and browser notification', async () => {
    const hook = await mount();
    const dispatch = jest.spyOn(window, 'dispatchEvent');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Synthetic storage quota'); });
    fetchMock.mockResolvedValueOnce(response({}));
    let outcomes: PromiseSettledResult<void>[] = [];
    await act(async () => {
      outcomes = await Promise.allSettled([hook.result.current.setTimezone('Pacific/Auckland')]);
    });
    expect(hook.result.current.timezone).toBe('Pacific/Auckland');
    expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled']);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'Pacific/Auckland' }),
    });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: changedEvent, detail: 'Pacific/Auckland' }));
  });
});
