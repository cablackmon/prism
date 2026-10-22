import { scenarioCases } from './burn4-visual-cases';
import { loadVisualHarness, SkippedScenario, type Action } from './burn4-visual-harness';

const masks = ['Clock', 'Weather', 'Photo'].map((name) => `[data-widget="${name}"]`);

describe('burn4 registered visual scenario behavior', () => {
  test('the independent scenario inventory covers every registered callback exactly once', () => {
    const harness = loadVisualHarness();
    expect(scenarioCases).toHaveLength(34);
    expect(new Set(scenarioCases.map((entry) => entry.name)).size).toBe(34);
    expect(harness.scenarios.map((entry) => entry.name).sort())
      .toEqual(scenarioCases.map((entry) => entry.name).sort());
    expect(harness.useOptions).toEqual([{
      contextOptions: { reducedMotion: 'reduce' }, viewport: { width: 1920, height: 1080 },
    }]);
  });

  test.each(scenarioCases)('$name navigates, configures preferences and records its screenshot', async (entry) => {
    const harness = loadVisualHarness();
    const page = await harness.run(entry.name);
    expect(page.routes).toHaveLength(1);
    const url = new URL(page.routes[0] ?? '', 'https://burn4.invalid');
    expect(url.pathname).toBe(entry.path);
    // The six subsection query selectors have separate intended KNOWN GAP assertions.
    if (entry.section && !entry.subsection) expect(url.searchParams.get('section')).toBe(entry.section);
    expect(page.screenshots).toHaveLength(1);
    const expectedStorage: Record<string, string> = {
      'prism-theme': entry.theme,
      'prism-perf-mode': String(entry.perfMode ?? false),
      'prism:auto-hide-ui': 'false',
    };
    if (entry.calendar) Object.assign(expectedStorage, {
      'prism-calendar-view-type': entry.calendar.viewType,
      'prism-calendar-display-mode': entry.calendar.displayMode,
      'prism-calendar-week-count': String(entry.calendar.weekCount),
    });
    expect(page.screenshots[0]).toEqual({
      name: entry.snapshot,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      fullPage: false,
      ...(entry.masks ? { maskSelectors: masks } : {}),
      storage: expectedStorage,
      viewport: entry.viewport ?? { width: 1920, height: 1080 },
    });
    const actions: Action[] = [
      ...(entry.viewport ? ['viewport' as const] : []),
      'initScript',
      ...(entry.calendar ? ['initScript' as const] : []),
      ...(entry.login ? ['login' as const] : []),
      'goto', 'networkidle',
      ...(entry.modal ? ['click' as const, 'selector' as const] : []),
      'settle', 'screenshot',
    ];
    expect(page.events.map((event) => [event.action, event.phase])).toEqual(
      actions.flatMap((action) => [[action, 'start'], [action, 'finish']]),
    );
    expect(page.events.find((event) => event.action === 'settle')?.duration).toBe(entry.settle ?? 800);
    if (entry.modal) {
      expect(page.events.find((event) => event.action === 'click')?.selector).toBe(entry.modal.click);
      expect(page.events.find((event) => event.action === 'selector')?.selector).toBe(entry.modal.selector);
    }
    expect(harness.resetAttempts()).toBe(0);
    expect(harness.commandAttempts()).toBe(0);

    const disabled = loadVisualHarness(false);
    const blockedPage = disabled.makePage();
    await expect(disabled.run(entry.name, blockedPage)).rejects.toBeInstanceOf(SkippedScenario);
    expect(blockedPage.events).toEqual([]);
    expect(blockedPage.screenshots).toEqual([]);
    expect(blockedPage.locators).toEqual([]);
    expect(blockedPage.routes).toEqual([]);
    expect(blockedPage.storage.size).toBe(0);
    expect(disabled.environmentKeys()).toEqual([]);
  });

  test('an unconfigured lifecycle does no reset, command or auth setup work', () => {
    const harness = loadVisualHarness(false);
    expect(harness.beforeAll()).toBeUndefined();
    expect(harness.resetAttempts()).toBe(0);
    expect(harness.commandAttempts()).toBe(0);
    expect(harness.environmentKeys()).toEqual([]);
  });

  test('an enabled lifecycle is denied at reset before seeded-parent lookup can run', () => {
    const harness = loadVisualHarness();
    expect(() => harness.beforeAll()).toThrow(harness.deniedSetup);
    expect(harness.resetAttempts()).toBe(1);
    expect(harness.commandAttempts()).toBe(0);
    expect(harness.environmentKeys()).toEqual(['E2E_HAS_TEST_DB']);
  });

  test('two synthetic pages keep independently executed storage callbacks isolated', async () => {
    const harness = loadVisualHarness();
    const dark = await harness.run('dashboard perf-mode - dark');
    const light = await harness.run('mobile calendar agenda - light');
    expect(dark.storage.get('prism-theme')).toBe('dark');
    expect(dark.storage.get('prism-perf-mode')).toBe('true');
    expect(dark.storage.has('prism-calendar-view-type')).toBe(false);
    expect(light.storage.get('prism-theme')).toBe('light');
    expect(light.storage.get('prism-perf-mode')).toBe('false');
    expect(light.storage.get('prism-calendar-view-type')).toBe('agenda');
  });
});
