import { deduplicateEvents } from '@/lib/utils/calendarDedup';
import { isGoogleCalendarWebLink } from '@/lib/utils/googleCalendarLink';
import type { CalendarEvent } from '@/types/calendar';

function event(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: 'Practice',
    startTime: new Date('2026-01-08T18:00:00.000Z'),
    endTime: new Date('2026-01-08T19:00:00.000Z'),
    allDay: false,
    color: '#123456',
    calendarName: 'Synthetic calendar',
    calendarId: `calendar-${id}`,
    ...overrides,
  };
}

describe('deduplicateEvents calendar identity', () => {
  test('returns an independent empty result for an empty input', () => {
    const input: CalendarEvent[] = [];
    const output = deduplicateEvents(input);
    expect(output).toEqual([]);
    expect(output).not.toBe(input);
  });

  test('keeps the first cross-calendar representative and all its metadata', () => {
    const first = event('first', {
      description: 'Keep this description',
      location: 'Synthetic field',
      recurring: true,
      recurrenceRule: 'FREQ=WEEKLY',
      reminderMinutes: 15,
      groupId: 'synthetic-group',
    });
    const second = event('second', { color: '#abcdef', description: 'Other description' });
    const result = deduplicateEvents([first, second]);
    expect(result).toEqual([first]);
    expect(result[0]).toBe(first);
  });

  test('preserves first-seen order instead of sorting dates or titles', () => {
    const later = event('later', { title: 'Zebra' });
    const earlier = event('earlier', {
      title: 'Alpha',
      startTime: new Date('2026-01-01T18:00:00Z'),
      endTime: new Date('2026-01-01T19:00:00Z'),
    });
    expect(deduplicateEvents([later, earlier, event('copy', { title: 'Zebra' })]))
      .toEqual([later, earlier]);
  });

  test('compares date instants, including equivalent timezone representations', () => {
    const utc = event('utc');
    const offset = event('offset', {
      startTime: new Date('2026-01-08T12:00:00-06:00'),
      endTime: new Date('2026-01-08T13:00:00-06:00'),
    });
    expect(deduplicateEvents([utc, offset])).toEqual([utc]);
  });

  test('retains events whose start or end differs by one millisecond', () => {
    const original = event('original');
    const shiftedStart = event('start', {
      startTime: new Date(original.startTime.getTime() + 1),
    });
    const shiftedEnd = event('end', {
      endTime: new Date(original.endTime.getTime() + 1),
    });
    expect(deduplicateEvents([original, shiftedStart, shiftedEnd]))
      .toEqual([original, shiftedStart, shiftedEnd]);
  });

  test('does not combine differently cased, spaced or delimiter-bearing titles', () => {
    const events = ['Practice', 'practice', 'Practice ', 'Practice|extra', '']
      .map((title, index) => event(String(index), { title }));
    expect(deduplicateEvents(events)).toEqual(events);
  });

  test('leaves the input array and duplicate objects intact', () => {
    const first = Object.freeze(event('first'));
    const second = Object.freeze(event('second'));
    const input = [first, second];
    Object.freeze(input);
    const result = deduplicateEvents(input);
    expect(input).toEqual([first, second]);
    expect(input[1]).toBe(second);
    expect(result).not.toBe(input);
    expect(result).toEqual([first]);
  });
});

describe('isGoogleCalendarWebLink URL boundaries', () => {
  test.each([
    'https://calendar.google.com/calendar/u/0/r',
    'https://calendar.google.com/calendar/u/2/r/week?tab=rc',
    'https://calendar.google.com/calendar?cid=synthetic-calendar',
    'https://calendar.google.com/calendar?cid=',
    'https://CALENDAR.GOOGLE.COM/calendar/u/0/r',
    'https://calendar.google.com:443/calendar?cid=synthetic-calendar',
  ])('recognizes a Google web UI link: %s', (url) => {
    expect(isGoogleCalendarWebLink(url)).toBe(true);
  });

  test.each([
    'https://calendar.google.com/calendar/ical/synthetic/public/basic.ics',
    'https://calendar.google.com/calendar/ical/synthetic/public/basic?cid=example',
    'https://calendar.google.com/calendar/u/0/example.ics?cid=example',
    'https://calendar.google.com/example.ics?download=1',
    'https://calendar.google.com/calendar',
    'https://calendar.google.com/calendar#cid=synthetic-calendar',
    'https://calendar.google.com/calendar?CID=synthetic-calendar',
    'https://calendar.google.com.evil.invalid/calendar?cid=example',
    'https://sub.calendar.google.com/calendar?cid=example',
    'https://calendar.google.com@unrelated.invalid/calendar?cid=example',
    'https://example.invalid/calendar/u/0/r',
    'not a URL',
    '/calendar/u/0/r?cid=example',
    '',
  ])('does not reject a feed, another origin, or malformed input: %s', (url) => {
    expect(isGoogleCalendarWebLink(url)).toBe(false);
  });
});
