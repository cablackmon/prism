/**
 * @jest-environment jsdom
 */
/**
 * The screensaver must always be dismissable, even where it never
 * auto-activates.
 *
 * The toolbar button opens the screensaver deliberately and is not gated on
 * PWA mode or on the timeout setting. Dismissal used to be registered in the
 * same effect as the idle timer, behind `if (timeout <= 0 || isPWA) return`,
 * so in an installed app — or with the timeout set to Never — the button
 * opened a screensaver that nothing could close.
 */
import { renderHook, act } from '@testing-library/react';

let mockIsPWA = false;
jest.mock('../useIsPWA', () => ({ useIsPWA: () => mockIsPWA }));

let mockTimeout = 120;
jest.mock('../useScreensaverTimeout', () => ({
  useScreensaverTimeout: () => ({ timeout: mockTimeout, setTimeout: jest.fn() }),
  SCREENSAVER_TIMEOUT_OPTIONS: [],
}));

import { useIdleDetection } from '../useIdleDetection';

/** The toolbar button's effect: open the screensaver on demand. */
const openScreensaver = () => window.dispatchEvent(new Event('prism:screensaver'));

/** A deliberate interaction, as the dismiss listeners see it. */
const tap = () => window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

beforeEach(() => {
  mockIsPWA = false;
  mockTimeout = 120;
  window.localStorage.clear();
});

describe('useIdleDetection — dismissing what the button opened', () => {
  it('closes on a tap in an ordinary browser', () => {
    const { result } = renderHook(() => useIdleDetection());

    act(() => { openScreensaver(); });
    expect(result.current.isIdle).toBe(true);

    // First interaction clears the "forced" flag, the second dismisses — this
    // is deliberate, so the button's own mouseup doesn't close it instantly.
    act(() => { tap(); tap(); });
    expect(result.current.isIdle).toBe(false);
  });

  it('closes on a tap in an installed PWA, where the timer never runs', () => {
    // The regression: the app was stuck on the screensaver until force-closed.
    mockIsPWA = true;
    const { result } = renderHook(() => useIdleDetection());

    act(() => { openScreensaver(); });
    expect(result.current.isIdle).toBe(true);

    act(() => { tap(); tap(); });
    expect(result.current.isIdle).toBe(false);
  });

  it('closes on a tap when the timeout is set to Never', () => {
    // Same trap by a different route: "Never" also skipped registration.
    mockTimeout = 0;
    const { result } = renderHook(() => useIdleDetection());

    act(() => { openScreensaver(); });
    expect(result.current.isIdle).toBe(true);

    act(() => { tap(); tap(); });
    expect(result.current.isIdle).toBe(false);
  });

  it('leaves a keep-alive control alone rather than dismissing', () => {
    const keeper = document.createElement('button');
    keeper.setAttribute('data-screensaver-keep', '');
    document.body.appendChild(keeper);

    const { result } = renderHook(() => useIdleDetection());
    act(() => { openScreensaver(); });

    act(() => {
      keeper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      keeper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.isIdle).toBe(true);

    document.body.removeChild(keeper);
  });
});
