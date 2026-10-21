/** @jest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { useModeToggle } from '@/lib/hooks/useModeToggle';
import { useAwayMode } from '@/lib/hooks/useAwayMode';
import { useBabysitterMode } from '@/lib/hooks/useBabysitterMode';
import { navCacheInvalidate } from '@/lib/utils/navCache';
import { deferred, response, settle } from './burn4-harness';

const inactive = { enabled: false, enabledAt: null, enabledBy: null };
const active = {
  enabled: true,
  enabledAt: '2026-10-21T12:30:00.000Z',
  enabledBy: 'synthetic-person',
};
const options = {
  endpoint: '/api/test-mode',
  eventName: 'burn4:mode-change',
  label: 'test mode',
  refreshInterval: 0,
};
const originalFetch = globalThis.fetch;
let fetchMock: jest.MockedFunction<typeof fetch>;

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  navCacheInvalidate(/.*/);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  fetchMock = jest.fn().mockResolvedValue(response(inactive));
  globalThis.fetch = fetchMock;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe('mode state and writes through real useFetch', () => {
  test('starts with an inactive loading state and converts the fetched timestamp', async () => {
    const first = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useModeToggle(options));
    expect(result.current).toMatchObject({
      isActive: false, enabledAt: null, enabledBy: null, loading: true, error: null,
    });
    await act(async () => { first.resolve(response(active)); });
    expect(result.current).toMatchObject({
      isActive: true, enabledAt: new Date(active.enabledAt),
      enabledBy: active.enabledBy, loading: false, error: null,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/test-mode');
  });

  test('posts both toggle directions and uses the confirmed server state', async () => {
    const { result } = renderHook(() => useModeToggle(options));
    await settle();
    fetchMock.mockResolvedValueOnce(response(active));
    await act(async () => { await result.current.toggle(true); });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/test-mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(result.current.isActive).toBe(true);
    expect(result.current.enabledAt).toEqual(new Date(active.enabledAt));

    fetchMock.mockResolvedValueOnce(response(inactive));
    await act(async () => { await result.current.toggle(false); });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/test-mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(result.current).toMatchObject({ isActive: false, enabledAt: null, enabledBy: null });
  });

  test('keeps the confirmed state while a toggle is pending instead of applying optimism', async () => {
    const { result } = renderHook(() => useModeToggle(options));
    await settle();
    const write = deferred<Response>();
    fetchMock.mockReturnValueOnce(write.promise);
    let completion!: Promise<void>;
    act(() => { completion = result.current.toggle(true); });
    expect(result.current.isActive).toBe(false);
    await act(async () => { write.resolve(response(active)); await completion; });
    expect(result.current.isActive).toBe(true);
  });

  test('surfaces a server rejection, preserves state, and clears the error on the next successful toggle', async () => {
    fetchMock.mockResolvedValueOnce(response(active));
    const { result } = renderHook(() => useModeToggle(options));
    await settle();
    fetchMock.mockResolvedValueOnce(response({ error: 'Only a parent can change this mode' }, false));
    await act(async () => {
      await expect(result.current.toggle(false)).rejects.toThrow('Only a parent can change this mode');
    });
    expect(result.current).toMatchObject({ isActive: true, error: 'Only a parent can change this mode' });
    fetchMock.mockResolvedValueOnce(response(inactive));
    await act(async () => { await result.current.toggle(false); });
    expect(result.current).toMatchObject({ isActive: false, error: null });
  });

  test('provides a label-specific error when a failed response has no message', async () => {
    const { result } = renderHook(() => useModeToggle(options));
    await settle();
    fetchMock.mockResolvedValueOnce(response({}, false));
    await act(async () => {
      await expect(result.current.toggle(true)).rejects.toThrow('Failed to toggle test mode');
    });
    expect(result.current.error).toBe('Failed to toggle test mode');
    expect(result.current.isActive).toBe(false);
  });

  test('preserves a network Error as the rejection and the displayed error', async () => {
    const { result } = renderHook(() => useModeToggle(options));
    await settle();
    const failure = new Error('offline write');
    fetchMock.mockRejectedValueOnce(failure);
    await act(async () => { await expect(result.current.toggle(true)).rejects.toBe(failure); });
    expect(result.current.error).toBe('offline write');
    expect(result.current.isActive).toBe(false);
  });

  test('uses a safe label when the transport rejects with a non-Error value', async () => {
    const { result } = renderHook(() => useModeToggle(options));
    await settle();
    fetchMock.mockRejectedValueOnce('synthetic transport failure');
    await act(async () => {
      await expect(result.current.toggle(true)).rejects.toBe('synthetic transport failure');
    });
    expect(result.current.error).toBe('Failed to toggle test mode');
  });

  test('reports an invalid response body without accepting the toggle', async () => {
    const { result } = renderHook(() => useModeToggle(options));
    await settle();
    fetchMock.mockResolvedValueOnce({
      ok: true, json: jest.fn().mockRejectedValue(new SyntaxError('invalid mode JSON')),
    } as unknown as Response);
    await act(async () => {
      await expect(result.current.toggle(true)).rejects.toThrow('invalid mode JSON');
    });
    expect(result.current).toMatchObject({ isActive: false, error: 'invalid mode JSON' });
  });

  test('exposes a cold-fetch failure and recovers through the exported refresh', async () => {
    fetchMock.mockResolvedValueOnce(response({}, false));
    const { result } = renderHook(() => useModeToggle(options));
    await settle();
    expect(result.current).toMatchObject({ loading: false, isActive: false, error: 'Failed to fetch test mode' });
    fetchMock.mockResolvedValueOnce(response(active));
    await act(async () => { await result.current.refresh(); });
    expect(result.current).toMatchObject({ isActive: true, loading: false, error: null });
  });

  test.failing('KNOWN GAP: an older initial GET overwrites a confirmed mode toggle', async () => {
    const oldRead = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldRead.promise);
    const { result } = renderHook(() => useModeToggle(options));
    fetchMock.mockResolvedValueOnce(response(active));
    await act(async () => { await result.current.toggle(true); });
    expect(result.current.isActive).toBe(true);
    await act(async () => { oldRead.resolve(response(inactive)); });
    expect(result.current.isActive).toBe(true);
  });
});

