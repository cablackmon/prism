import { format } from 'date-fns';
import type { CalendarEvent } from '@/types/calendar';
import { eventStartsOnDisplayDay, isCalendarEventPast } from '@/lib/utils/timeFormat';

export const NIGHT_SKY_IDLE_SECONDS = 15 * 60;
export const NIGHT_START_HOUR = 21;
export const NIGHT_END_HOUR = 6;
export const NIGHT_SKY_WINDOW_DAYS = 14;
export const NIGHT_SKY_MESSAGE_TYPE = 'kyst:nightsky-data';
export const COMET_DESCRIPTION_CHAR_LIMIT = 60;
export const NIGHT_SKY_FRAME_EVENT_LIMIT = 24;

export type NightSkyFrameEvent = {
  id: string;
  title: string;
  description: string;
  startTime: string;
  allDay: boolean;
  /** Preformatted comet time, so the frame never re-derives all-day dates. */
  when: string;
  /** The one event the comet label announces: tomorrow's first, else the next. */
  comet: boolean;
  color: string;
  calendarId: string;
};

export function isExpectedNightSkyResponse(
  response: Pick<Response, 'ok' | 'redirected' | 'url'>,
  expectedUrl: string
): boolean {
  return response.ok && !response.redirected && response.url === expectedUrl;
}

export function isExpectedNightSkyFrameUrl(frameUrl: string, expectedUrl: string): boolean {
  return frameUrl === expectedUrl;
}

export function isNightSkyNight(date: Date): boolean {
  const forced =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('nightSkyMode')
      : null;
  if (forced === 'night') return true;
  if (forced === 'day') return false;
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/** Milliseconds until the dimming next flips at NIGHT_START_HOUR or NIGHT_END_HOUR. */
export function msUntilNightBoundary(date: Date): number {
  const boundaries = [NIGHT_END_HOUR, NIGHT_START_HOUR].flatMap((hour) => [
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour),
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, hour),
  ]);
  return Math.min(
    ...boundaries.map((boundary) => boundary.getTime() - date.getTime()).filter((ms) => ms > 0)
  );
}

export function moonPhase(date: Date): { age: number; illumination: number; waxing: boolean } {
  const synodicMonth = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNewMoon) / 86400000;
  const age = ((days % synodicMonth) + synodicMonth) % synodicMonth;
  return {
    age,
    illumination: (1 - Math.cos((age / synodicMonth) * Math.PI * 2)) / 2,
    waxing: age < synodicMonth / 2,
  };
}

export function nightSkyEvents(events: CalendarEvent[], now: Date) {
  const end = new Date(now);
  end.setDate(end.getDate() + NIGHT_SKY_WINDOW_DAYS);
  return events
    .filter(
      (event) =>
        !isCalendarEventPast(event.startTime, event.endTime, event.allDay, now) &&
        event.startTime <= end
    )
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

export function truncateCometDescription(description = ''): string {
  const normalized = description.replace(/\s+/g, ' ').trim();
  if (normalized.length <= COMET_DESCRIPTION_CHAR_LIMIT) return normalized;
  return `${normalized.slice(0, COMET_DESCRIPTION_CHAR_LIMIT - 1).trimEnd()}…`;
}

/**
 * All-day events are stored at UTC midnight of their floating date, so their
 * weekday comes from the UTC date, never from the local instant.
 */
export function cometTimeLabel(event: Pick<CalendarEvent, 'startTime' | 'allDay'>): string {
  const start = event.startTime;
  if (!event.allDay) return format(start, 'EEE h:mm a');
  const day = new Date(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return `${format(day, 'EEE')} · All day`;
}

export function nightSkyFrameEvents(events: CalendarEvent[], now: Date): NightSkyFrameEvent[] {
  const upcoming = nightSkyEvents(events, now);
  const comet = tomorrowEvents(upcoming, now)[0] ?? upcoming[0];
  const framed = upcoming.slice(0, NIGHT_SKY_FRAME_EVENT_LIMIT);
  // The comet event is the latest of the set whenever it misses the cut, so
  // taking the last slot keeps the payload in start order.
  if (comet && !framed.includes(comet)) framed[framed.length - 1] = comet;
  return framed.map((event) => ({
    id: event.id,
    title: event.title,
    description: truncateCometDescription(event.description),
    startTime: event.startTime.toISOString(),
    allDay: event.allDay,
    when: cometTimeLabel(event),
    comet: event === comet,
    color: event.color,
    calendarId: event.calendarId,
  }));
}

export function tomorrowEvents(events: CalendarEvent[], now: Date) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return events
    .filter((event) => eventStartsOnDisplayDay(event.startTime, event.allDay, tomorrow))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

export function auroraPalette(count: number) {
  if (count >= 8) return ['#7c3aed', '#c026d3', '#4f46e5'] as const;
  if (count >= 4) return ['#0d9488', '#2563eb', '#6366f1'] as const;
  return ['#10b981', '#14b8a6', '#22c55e'] as const;
}
