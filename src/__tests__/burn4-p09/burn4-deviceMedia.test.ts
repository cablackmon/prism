/** @jest-environment jsdom */

import { createElement, useLayoutEffect, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useScreenOrientation } from '@/lib/hooks/useScreenOrientation';
import { useIsPWA } from '@/lib/hooks/useIsPWA';
import { useIsTouch } from '@/lib/hooks/useIsTouch';
import { burn4MediaQueries } from './burn4-browserFakes';

const features = [
  { name: 'screen orientation', query: '(orientation: portrait)', hook: useScreenOrientation, active: 'portrait', inactive: 'landscape' },
  { name: 'standalone PWA', query: '(display-mode: standalone)', hook: useIsPWA, active: true, inactive: false },
  { name: 'primary coarse pointer', query: '(pointer: coarse)', hook: useIsTouch, active: true, inactive: false },
];

describe('burn4 media-query device detection', () => {
  const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  let media: ReturnType<typeof burn4MediaQueries>;

  beforeEach(() => {
    media = burn4MediaQueries();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: media.matchMedia });
  });

  afterEach(() => {
    cleanup();
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    else Reflect.deleteProperty(window, 'matchMedia');
  });

  describe.each(features)('$name', ({ query, hook, active, inactive }) => {
    test.each([false, true])('reflects an initial match of %s', matches => {
      media.get(query).matches = matches;
      const { result } = renderHook(() => hook());
      expect(result.current).toBe(matches ? active : inactive);
      expect(media.matchMedia).toHaveBeenCalledWith(query);
      expect(media.get(query).listeners.size).toBe(1);
    });

    test('tracks both directions and ignores unrelated media events', () => {
      const { result } = renderHook(() => hook());
      act(() => media.get(query).change(true));
      expect(result.current).toBe(active);
      act(() => media.get('(unrelated: fixture)').change(false));
      expect(result.current).toBe(active);
      act(() => media.get(query).change(false));
      expect(result.current).toBe(inactive);
    });

    test('keeps one subscription after rerenders and removes it on unmount', () => {
      let renders = 0;
      const { result, rerender, unmount } = renderHook(() => { renders += 1; return hook(); });
      const mql = media.get(query);
      const listener = [...mql.listeners][0];
      rerender();
      rerender();
      expect(mql.listeners.size).toBe(1);
      expect([...mql.listeners][0]).toBe(listener);
      expect(result.current).toBe(inactive);
      unmount();
      const before = renders;
      expect(mql.listeners.size).toBe(0);
      act(() => mql.change(true));
      expect(renders).toBe(before);
    });

    test('notifies multiple consumers while allowing one consumer to unmount', () => {
      const first = renderHook(() => hook());
      const second = renderHook(() => hook());
      const mql = media.get(query);
      expect(mql.listeners.size).toBe(2);
      act(() => mql.change(true));
      expect(first.result.current).toBe(active);
      expect(second.result.current).toBe(active);
      first.unmount();
      expect(mql.listeners.size).toBe(1);
      act(() => mql.change(false));
      expect(second.result.current).toBe(inactive);
      second.unmount();
      expect(mql.listeners.size).toBe(0);
    });
  });

  test('isolates portrait, standalone and pointer state while all hooks are mounted together', () => {
    const { result } = renderHook(() => ({ orientation: useScreenOrientation(), pwa: useIsPWA(), touch: useIsTouch() }));
    act(() => media.get('(display-mode: standalone)').change(true));
    expect(result.current).toEqual({ orientation: 'landscape', pwa: true, touch: false });
    act(() => media.get('(pointer: coarse)').change(true));
    expect(result.current).toEqual({ orientation: 'landscape', pwa: true, touch: true });
    act(() => media.get('(orientation: portrait)').change(true));
    expect(result.current).toEqual({ orientation: 'portrait', pwa: true, touch: true });
  });

  test.failing('KNOWN GAP: screen orientation misses a media change between render and subscription', () => {
    const mql = media.get('(orientation: portrait)');
    function RotateBeforePassiveEffects({ children }: PropsWithChildren) {
      useLayoutEffect(() => { mql.change(true); }, []);
      return createElement('div', null, children);
    }
    const { result } = renderHook(useScreenOrientation, { wrapper: RotateBeforePassiveEffects });
    expect(mql.matches).toBe(true);
    expect(mql.listeners.size).toBe(1);
    expect(result.current).toBe('portrait');
  });
});
