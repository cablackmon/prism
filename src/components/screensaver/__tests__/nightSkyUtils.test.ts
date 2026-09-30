
import type { CalendarEvent } from '@/types/calendar';
import {
  auroraPalette,
  cometTimeLabel,
  eventClockLabel,
  isExpectedNightSkyFrameUrl,
  isExpectedNightSkyResponse,
  moonPhase,
  msUntilNightSkyBoundary,
  NIGHT_SKY_FRAME_EVENT_LIMIT,
  nightSkyFrameEvents,
  nightSkyEvents,
  truncateCometDescription,
  tomorrowEvents,
} from '../nightSkyUtils';

const event = (id: string, start: string, description?: string): CalendarEvent => ({
  id,
  title: id,
  description,
  startTime: new Date(start),
  endTime: new Date(new Date(start).getTime() + 3600000),
  allDay: false,
  color: '#3b82f6',
  calendarName: 'Family',
  calendarId: 'family',
});

const allDayEvent = (id: string, date: string): CalendarEvent => ({
  ...event(id, `${date}T00:00:00Z`),
  endTime: new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000),
  allDay: true,
});

describe('Night Sky schedule model', () => {
  const now = new Date('2026-08-29T12:00:00-05:00');

  it('keeps the next fourteen days and orders them', () => {
    const result = nightSkyEvents(
      [
        event('later', '2026-09-03T10:00:00-05:00'),
        event('past', '2026-08-28T10:00:00-05:00'),
        event('next', '2026-08-29T13:00:00-05:00'),
        event('far', '2026-09-20T10:00:00-05:00'),
      ],
      now
    );
    expect(result.map(({ id }) => id)).toEqual(['next', 'later']);
  });

  it('finds tomorrow in local calendar time', () => {
    const result = tomorrowEvents(
      [
        event('today', '2026-08-29T18:00:00-05:00'),
        event('second', '2026-08-30T12:00:00-05:00'),
        event('first', '2026-08-30T08:00:00-05:00'),
      ],
      now
    );
    expect(result.map(({ id }) => id)).toEqual(['first', 'second']);
  });

  it('maps light, medium, and busy days to distinct palettes', () => {
    expect(auroraPalette(3)[0]).toBe('#10b981');
    expect(auroraPalette(4)[0]).toBe('#0d9488');
    expect(auroraPalette(8)[0]).toBe('#7c3aed');
  });

  it('computes known new and full moon illumination', () => {
    expect(moonPhase(new Date('2000-01-06T18:14:00Z')).illumination).toBeCloseTo(0, 4);
    expect(moonPhase(new Date('2000-01-21T12:36:00Z')).illumination).toBeCloseTo(1, 2);
  });

  it('treats a null description from the events API as empty', () => {
    expect(truncateCometDescription(null)).toBe('');
    const nullDescription = { ...event('next', '2026-08-29T13:00:00-05:00'), description: null };
    expect(
      nightSkyFrameEvents([nullDescription as unknown as CalendarEvent], now)[0]!.description
    ).toBe('');
  });

  it('collapses whitespace and caps comet descriptions at sixty characters', () => {
    expect(truncateCometDescription('  Pack   the telescope  ')).toBe('Pack the telescope');
    const result = truncateCometDescription('A'.repeat(80));
    expect(result).toHaveLength(60);
    expect(result.endsWith('…')).toBe(true);
  });

  it('serializes only upcoming frame data and never sends a full long description', () => {
    const result = nightSkyFrameEvents(
      [
        event('next', '2026-08-29T13:00:00-05:00', 'B'.repeat(90)),
        event('past', '2026-08-28T10:00:00-05:00', 'already over'),
      ],
      now
    )[0]!;

    expect(result.id).toBe('next');
    expect(result.startTime).toBe('2026-08-29T18:00:00.000Z');
    expect(result.description).toHaveLength(60);
    expect(result.description).toBe(`${'B'.repeat(59)}…`);
  });

  it("keeps tomorrow's comet event when today alone fills the payload", () => {
    const today = Array.from({ length: 30 }, (_, index) =>
      event(`today-${index}`, new Date(now.getTime() + (index + 1) * 60000).toISOString())
    );
    const result = nightSkyFrameEvents(
      [...today, event('tomorrow', '2026-08-30T09:00:00-05:00')],
      now
    );

    expect(result).toHaveLength(NIGHT_SKY_FRAME_EVENT_LIMIT);
    expect(result.filter(({ comet }) => comet).map(({ id }) => id)).toEqual(['tomorrow']);
    expect(result[result.length - 1]!.id).toBe('tomorrow');
    expect(result.map(({ id }) => id).slice(0, -1)).toEqual(
      today.slice(0, NIGHT_SKY_FRAME_EVENT_LIMIT - 1).map(({ id }) => id)
    );
  });

  it('falls back to the next event for the comet when tomorrow is empty', () => {
    const result = nightSkyFrameEvents(
      [event('later', '2026-09-01T10:00:00-05:00'), event('next', '2026-08-29T13:00:00-05:00')],
      now
    );
    expect(result.map(({ id, comet }) => [id, comet])).toEqual([
      ['next', true],
      ['later', false],
    ]);
  });
});

