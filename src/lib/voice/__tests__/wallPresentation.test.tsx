/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';

import {
  HIDE_VOICE_LAUNCHER_IN_WALL_PET,
  WALL_PRESENTATION_MESSAGE,
  WALL_PRESENTATION_REQUEST,
  shouldHideVoiceLauncher,
  useWallAvatarPresentation,
} from '../wallPresentation';

const WALL_ORIGIN = 'https://kyst-board.fly.dev';

// jsdom's top window is its own parent; the wall is a separate window.
function frameInWall() {
  const wall = { postMessage: jest.fn() };
  const descriptor = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { configurable: true, get: () => wall });
  return {
    wall,
    restore: () => {
      if (descriptor) Object.defineProperty(window, 'parent', descriptor);
      else delete (window as { parent?: unknown }).parent;
    },
  };
}

function announce(data: unknown, origin = WALL_ORIGIN, source: unknown = window.parent) {
  // jsdom's MessageEvent only accepts real windows as source, so set it after.
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('shouldHideVoiceLauncher', () => {
  it('hides only for the wall pet, and only while the flag is on', () => {
    expect(HIDE_VOICE_LAUNCHER_IN_WALL_PET).toBe(true);
    expect(shouldHideVoiceLauncher('pet')).toBe(true);
    expect(shouldHideVoiceLauncher('pet', false)).toBe(false);
    for (const other of [null, 'overlay', 'off', 'still', 'holo', '', 'PET']) {
      expect(shouldHideVoiceLauncher(other)).toBe(false);
    }
  });
});

describe('useWallAvatarPresentation', () => {
  let framed: ReturnType<typeof frameInWall> | null = null;

  afterEach(() => {
    framed?.restore();
    framed = null;
  });

  it('stays null and asks nobody when the board is not framed', () => {
    expect(window.parent).toBe(window);
    const post = jest.spyOn(window, 'postMessage');
    const { result } = renderHook(() => useWallAvatarPresentation());
    announce({ type: WALL_PRESENTATION_MESSAGE, presentation: 'pet' }, WALL_ORIGIN, window);
    expect(result.current).toBeNull();
    expect(post).not.toHaveBeenCalled();
    post.mockRestore();
  });

  it('asks the wall once, at the wall origin, and believes its answer', () => {
    framed = frameInWall();
    const { result, rerender } = renderHook(() => useWallAvatarPresentation());
    rerender();
    expect(framed.wall.postMessage).toHaveBeenCalledTimes(1);
    expect(framed.wall.postMessage).toHaveBeenCalledWith(
      { type: WALL_PRESENTATION_REQUEST },
      WALL_ORIGIN
    );

    announce({ type: WALL_PRESENTATION_MESSAGE, presentation: 'pet' });
    expect(result.current).toBe('pet');
    announce({ type: WALL_PRESENTATION_MESSAGE, presentation: 'overlay' });
    expect(result.current).toBe('overlay');
  });

  it('ignores other origins, other windows, other types and malformed values', () => {
    framed = frameInWall();
    const { result } = renderHook(() => useWallAvatarPresentation());
    announce({ type: WALL_PRESENTATION_MESSAGE, presentation: 'pet' }, 'https://evil.example');
    announce({ type: WALL_PRESENTATION_MESSAGE, presentation: 'pet' }, WALL_ORIGIN, {});
    announce({ type: 'kyst-user-activity', presentation: 'pet' });
    announce({ type: WALL_PRESENTATION_MESSAGE, presentation: 1 });
    announce({ type: WALL_PRESENTATION_MESSAGE });
    announce(null);
    expect(result.current).toBeNull();
  });

  it('stops listening once unmounted', () => {
    framed = frameInWall();
    const remove = jest.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useWallAvatarPresentation());
    unmount();
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    remove.mockRestore();
  });
});
