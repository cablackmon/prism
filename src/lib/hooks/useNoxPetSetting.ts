'use client';

import { useCallback, useEffect, useState } from 'react';

export const NOX_PET_SETTING_KEY = 'noxPetEnabled';
const CHANGE_EVENT = 'prism:nox-pet-change';
const POLL_MS = 60_000;

/** Absent or malformed means on; only an explicit false (or the string "false") turns the pet off. */
export function parseNoxPetEnabled(raw: unknown): boolean {
  return !(raw === false || raw === 'false');
}

/**
 * Household-wide on/off for the Nox pet overlay, stored in the shared `settings` table so a phone
 * toggle reaches the kiosk (the kiosk re-reads it every minute and on tab show). `authorized` is
 * true only after /api/settings answered 200, so nothing renders outside the household wall.
 */
export function useNoxPetSetting() {
  const [enabled, setEnabledState] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (!res.ok) {
        setAuthorized(false);
        return;
      }
      const data = (await res.json()) as { settings?: Record<string, unknown> };
      setEnabledState(parseNoxPetEnabled(data.settings?.[NOX_PET_SETTING_KEY]));
      setAuthorized(true);
    } catch {
      /* keep the last known state; a network blip must not flip the pet */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(CHANGE_EVENT, onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(CHANGE_EVENT, onVisible);
    };
  }, [refresh]);

  const setEnabled = useCallback(async (value: boolean): Promise<boolean> => {
    const previous = enabled;
    setEnabledState(value);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: NOX_PET_SETTING_KEY, value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      setEnabledState(previous);
      return false;
    }
  }, [enabled]);

  return { enabled, authorized, setEnabled };
}
