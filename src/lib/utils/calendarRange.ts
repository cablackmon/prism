import { startOfYear, endOfYear, subYears, addYears } from 'date-fns';

/**
 * Maximum events a single calendar fetch will return. Sized well above a busy
 * family's instance count across {@link getFullCalendarRange} so the window can
 * never silently truncate; the API logs a warning if a fetch ever hits it.
 */
export const MAX_CALENDAR_EVENTS = 5000;

/**
 * The date window the full calendar page fetches: from Jan 1 of last year
 * through Dec 31 two years out (~4 years, anchored to calendar-year
 * boundaries).
 *
 * Why a wide *static* window instead of one that tracks the viewed month:
 *   - Postgres range scans over years are sub-millisecond (indexed on start
 *     time), and recurring events are stored as individual instance rows —
 *     there is no client-side recurrence expansion to blow up — so a wide
 *     window costs little.
 *   - A fixed window keeps navigation instant: paging months reuses one cached
 *     dataset instead of refetching (and flickering) on every prev/next.
 *   - It fixes the class of bug where events past a rolling horizon silently
 *     vanished from every view (#250).
 */
export function getFullCalendarRange(today: Date): { start: Date; end: Date } {
  return {
    start: startOfYear(subYears(today, 1)),
    end: endOfYear(addYears(today, 2)),
  };
}

const DAY_MS = 86_400_000;

/**
 * Narrow a full (wide-window) event list to just those overlapping [from, to],
 * padded ±1 day so a timezone boundary can never drop a real match. Views fetch
 * one wide dataset (~thousands of events) but render a small window; scoping to
 * the visible range first turns their per-day O(days × all_events) filtering
 * into O(days × visible_events). The precise per-day membership check each view
 * already runs is unchanged, so results are identical.
 */
export function eventsOverlappingRange<T extends { startTime: Date; endTime: Date }>(
  events: T[],
  from: Date,
  to: Date
): T[] {
  const start = from.getTime() - DAY_MS;
  const end = to.getTime() + 2 * DAY_MS;
  return events.filter((e) => e.startTime.getTime() <= end && e.endTime.getTime() >= start);
}
