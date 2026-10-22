import { fakePage, fixedClock, loadCleanup } from './burn4-cleanup-harness';

test.each([
  { year: 2026, month: 0, day: 15, start: '2025-12-01', end: '2026-02-28' },
  { year: 2026, month: 11, day: 31, start: '2026-11-01', end: '2027-01-31' },
  { year: 2024, month: 0, day: 31, start: '2023-12-01', end: '2024-02-29' },
  { year: 2024, month: 1, day: 29, start: '2024-01-01', end: '2024-03-31' },
  { year: 2026, month: 2, day: 1, start: '2026-02-01', end: '2026-04-30' },
])('event cleanup covers adjacent months for $year/$month/$day', async ({ year, month, day, start, end }) => {
  const cleanup = loadCleanup(fixedClock(year, month, day));
  const page = fakePage({ events: [] });
  await expect(cleanup.deleteEventByTitle(page, 'Target fixture')).resolves.toBe(false);
  expect(page.request.get.mock.calls).toEqual([[`/api/events?startDate=${start}&endDate=${end}`]]);
  expect(page.request.delete).not.toHaveBeenCalled();
});

test('west-of-UTC local midnight retains the calendar boundary dates', async () => {
  const cleanup = loadCleanup(fixedClock(2026, 0, 15, -360));
  const page = fakePage({ events: [{ id: 'local-event', title: 'Target fixture' }] });
  await expect(cleanup.deleteEventByTitle(page, 'Target fixture')).resolves.toBe(true);
  expect(page.request.get.mock.calls).toEqual([['/api/events?startDate=2025-12-01&endDate=2026-02-28']]);
  expect(page.request.delete.mock.calls).toEqual([['/api/events/local-event']]);
});
