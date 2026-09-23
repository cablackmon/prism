'use client';

import { useCallback } from 'react';
import { useBoardTheme } from './KystTheme';

// Approved mock v2 --cyan / --pink / --brass, matching kyst-theme.css. Hex
// values support the existing contrastText() helper for initials and pills.
const memberColors = new Map([
  ['parker', '#35c7ff'],
  ['sawyer', '#ff4d9e'],
  ['family', '#d2b457'],
]);

/** Presentation only: resolve a named member/group, never infer identity from
 * a color shared by unrelated calendars. IDs and edit payloads stay intact. */
export function useBoardColor() {
  const nox = useBoardTheme() === 'nox';
  return useCallback(
    (color: string, name?: string) => {
      if (!nox) return color;
      return memberColors.get(name?.trim().toLowerCase() ?? '') ?? color;
    },
    [nox]
  );
}