describe('mode wrappers, events, and lifecycle', () => {
  test('away mode renames the active flag, keeps metadata, and polls at the default interval', async () => {
    fetchMock.mockResolvedValue(response(active));
    const { result } = renderHook(() => useAwayMode());
    await settle();
    expect(result.current).toMatchObject({ isAway: true, enabledBy: active.enabledBy });
    expect(result.current).not.toHaveProperty('isActive');
    expect(fetchMock).toHaveBeenCalledWith('/api/away-mode');
    await act(async () => { jest.advanceTimersByTime(59_999); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('babysitter mode uses its own endpoint and default poll interval', async () => {
    const { result } = renderHook(() => useBabysitterMode());
    await settle();
    fetchMock.mockResolvedValueOnce(response(active));
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/babysitter-mode');
    expect(result.current.isActive).toBe(true);
  });

  test('honors wrapper-specific poll overrides and allows polling to be disabled', async () => {
    renderHook(() => useAwayMode(2_000));
    renderHook(() => useBabysitterMode(0));
    await settle();
    fetchMock.mockClear();
    await act(async () => { jest.advanceTimersByTime(4_000); });
    expect(fetchMock.mock.calls).toEqual([['/api/away-mode'], ['/api/away-mode']]);
  });

  test('keeps away and babysitter events isolated while synchronizing mounted consumers', async () => {
    const awayOne = renderHook(() => useAwayMode(0));
    const awayTwo = renderHook(() => useAwayMode(0));
    const babysitter = renderHook(() => useBabysitterMode(0));
    await settle();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(response(active));
    await act(async () => { window.dispatchEvent(new Event('prism:away-mode-change')); });
    expect(fetchMock.mock.calls).toEqual([['/api/away-mode'], ['/api/away-mode']]);
    expect(awayOne.result.current.isAway).toBe(true);
    expect(awayTwo.result.current.isAway).toBe(true);
    expect(babysitter.result.current.isActive).toBe(false);
    fetchMock.mockClear();
    await act(async () => { window.dispatchEvent(new Event('prism:babysitter-mode-change')); });
    expect(fetchMock.mock.calls).toEqual([['/api/babysitter-mode']]);
    expect(babysitter.result.current.isActive).toBe(true);
  });

  test('moves the listener and read/write endpoint when mode options change', async () => {
    const { result, rerender } = renderHook((props) => useModeToggle(props), { initialProps: options });
    await settle();
    const changed = { ...options, endpoint: '/api/other-mode', eventName: 'burn4:other-change' };
    rerender(changed);
    await settle();
    fetchMock.mockClear();
    await act(async () => { window.dispatchEvent(new Event(options.eventName)); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event(changed.eventName)); });
    expect(fetchMock).toHaveBeenCalledWith(changed.endpoint);
    fetchMock.mockResolvedValueOnce(response(active));
    await act(async () => { await result.current.toggle(true); });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(changed.endpoint);
    expect(result.current.isActive).toBe(true);
  });

  test('removes mode event listeners and polling when the final consumer unmounts', async () => {
    const { unmount } = renderHook(() => useAwayMode(1_000));
    await settle();
    unmount();
    fetchMock.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event('prism:away-mode-change'));
      jest.advanceTimersByTime(10_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
