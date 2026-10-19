'use client';

import { useEffect, useState } from 'react';

import { WALL_WRAPPER_URL } from '@/lib/auth/deviceHandoff';

// The kiosk wall (public/wall.html) frames this board and can stand NOX in the
// corner as a pet that you tap to ask. Its own voice controls then own the
// mic, so the board's floating mic button would just be a second, different
// way in. Flip this to false to show the board's mic on the wall again.
export const HIDE_VOICE_LAUNCHER_IN_WALL_PET = true;

export const WALL_PRESENTATION_MESSAGE = 'kyst-wall-avatar-presentation';
export const WALL_PRESENTATION_REQUEST = 'kyst-wall-avatar-presentation-request';

const KYST_WRAPPER_ORIGIN = new URL(WALL_WRAPPER_URL).origin;

export function shouldHideVoiceLauncher(
  presentation: string | null,
  enabled: boolean = HIDE_VOICE_LAUNCHER_IN_WALL_PET
): boolean {
  return enabled && presentation === 'pet';
}

// The presentation the wall announced, or null when the board is not inside
// the wall (standalone tab, phone, or any other parent). Only the wall's own
// window at the wall's origin is believed.
export function useWallAvatarPresentation(): string | null {
  const [presentation, setPresentation] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== KYST_WRAPPER_ORIGIN ||
        event.data?.type !== WALL_PRESENTATION_MESSAGE ||
        typeof event.data.presentation !== 'string'
      )
        return;
      setPresentation(event.data.presentation);
    };
    window.addEventListener('message', onMessage);
    // The wall also sends this on every frame load, but this component can
    // mount after that, so ask once ourselves.
    try {
      window.parent.postMessage({ type: WALL_PRESENTATION_REQUEST }, KYST_WRAPPER_ORIGIN);
    } catch {
      // A parent at another origin simply never answers.
    }
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return presentation;
}
