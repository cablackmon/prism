import type { CalendarEvent } from '@/types/calendar';
import {
  auroraPalette,
  isExpectedNightSkyFrameUrl,
  isExpectedNightSkyResponse,
  moonPhase,
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
