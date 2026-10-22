import { mealDate } from '@/lib/utils/mealDate';

describe('burn4 meal dates at calendar boundaries', () => {
  // Existing tests already enumerate weekdays. These use exact dates at boundaries.
  test.each([
    ['2026-12-31', 'friday', '2027-01-01'],
    ['2026-12-31', 'wednesday', '2027-01-06'],
    ['2024-02-28', 'thursday', '2024-02-29'],
    ['2024-02-28', 'friday', '2024-03-01'],
    ['2025-02-28', 'saturday', '2025-03-01'],
    ['2000-02-28', 'tuesday', '2000-02-29'],
    ['2100-02-28', 'monday', '2100-03-01'],
    ['2026-04-30', 'friday', '2026-05-01'],
    ['2026-03-07', 'monday', '2026-03-09'],
    ['2026-10-31', 'monday', '2026-11-02'],
  ])('%s resolves %s to %s', (weekOf, dayOfWeek, expected) => {
    expect(mealDate(weekOf, dayOfWeek)).toBe(expected);
  });

  test('keeps a same-day year-end anchor rather than moving it into the next week', () => {
    expect(mealDate('2026-12-31', 'thursday')).toBe('2026-12-31');
  });

  test.each(['', 'Friday', 'fri', 'friday '])(
    'returns the exact anchor for an unknown day name %j',
    (dayOfWeek) => {
      expect(mealDate('2026-12-31', dayOfWeek)).toBe('2026-12-31');
    },
  );

  test('returns an unknown-day anchor verbatim even when the anchor is not a valid date', () => {
    expect(mealDate('not-a-calendar-date', 'unknown')).toBe('not-a-calendar-date');
  });

  test.each(['not-a-calendar-date', '2026-02-30'])('rejects an invalid anchor %j for a known weekday', (weekOf) => {
    expect(() => mealDate(weekOf, 'monday')).toThrow(RangeError);
  });
});
