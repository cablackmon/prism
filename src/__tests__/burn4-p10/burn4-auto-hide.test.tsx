/** @jest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useAutoHideUI } from '@/lib/hooks/useAutoHideUI';

let mockPathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('react-dom/server', () => jest.requireActual('react-dom/server.node'));

const storageKey = 'prism:auto-hide-ui';

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  mockPathname = '/';
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function advance(ms: number) {
  act(() => { jest.advanceTimersByTime(ms); });
}

function event(type: string) {
  act(() => { window.dispatchEvent(new Event(type)); });
}

describe('auto-hide settings and routes', () => {
  test('stays visible with no setting even after long inactivity', () => {
    const { result } = renderHook(() => useAutoHideUI());
    expect(result.current.autoHideEnabled).toBe(false);
    advance(60_000);
    expect(result.current.uiHidden).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('renders visible during server rendering even when browser storage says enabled', () => {
    localStorage.setItem(storageKey, 'true');
    function ServerProbe() {
      const state = useAutoHideUI();
      return <span>{String(state.autoHideEnabled)}:{String(state.uiHidden)}</span>;
    }
    expect(renderToString(<ServerProbe />)).toBe('<span>false<!-- -->:<!-- -->false</span>');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('reads the persisted preference after mount and hides exactly after ten seconds', () => {
    localStorage.setItem(storageKey, 'true');
    const { result } = renderHook(() => useAutoHideUI());
    expect(result.current).toMatchObject({ autoHideEnabled: true, uiHidden: false });
    advance(9_999);
    expect(result.current.uiHidden).toBe(false);
    advance(1);
    expect(result.current.uiHidden).toBe(true);
  });

  test.each(['/d/family', '/d/another-board'])('allows inactivity hiding on dashboard route %s', (path) => {
    mockPathname = path;
    localStorage.setItem(storageKey, 'true');
    const { result } = renderHook(() => useAutoHideUI());
    advance(10_000);
    expect(result.current.uiHidden).toBe(true);
  });

  test.each(['/settings', '/calendar', '/dashboard', '/d'])('keeps controls visible on non-dashboard route %s', (path) => {
    mockPathname = path;
    localStorage.setItem(storageKey, 'true');
    const { result } = renderHook(() => useAutoHideUI());
    advance(10_000);
    expect(result.current.autoHideEnabled).toBe(true);
    expect(result.current.uiHidden).toBe(false);
  });

  test('reveals controls immediately when navigation leaves a dashboard', () => {
    localStorage.setItem(storageKey, 'true');
    const { result, rerender } = renderHook(() => useAutoHideUI());
    advance(10_000);
    expect(result.current.uiHidden).toBe(true);
    mockPathname = '/settings';
    rerender();
    expect(result.current.uiHidden).toBe(false);
  });

  test('persists enable and disable choices, reveals hidden controls, and clears the pending timer', () => {
    const { result } = renderHook(() => useAutoHideUI());
    act(() => { result.current.setAutoHideEnabled(true); });
    expect(localStorage.getItem(storageKey)).toBe('true');
    advance(10_000);
    expect(result.current.uiHidden).toBe(true);
    act(() => { result.current.setAutoHideEnabled(false); });
    expect(localStorage.getItem(storageKey)).toBe('false');
    expect(result.current).toMatchObject({ autoHideEnabled: false, uiHidden: false });
    expect(jest.getTimerCount()).toBe(0);
    advance(30_000);
    expect(result.current.uiHidden).toBe(false);
  });

  test('synchronizes setting consumers through the custom change event used by settings UI', () => {
    const settings = renderHook(() => useAutoHideUI());
    const dashboard = renderHook(() => useAutoHideUI());
    act(() => {
      settings.result.current.setAutoHideEnabled(true);
      window.dispatchEvent(new Event('prism:auto-hide-change'));
    });
    expect(dashboard.result.current.autoHideEnabled).toBe(true);
    advance(10_000);
    expect(dashboard.result.current.uiHidden).toBe(true);
    act(() => {
      settings.result.current.setAutoHideEnabled(false);
      window.dispatchEvent(new Event('prism:auto-hide-change'));
    });
    expect(dashboard.result.current).toMatchObject({ autoHideEnabled: false, uiHidden: false });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('reads cross-tab storage changes and accepts only the exact true value', () => {
    const { result } = renderHook(() => useAutoHideUI());
    localStorage.setItem(storageKey, 'true');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: storageKey, newValue: 'true' })); });
    advance(10_000);
    expect(result.current.uiHidden).toBe(true);
    localStorage.setItem(storageKey, 'TRUE');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: storageKey, newValue: 'TRUE' })); });
    expect(result.current).toMatchObject({ autoHideEnabled: false, uiHidden: false });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('auto-hide activity and lifecycle', () => {
  test.each(['mousedown', 'touchstart', 'keydown', 'scroll'])('%s reveals controls and restarts a full idle period', (type) => {
    localStorage.setItem(storageKey, 'true');
    const { result } = renderHook(() => useAutoHideUI());
    advance(10_000);
    expect(result.current.uiHidden).toBe(true);
    event(type);
    expect(result.current.uiHidden).toBe(false);
    expect(jest.getTimerCount()).toBe(1);
    advance(9_999);
    expect(result.current.uiHidden).toBe(false);
    advance(1);
    expect(result.current.uiHidden).toBe(true);
  });

  test('throttles pointer movement to 400ms while allowing the first idle reveal', () => {
    localStorage.setItem(storageKey, 'true');
    const { result } = renderHook(() => useAutoHideUI());
    advance(10_000);
    event('mousemove');
    expect(result.current.uiHidden).toBe(false);
    advance(100);
    event('mousemove');
    advance(9_900);
    expect(result.current.uiHidden).toBe(true);
    event('mousemove');
    expect(result.current.uiHidden).toBe(false);
    advance(400);
    event('mousemove');
    advance(9_600);
    expect(result.current.uiHidden).toBe(false);
    advance(400);
    expect(result.current.uiHidden).toBe(true);
  });

  test('does not create duplicate idle timers after repeated setting events and activity', () => {
    localStorage.setItem(storageKey, 'true');
    const { result } = renderHook(() => useAutoHideUI());
    event('prism:auto-hide-change');
    event('prism:auto-hide-change');
    advance(500);
    event('mousedown');
    event('scroll');
    expect(jest.getTimerCount()).toBe(1);
    advance(10_000);
    expect(result.current.uiHidden).toBe(true);
  });

  test('removes listeners and timers on unmount and starts a fresh lifetime on remount', () => {
    localStorage.setItem(storageKey, 'true');
    const remove = jest.spyOn(window, 'removeEventListener');
    const first = renderHook(() => useAutoHideUI());
    advance(5_000);
    first.unmount();
    expect(jest.getTimerCount()).toBe(0);
    const removed = remove.mock.calls.map(([name]) => name);
    expect(removed).toEqual(expect.arrayContaining([
      'mousedown', 'touchstart', 'keydown', 'scroll', 'mousemove', 'storage', 'prism:auto-hide-change',
    ]));
    event('mousedown');
    event('prism:auto-hide-change');
    expect(jest.getTimerCount()).toBe(0);
    const second = renderHook(() => useAutoHideUI());
    advance(5_000);
    expect(second.result.current.uiHidden).toBe(false);
    advance(5_000);
    expect(second.result.current.uiHidden).toBe(true);
  });
});