describe('Night Sky all-day events', () => {
  const now = new Date('2026-08-29T12:00:00-05:00');

  it('labels an all-day event by its own date with no invented time', () => {
    expect(cometTimeLabel(allDayEvent('fair', '2026-08-30'))).toBe('Sun · All day');
    expect(cometTimeLabel(event('game', '2026-08-30T15:30:00-05:00'))).toBe('Sun 3:30 PM');
    expect(eventClockLabel(allDayEvent('fair', '2026-08-30'))).toBe('All day');
  });

  it("picks tomorrow and today's all-day events on the household's display day", () => {
    // 23:30 Saturday in Los Angeles is already Sunday on this Central-time device.
    const lateSaturday = new Date('2026-08-29T23:30:00-07:00');
    const prefs = { timeFormat: '12h' as const, timeZone: 'America/Los_Angeles' };
    const sunday = event('sunday', '2026-08-30T08:00:00-07:00');
    // Sunday 23:00 in Los Angeles is Monday 01:00 on the device.
    const sundayLate = event('sunday-late', '2026-08-30T23:00:00-07:00');
    const monday = event('monday', '2026-08-31T08:00:00-07:00');
    const saturdayAllDay = allDayEvent('saturday', '2026-08-29');
    expect(
      tomorrowEvents([monday, sundayLate, sunday], lateSaturday, prefs.timeZone).map(({ id }) => id)
    ).toEqual(['sunday', 'sunday-late']);
    const framed = nightSkyFrameEvents([monday, sunday, saturdayAllDay], lateSaturday, prefs);
    expect(framed.find(({ comet }) => comet)!.id).toBe('sunday');
    expect(framed.map(({ id }) => id)).toContain('saturday');
    expect(nightSkyEvents([saturdayAllDay], lateSaturday, prefs.timeZone)).toHaveLength(1);
  });

  it("follows the board's 24-hour format and display timezone", () => {
    const game = event('game', '2026-08-30T23:30:00-05:00');
    expect(cometTimeLabel(game, { timeFormat: '24h' })).toBe('Sun 23:30');
    expect(cometTimeLabel(game, { timeFormat: '24h', timeZone: 'America/New_York' })).toBe(
      'Mon 00:30'
    );
    expect(eventClockLabel(game, { timeFormat: '24h', timeZone: 'UTC' })).toBe('04:30');
    const [framed] = nightSkyFrameEvents([game], now, { timeFormat: '24h' });
    expect(framed!.when).toBe('Sun 23:30');
  });

  it('carries the all-day flag and label into the frame payload', () => {
    const [result] = nightSkyFrameEvents([allDayEvent('fair', '2026-08-30')], now);
    expect(result).toMatchObject({ id: 'fair', allDay: true, when: 'Sun · All day', comet: true });
  });

  it("finds tomorrow's all-day event although it starts the previous local evening", () => {
    const result = tomorrowEvents(
      [allDayEvent('today', '2026-08-29'), allDayEvent('fair', '2026-08-30')],
      now
    );
    expect(result.map(({ id }) => id)).toEqual(['fair']);
  });

  it("keeps today's all-day event after its UTC end has passed locally", () => {
    const evening = new Date('2026-08-29T20:00:00-05:00');
    expect(nightSkyEvents([allDayEvent('today', '2026-08-29')], evening)).toHaveLength(1);
  });
});

