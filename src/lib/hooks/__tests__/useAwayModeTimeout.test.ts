/**
 * @jest-environment jsdom
 */

/**
 * Tests for useAwayModeTimeout hook using renderHook.
 *
 * Tests localStorage persistence, custom event dispatch,
 * and cross-component synchronization via event listeners.
 */

import { renderHook, act } from '@testing-library/react';
import { useAwayModeTimeout } from '../useAwayModeTimeout';

describe('useAwayModeTimeout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default timeout of 0 (disabled) when no stored value', () => {
    const { result } = renderHook(() => useAwayModeTimeout());
    expect(result.current.timeout).toBe(0);
  });

  it('reads stored timeout from localStorage on init', () => {
    localStorage.setItem('prism-away-mode-timeout', '24');

    const { result } = renderHook(() => useAwayModeTimeout());
    expect(result.current.timeout).toBe(24);
  });

  it('setTimeout updates the returned timeout value', () => {
    const { result } = renderHook(() => useAwayModeTimeout());
    expect(result.current.timeout).toBe(0);

    act(() => {
      result.current.setTimeout(48);
    });

    expect(result.current.timeout).toBe(48);
  });

  it('setTimeout persists value to localStorage', () => {
    const { result } = renderHook(() => useAwayModeTimeout());

    act(() => {
      result.current.setTimeout(168);
    });

    expect(localStorage.getItem('prism-away-mode-timeout')).toBe('168');
  });

  it('setTimeout dispatches custom event with the hours value', () => {
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
    const { result } = renderHook(() => useAwayModeTimeout());

    act(() => {
      result.current.setTimeout(72);
    });

    const event = dispatchSpy.mock.calls.find(
      (call) => (call[0] as CustomEvent).type === 'prism:away-mode-timeout-change'
    );
    expect(event).toBeTruthy();
    expect((event![0] as CustomEvent).detail).toBe(72);

    dispatchSpy.mockRestore();
  });

  it('updates timeout when receiving custom event from another component', () => {
    const { result } = renderHook(() => useAwayModeTimeout());
    expect(result.current.timeout).toBe(0);

    // Simulate another component dispatching a timeout change
    act(() => {
      window.dispatchEvent(new CustomEvent('prism:away-mode-timeout-change', { detail: 96 }));
    });

    expect(result.current.timeout).toBe(96);
  });

  it('cleans up event listener on unmount', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useAwayModeTimeout());

    unmount();

    const removeCall = removeSpy.mock.calls.find(
      (call) => call[0] === 'prism:away-mode-timeout-change'
    );
    expect(removeCall).toBeTruthy();

    removeSpy.mockRestore();
  });

  it('two instances stay synchronized via events', () => {
    const { result: result1 } = renderHook(() => useAwayModeTimeout());
    const { result: result2 } = renderHook(() => useAwayModeTimeout());

    act(() => {
      result1.current.setTimeout(120);
    });

    // The event dispatch from setTimeout should update the second instance
    expect(result2.current.timeout).toBe(120);
  });
});
