/** @jest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { PERF_MODE_POLL_STRETCH, usePollingInterval } from '@/lib/hooks/usePollingInterval';

function dispatch(detail: unknown) {
  act(() => window.dispatchEvent(new CustomEvent('prism:performance-mode-change', { detail })));
}

describe('burn4 effective polling interval', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); jest.restoreAllMocks(); });

  test('defaults to the requested interval when performance mode is absent', () => {
    const { result, rerender } = renderHook(usePollingInterval, { initialProps: 120_000 });
    expect(result.current).toBe(120_000);
    rerender(300_000);
    expect(result.current).toBe(300_000);
  });

  test('stretches and rounds positive polling intervals from stored performance preference', () => {
    localStorage.setItem('prism-perf-mode', 'true');
    const { result, rerender } = renderHook(usePollingInterval, { initialProps: 120_000 });
    expect(result.current).toBe(300_000);
    expect(result.current).toBe(120_000 * PERF_MODE_POLL_STRETCH);
    rerender(3);
    expect(result.current).toBe(8);
  });

  test.each(['false', 'TRUE', '1', '', 'invalid'])('only the exact true storage string enables stretching: %j', stored => {
    localStorage.setItem('prism-perf-mode', stored);
    const { result } = renderHook(() => usePollingInterval(100));
    expect(result.current).toBe(100);
  });

  test.each([0, -1, -1000])('preserves disabled interval %i even when performance mode is enabled', interval => {
    localStorage.setItem('prism-perf-mode', 'true');
    const { result } = renderHook(() => usePollingInterval(interval));
    expect(result.current).toBe(interval);
    dispatch({ enabled: false });
    expect(result.current).toBe(interval);
  });

  test('tracks enable and disable events across mounted consumers', () => {
    const first = renderHook(() => usePollingInterval(100));
    const second = renderHook(() => usePollingInterval(200));
    dispatch({ enabled: true });
    expect(first.result.current).toBe(250);
    expect(second.result.current).toBe(500);
    dispatch({ enabled: false });
    expect(first.result.current).toBe(100);
    expect(second.result.current).toBe(200);
  });

  test('ignores malformed event payloads instead of coercing truthy values', () => {
    const { result } = renderHook(() => usePollingInterval(100));
    dispatch({ enabled: true });
    for (const detail of [undefined, null, {}, { enabled: 'false' }, { enabled: 0 }]) dispatch(detail);
    act(() => window.dispatchEvent(new Event('prism:performance-mode-change')));
    expect(result.current).toBe(250);
  });

  test('retains event state while changing default interval and handles disabled-to-enabled changes', () => {
    const { result, rerender } = renderHook(usePollingInterval, { initialProps: 100 });
    dispatch({ enabled: true });
    rerender(0);
    expect(result.current).toBe(0);
    rerender(300);
    expect(result.current).toBe(750);
  });

  test('removes its exact event listener on unmount and leaves another consumer subscribed', () => {
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    const first = renderHook(() => usePollingInterval(100));
    const firstListener = add.mock.calls.find(([event]) => event === 'prism:performance-mode-change')![1];
    const second = renderHook(() => usePollingInterval(100));
    first.unmount();
    expect(remove).toHaveBeenCalledWith('prism:performance-mode-change', firstListener);
    dispatch({ enabled: true });
    expect(second.result.current).toBe(250);
  });

  test.failing('KNOWN GAP: blocked browser storage crashes polling interval initialization', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Fixture storage blocked', 'SecurityError'); });
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let interval: number | undefined;
      expect(() => {
        interval = renderHook(() => usePollingInterval(100)).result.current;
      }).not.toThrow();
      expect(interval).toBe(100);
    } finally {
      error.mockRestore();
    }
  });
});
