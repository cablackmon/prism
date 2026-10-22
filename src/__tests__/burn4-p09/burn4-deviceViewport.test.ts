/** @jest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { useOrientation } from '@/lib/hooks/useOrientation';
import { useIsMobile } from '@/lib/hooks/useIsMobile';

function dimensions(width: number, height: number) {
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: width },
    innerHeight: { configurable: true, value: height },
  });
}

describe('burn4 viewport device detection', () => {
  const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')!;
  const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')!;

  beforeEach(() => dimensions(1024, 768));
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', originalWidth);
    Object.defineProperty(window, 'innerHeight', originalHeight);
  });

  test.each([
    { width: 1200, height: 800, expected: 'landscape' },
    { width: 400, height: 800, expected: 'portrait' },
    { width: 800, height: 800, expected: 'portrait' },
    { width: 0, height: 0, expected: 'portrait' },
  ])('orientation at $width x $height is $expected', ({ width, height, expected }) => {
    dimensions(width, height);
    const { result } = renderHook(useOrientation);
    expect(result.current).toBe(expected);
  });

  test('orientation updates from both resize and orientationchange events', () => {
    const { result } = renderHook(useOrientation);
    dimensions(500, 1000);
    act(() => window.dispatchEvent(new Event('orientationchange')));
    expect(result.current).toBe('portrait');
    dimensions(1000, 500);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current).toBe('landscape');
  });

  test('orientation removes both exact listeners and does not resubscribe on rerender', () => {
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    const { rerender, unmount } = renderHook(useOrientation);
    const resize = add.mock.calls.filter(([type]) => type === 'resize');
    const orientation = add.mock.calls.filter(([type]) => type === 'orientationchange');
    expect(resize).toHaveLength(1);
    expect(orientation).toHaveLength(1);
    rerender();
    expect(add.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', resize[0]![1]);
    expect(remove).toHaveBeenCalledWith('orientationchange', orientation[0]![1]);
  });

  test.each([
    { width: 0, expected: true }, { width: 767, expected: true },
    { width: 768, expected: false }, { width: 769, expected: false },
  ])('mobile detection at width $width is $expected', ({ width, expected }) => {
    dimensions(width, 1000);
    const { result } = renderHook(useIsMobile);
    expect(result.current).toBe(expected);
  });

  test('mobile detection crosses the breakpoint in either direction on resize', () => {
    const { result } = renderHook(useIsMobile);
    expect(result.current).toBe(false);
    dimensions(767, 500);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current).toBe(true);
    dimensions(768, 500);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current).toBe(false);
  });

  test('mobile detection uses viewport width even on tall screens and removes its resize listener', () => {
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    dimensions(900, 2000);
    const { result, rerender, unmount } = renderHook(useIsMobile);
    expect(result.current).toBe(false);
    const calls = add.mock.calls.filter(([type]) => type === 'resize');
    expect(calls).toHaveLength(1);
    rerender();
    expect(add.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', calls[0]![1]);
  });

  test('orientation and mobile consumers react independently and keep working after a sibling unmounts', () => {
    const first = renderHook(useOrientation);
    const second = renderHook(useOrientation);
    const mobile = renderHook(useIsMobile);
    first.unmount();
    dimensions(500, 1000);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(second.result.current).toBe('portrait');
    expect(mobile.result.current).toBe(true);
    dimensions(1000, 2000);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(second.result.current).toBe('portrait');
    expect(mobile.result.current).toBe(false);
  });
});
