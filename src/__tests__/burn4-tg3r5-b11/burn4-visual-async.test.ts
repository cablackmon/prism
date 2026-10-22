import { deferred, loadVisualHarness, type Action } from './burn4-visual-harness';

const steps: { label: string; scenario: string; action: Action; occurrence?: number }[] = [
  { label: 'client initialization', scenario: 'dashboard - light', action: 'initScript' },
  { label: 'calendar initialization', scenario: 'calendar month-cards - dark', action: 'initScript', occurrence: 2 },
  { label: 'login', scenario: 'dashboard - light', action: 'login' },
  { label: 'navigation', scenario: 'dashboard - light', action: 'goto' },
  { label: 'network readiness', scenario: 'dashboard - light', action: 'networkidle' },
  { label: 'stabilization', scenario: 'dashboard - light', action: 'settle' },
  { label: 'screenshot expectation', scenario: 'dashboard - light', action: 'screenshot' },
  { label: 'mobile viewport', scenario: 'mobile calendar agenda - light', action: 'viewport' },
  { label: 'event modal click', scenario: 'AddEventModal - light', action: 'click' },
  { label: 'event modal readiness', scenario: 'AddEventModal - light', action: 'selector' },
  { label: 'login modal readiness', scenario: 'PIN modal - dark', action: 'selector' },
];

describe('burn4 visual dependency ordering and failure propagation', () => {
  test.each(steps)('$label must finish before the scenario continues', async (entry) => {
    const harness = loadVisualHarness();
    const entered = deferred();
    const release = deferred();
    let occurrences = 0;
    let finished = false;
    const page = harness.makePage((step) => {
      if (step.action === entry.action && ++occurrences === (entry.occurrence ?? 1)) {
        entered.resolve();
        return release.promise;
      }
    });
    const pending = harness.run(entry.scenario, page).then(() => { finished = true; });
    await entered.promise;
    expect(finished).toBe(false);
    expect(page.events.at(-1)).toMatchObject({ action: entry.action, phase: 'start' });
    expect(page.screenshots).toEqual([]);
    release.resolve();
    await pending;
    expect(finished).toBe(true);
    expect(page.screenshots).toHaveLength(1);
  });

  test.each(steps)('$label failures propagate without a later screenshot', async (entry) => {
    const harness = loadVisualHarness();
    const failure = new Error('Synthetic visual dependency failure');
    let occurrences = 0;
    const page = harness.makePage((step) => {
      if (step.action === entry.action && ++occurrences === (entry.occurrence ?? 1)) throw failure;
    });
    await expect(harness.run(entry.scenario, page)).rejects.toBe(failure);
    expect(page.events.at(-1)).toMatchObject({ action: entry.action, phase: 'start' });
    expect(page.screenshots).toEqual([]);
    expect(harness.resetAttempts()).toBe(0);
    expect(harness.commandAttempts()).toBe(0);
  });

  test.each(['client', 'calendar'] as const)('%s helper waits for init-script registration', async (name) => {
    const harness = loadVisualHarness(false);
    const entered = deferred();
    const release = deferred();
    const page = harness.makePage(() => { entered.resolve(); return release.promise; });
    let finished = false;
    const pending = (name === 'client'
      ? harness.helpers.setClientFlags(page)
      : harness.helpers.setCalendarPrefs(page, { viewType: 'agenda' }))
      .then(() => { finished = true; });
    await entered.promise;
    expect(finished).toBe(false);
    expect(page.initArguments).toEqual([]);
    expect(page.storage.size).toBe(0);
    release.resolve();
    await pending;
    expect(finished).toBe(true);
    expect(page.initArguments).toHaveLength(1);
  });

  test.each(['client', 'calendar'] as const)('%s helper preserves a registration rejection', async (name) => {
    const harness = loadVisualHarness(false);
    const failure = new Error('Synthetic init-script registration failure');
    const page = harness.makePage(() => { throw failure; });
    const pending = name === 'client'
      ? harness.helpers.setClientFlags(page)
      : harness.helpers.setCalendarPrefs(page, { viewType: 'agenda' });
    await expect(pending).rejects.toBe(failure);
    expect(page.initArguments).toEqual([]);
    expect(page.storage.size).toBe(0);
  });
});