describe('Night Sky dimming clock', () => {
  const at = (hour: number, minute = 0) => new Date(2026, 7, 29, hour, minute);

  it('counts down to the next midnight, 06:00 or 21:00 boundary', () => {
    expect(msUntilNightSkyBoundary(at(20, 59))).toBe(60000);
    expect(msUntilNightSkyBoundary(at(21))).toBe(3 * 3600000);
    expect(msUntilNightSkyBoundary(at(23, 30))).toBe(30 * 60000);
    expect(msUntilNightSkyBoundary(at(0))).toBe(6 * 3600000);
    expect(msUntilNightSkyBoundary(at(5))).toBe(3600000);
    expect(msUntilNightSkyBoundary(at(12))).toBe(9 * 3600000);
  });

  describe('with a display zone west of the device (Los Angeles on a Central device)', () => {
    const la = 'America/Los_Angeles';

    it('ticks at display-zone midnight when it comes before a device boundary', () => {
      // 01:10 Central is 23:10 in LA: LA midnight is 50 minutes away, device 06:00 is 4h50m away.
      expect(msUntilNightSkyBoundary(at(1, 10))).toBe(290 * 60000);
      expect(msUntilNightSkyBoundary(at(1, 10), la)).toBe(50 * 60000);
      expect(msUntilNightSkyBoundary(at(0, 30), la)).toBe(90 * 60000);
    });

    it('keeps the device boundaries when they come first', () => {
      expect(msUntilNightSkyBoundary(at(20, 59), la)).toBe(60000);
      expect(msUntilNightSkyBoundary(at(22), la)).toBe(2 * 3600000);
      expect(msUntilNightSkyBoundary(at(5), la)).toBe(3600000);
    });

    it('moves the comet to the next LA day on the display-zone tick', () => {
      const events = [event('sat', '2026-08-29T18:00:00Z'), event('sun', '2026-08-30T18:00:00Z')];
      const cometAt = (now: Date) =>
        nightSkyFrameEvents(events, now, { timeFormat: '24h', timeZone: la }).find(
          ({ comet }) => comet
        )?.id;
      const beforeTick = at(1, 10);
      const afterTick = new Date(
        beforeTick.getTime() + msUntilNightSkyBoundary(beforeTick, la) + 1000
      );
      expect(cometAt(beforeTick)).toBe('sat');
      expect(cometAt(afterTick)).toBe('sun');
    });
  });

  it('reaches display-zone midnight on a day that loses an hour in that zone', () => {
    // Nuuk springs forward at 01:00Z on 2026-03-29, so its 2026-03-28 is 23 hours long.
    const nuuk = 'America/Nuuk';
    const events = [
      event('sat', '2026-03-28T20:00:00Z'),
      event('sun', '2026-03-29T12:00:00Z'),
    ];
    const cometAt = (now: Date) =>
      nightSkyFrameEvents(events, now, { timeFormat: '24h', timeZone: nuuk }).find(
        ({ comet }) => comet
      )?.id;
    const beforeTick = new Date('2026-03-28T23:30:00Z');
    const tick = msUntilNightSkyBoundary(beforeTick, nuuk);
    expect(tick).toBe(90 * 60000);
    expect(cometAt(new Date(beforeTick.getTime() + tick + 1000))).toBe('sun');
  });

  it('follows the wall clock across a daylight-saving change', () => {
    // Central time falls back at 02:00 on 2026-11-01, so midnight to 06:00 is 7 hours.
    expect(msUntilNightSkyBoundary(new Date(2026, 10, 1, 0))).toBe(7 * 3600000);
  });
});

describe('Night Sky static asset probe', () => {
  const expectedUrl = 'https://kyst-board.fly.dev/screensaver/nightsky.html';

  it('accepts a successful response from the exact asset URL', () => {
    expect(
      isExpectedNightSkyResponse({ ok: true, redirected: false, url: expectedUrl }, expectedUrl)
    ).toBe(true);
  });

  it('rejects a followed redirect even when its final response is successful', () => {
    expect(
      isExpectedNightSkyResponse(
        {
          ok: true,
          redirected: true,
          url: 'https://kyst-board.fly.dev/auth/household?next=%2Fscreensaver%2Fnightsky.html',
        },
        expectedUrl
      )
    ).toBe(false);
  });

  it('rejects a successful response from an unexpected final URL', () => {
    expect(
      isExpectedNightSkyResponse(
        {
          ok: true,
          redirected: false,
          url: 'https://kyst-board.fly.dev/auth/household',
        },
        expectedUrl
      )
    ).toBe(false);
  });

  it('accepts an iframe that finished on the exact Night Sky asset URL', () => {
    expect(isExpectedNightSkyFrameUrl(expectedUrl, expectedUrl)).toBe(true);
  });

  it('rejects an iframe redirected to the household login after the probe', () => {
    expect(
      isExpectedNightSkyFrameUrl(
        'https://kyst-board.fly.dev/auth/household?next=%2Fscreensaver%2Fnightsky.html',
        expectedUrl
      )
    ).toBe(false);
  });
});
