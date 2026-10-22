import { loadVisualHarness, type CalendarPrefs, type ClientFlags } from './burn4-visual-harness';

const clientCases: [string, ClientFlags | undefined, string, string][] = [
  ['omitted options', undefined, 'light', 'false'],
  ['theme only', { theme: 'dark' }, 'dark', 'false'],
  ['performance only', { perfMode: true }, 'light', 'true'],
  ['explicit light and disabled performance', { theme: 'light', perfMode: false }, 'light', 'false'],
  ['explicit dark and enabled performance', { theme: 'dark', perfMode: true }, 'dark', 'true'],
];
const calendarCases: [string, CalendarPrefs, string, string][] = [
  ['defaults', { viewType: 'agenda' }, 'inline', '2'],
  ['explicit cards and four weeks', { viewType: 'multiWeek', displayMode: 'cards', weekCount: 4 }, 'cards', '4'],
  ['display only', { viewType: 'month', displayMode: 'cards' }, 'cards', '2'],
  ['week count only', { viewType: 'week', weekCount: 1 }, 'inline', '1'],
];

describe('burn4 exact extracted visual helper bodies', () => {
  test.each(clientCases)('client flags execute their actual storage callback: %s', async (_name, options, theme, perf) => {
    const harness = loadVisualHarness(false);
    const page = harness.makePage();
    const originalOptions = options ? { ...options } : undefined;
    await harness.helpers.setClientFlags(page, options);
    expect(page.storage.size).toBe(0);
    page.executeInitScripts();
    expect(Object.fromEntries(page.storage)).toEqual({
      'prism-theme': theme, 'prism-perf-mode': perf, 'prism:auto-hide-ui': 'false',
    });
    expect(page.initArguments).toEqual([[theme, perf === 'true']]);
    expect(options).toEqual(originalOptions);
  });

  test.each(calendarCases)('calendar preferences execute their actual storage callback: %s', async (_name, options, display, weeks) => {
    const harness = loadVisualHarness(false);
    const page = harness.makePage();
    const originalOptions = { ...options };
    await harness.helpers.setCalendarPrefs(page, options);
    expect(page.storage.size).toBe(0);
    page.executeInitScripts();
    expect(Object.fromEntries(page.storage)).toEqual({
      'prism-calendar-view-type': options.viewType,
      'prism-calendar-display-mode': display,
      'prism-calendar-week-count': weeks,
    });
    expect(page.initArguments).toEqual([[options.viewType, display, Number(weeks)]]);
    expect(options).toEqual(originalOptions);
  });

  test('preference callbacks update their own keys and preserve unrelated page state', async () => {
    const harness = loadVisualHarness(false);
    const page = harness.makePage();
    page.storage.set('unrelated-preference', 'keep');
    page.storage.set('prism-theme', 'old');
    await harness.helpers.setClientFlags(page, { theme: 'dark' });
    await harness.helpers.setCalendarPrefs(page, { viewType: 'month', displayMode: 'cards', weekCount: 3 });
    page.executeInitScripts();
    expect(page.storage.get('unrelated-preference')).toBe('keep');
    expect(page.storage.get('prism-theme')).toBe('dark');
    expect(page.storage.get('prism-calendar-week-count')).toBe('3');
    expect(page.storage.size).toBe(7);
  });

  test('dynamic masks are the three intended locators belonging to the supplied page', () => {
    const harness = loadVisualHarness(false);
    const page = harness.makePage();
    const masks = harness.helpers.dynamicMasks(page);
    expect(masks.map((mask) => mask.selector)).toEqual([
      '[data-widget="Clock"]', '[data-widget="Weather"]', '[data-widget="Photo"]',
    ]);
    expect(masks).toEqual(page.locators);
    expect(masks.every((mask) => mask.owner === page)).toBe(true);
    expect(page.events).toEqual([]);
    expect(page.storage.size).toBe(0);
  });
});
