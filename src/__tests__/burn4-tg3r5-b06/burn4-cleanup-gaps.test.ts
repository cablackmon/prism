import { fakePage, fixedClock, loadCleanup } from './burn4-cleanup-harness';

const direct = (globalThis as typeof globalThis & { burn4DirectGap?: boolean }).burn4DirectGap === true;
const gap = direct ? test : test.failing;

gap('KNOWN GAP: event cleanup shifts local calendar boundaries one day earlier east of UTC', async () => {
  const cleanup = loadCleanup(fixedClock(2026, 0, 15, 330));
  const page = fakePage({ events: [] });
  await cleanup.deleteEventByTitle(page, 'Target fixture');
  expect(page.request.get.mock.calls).toEqual([
    ['/api/events?startDate=2025-12-01&endDate=2026-02-28'],
  ]);
});
