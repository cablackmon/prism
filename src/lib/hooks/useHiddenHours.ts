'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CalendarEvent } from '@/types/calendar';

// localStorage key doubles as a fast-paint cache AND the migration source for
// installs that stored hidden-hours locally before it moved to the database.
const CACHE_KEY = 'prism:calendar-hidden-hours';
// Database settings key (persists across updates + shared across devices).
const SETTING_KEY = 'calendarHiddenHours';

interface HiddenHoursSettings {
  /** Mode for hour filtering */
  mode: 'manual' | 'auto-fit';
  /** Starting hour to hide (0-23) */
  startHour: number;
  /** Ending hour to hide (0-23, exclusive) */
  endHour: number;
  /** Auto-fit buffer in hours to add around visible events */
  bufferHours: number;
  /** Whether the time block is currently hidden */
  enabled: boolean;
}

const DEFAULT_SETTINGS: HiddenHoursSettings = {
  mode: 'manual',
  startHour: 0,
  endHour: 6,
  bufferHours: 1,
  enabled: false,
};

function normalize(parsed: unknown): HiddenHoursSettings {
  const p = (parsed ?? {}) as Partial<HiddenHoursSettings>;
  return {
    mode: p.mode === 'manual' || p.mode === 'auto-fit' ? p.mode : DEFAULT_SETTINGS.mode,
    startHour: typeof p.startHour === 'number' ? p.startHour : DEFAULT_SETTINGS.startHour,
    endHour: typeof p.endHour === 'number' ? p.endHour : DEFAULT_SETTINGS.endHour,
    bufferHours: typeof p.bufferHours === 'number' ? p.bufferHours : DEFAULT_SETTINGS.bufferHours,
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_SETTINGS.enabled,
  };
}

export function useHiddenHours() {
  const [settings, setSettingsState] = useState<HiddenHoursSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // 1. Instant paint from the localStorage cache (so the calendar doesn't
    //    flash default hours before the DB responds).
    let cached: HiddenHoursSettings | null = null;
    try {
      const saved = localStorage.getItem(CACHE_KEY);
      if (saved) {
        cached = normalize(JSON.parse(saved));
        setSettingsState(cached);
      }
    } catch {
      // ignore
    }
    setLoaded(true);

    // 2. Authoritative value from the database; reconcile + refresh the cache.
    let active = true;
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return;
        const dbValue = data?.settings?.[SETTING_KEY];
        if (dbValue && typeof dbValue === 'object') {
          const norm = normalize(dbValue);
          setSettingsState(norm);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(norm));
          } catch {
            // ignore
          }
        } else if (cached) {
          // One-time migration: DB has no value yet but this device had a local
          // one — push it up so it persists and reaches other devices.
          fetch('/api/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: SETTING_KEY, value: cached }),
          }).catch(() => {});
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const setSettings = useCallback((newSettings: Partial<HiddenHoursSettings>) => {
    setSettingsState((prev) => {
      const updated = { ...prev, ...newSettings };
      // Cache locally for instant paint next load.
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      // Persist to the DB (requires settings permission; a display-only session
      // silently keeps the local value if the PATCH is refused).
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: SETTING_KEY, value: updated }),
      }).catch(() => {});
      return updated;
    });
  }, []);

  // Toggle hidden state
  const toggleHidden = useCallback(() => {
    setSettings({ enabled: !settings.enabled });
  }, [settings.enabled, setSettings]);

  // Set time range
  const setTimeRange = useCallback(
    (startHour: number, endHour: number) => {
      setSettings({ startHour, endHour });
    },
    [setSettings]
  );

  const clampHour = (hour: number) => Math.min(23, Math.max(0, hour));

  const getVisibleHours = useCallback(
    (events?: CalendarEvent[], range?: { from: Date; to: Date }): number[] => {
      const allHours = Array.from({ length: 24 }, (_, i) => i);
      if (!settings.enabled) {
        return allHours;
      }

      if (settings.mode === 'manual') {
        return allHours.filter((hour) => {
          if (settings.startHour <= settings.endHour) {
            return hour < settings.startHour || hour >= settings.endHour;
          }
          return hour >= settings.endHour && hour < settings.startHour;
        });
      }

      if (settings.mode === 'auto-fit' && events && range) {
        const timedEvents = events.filter(
          (event) => !event.allDay && event.endTime > range.from && event.startTime < range.to
        );

        if (timedEvents.length === 0) {
          return allHours.filter((hour) => hour >= 8 && hour <= 18);
        }

        let minHour = 23;
        let maxHour = 0;

        for (const event of timedEvents) {
          const eventStart = event.startTime < range.from ? range.from : event.startTime;
          const eventEnd = event.endTime > range.to ? range.to : event.endTime;
          const startHour = eventStart.getHours();

          let endHour = eventEnd.getHours();
          if (
            eventEnd.getMinutes() === 0 &&
            eventEnd.getSeconds() === 0 &&
            eventEnd.getMilliseconds() === 0
          ) {
            endHour = Math.max(startHour, endHour - 1);
          }

          minHour = Math.min(minHour, startHour);
          maxHour = Math.max(maxHour, endHour);
        }

        minHour = clampHour(minHour - settings.bufferHours);
        maxHour = clampHour(maxHour + settings.bufferHours);

        if (maxHour - minHour < 4) {
          const center = (minHour + maxHour) / 2;
          minHour = clampHour(Math.floor(center - 2));
          maxHour = clampHour(Math.ceil(center + 2));
        }

        return allHours.filter((hour) => hour >= minHour && hour <= maxHour);
      }

      return allHours;
    },
    [settings.enabled, settings.mode, settings.startHour, settings.endHour, settings.bufferHours]
  );

  return {
    settings,
    loaded,
    setSettings,
    toggleHidden,
    setTimeRange,
    getVisibleHours,
  };
}
