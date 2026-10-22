import { prepared, ScenarioHarness } from './burn4-harness';
import { expectedGap, gaps } from './burn4-known-gaps';

const titles = [
  'settings page loads with section navigation',
  'clicking section buttons navigates between settings sections',
  'family members section shows member list',
  'about section shows app version',
] as const;

describe('original settings registration and lifecycle', () => {
  test('captures four scenarios and each lifecycle hook through only inert imports', () => {
    const harness = new ScenarioHarness('settings');
    expect(harness.suiteName).toBe('Settings');
    expect([...harness.scenarios.keys()]).toEqual(titles);
    expect(harness.hooks.beforeAll).toHaveLength(1);
    expect(harness.hooks.beforeEach).toHaveLength(1);
    expect(harness.hooks.afterEach).toHaveLength(1);
    expect(harness.imports).toEqual(['@playwright/test', './helpers/auth']);
  });

  test('discovers parent and members on the temporary page, closes it and uses the cached parent', async () => {
    const harness = new ScenarioHarness('settings');
    harness.parent = { id: 'another-parent', name: 'Another Fixture Parent' };
    await harness.hook('beforeAll');
    expect(harness.events).toEqual(['newPage', 'getFirstParent', 'getFamilyMembers', 'close:setup']);
    expect(harness.closedPages).toEqual([harness.setupPage]);
    await harness.hook('beforeEach');
    expect(harness.events.at(-1)).toBe('login:Another Fixture Parent');
    await harness.hook('afterEach');
    expect(harness.events.at(-1)).toBe('logout');
  });

  test.each(['newPage', 'getFirstParent', 'getFamilyMembers', 'close:setup'])(
    'does not swallow prerequisite failure at %s', async (operation) => {
      const harness = new ScenarioHarness('settings');
      const failure = new Error(`synthetic ${operation}`);
      harness.failures.set(operation, failure);
      await expect(harness.hook('beforeAll')).rejects.toBe(failure);
      expect(harness.events.at(-1)).toBe(operation);
    },
  );

  test('beforeEach exposes login failure', async () => {
    const harness = await prepared('settings');
    const failure = new Error('synthetic login failure');
    harness.failures.set('login:Fixture Parent', failure);
    await expect(harness.hook('beforeEach')).rejects.toBe(failure);
    expect(harness.events).toEqual(['login:Fixture Parent']);
  });

  test('afterEach exposes logout failure', async () => {
    const harness = await prepared('settings');
    const failure = new Error('synthetic logout failure');
    harness.failures.set('logout', failure);
    await expect(harness.hook('afterEach')).rejects.toBe(failure);
    expect(harness.events).toEqual(['logout']);
  });
});

describe('original settings navigation prerequisites', () => {
  test.each(titles)('%s visits settings and waits before checking content', async (title) => {
    const harness = await prepared('settings');
    await harness.scenario(title);
    expect(harness.events.slice(0, 2)).toEqual(['goto:/settings', 'load:networkidle']);
  });

  test.each(titles)('%s propagates navigation failure', async (title) => {
    const harness = await prepared('settings');
    const failure = new Error('synthetic settings navigation failure');
    harness.failures.set('goto:/settings', failure);
    await expect(harness.scenario(title)).rejects.toBe(failure);
    expect(harness.events).toEqual(['goto:/settings']);
    expect(harness.visibility).toHaveLength(0);
  });

  test.each(titles)('%s propagates load-state failure', async (title) => {
    const harness = await prepared('settings');
    const failure = new Error('synthetic settings load failure');
    harness.failures.set('load:networkidle', failure);
    await expect(harness.scenario(title)).rejects.toBe(failure);
    expect(harness.events).toEqual(['goto:/settings', 'load:networkidle']);
    expect(harness.visibility).toHaveLength(0);
  });
});

describe('original settings section assertions', () => {
  test('requires the settings heading and visible Family Members button', async () => {
    const harness = await prepared('settings');
    await harness.scenario(titles[0]);
    expect(harness.events.slice(2)).toEqual([
      'contains:selector:h1', 'visible:role:button:/Family Members/i',
    ]);
    expect(harness.visibility).toEqual([
      { query: 'role:button:/Family Members/i', timeout: 10000, first: false },
    ]);
  });

  test('incorrect heading fails before checking navigation', async () => {
    const harness = await prepared('settings');
    harness.heading = 'Wrong Screen';
    await expect(harness.scenario(titles[0])).rejects.toThrow('expected text Settings');
    expect(harness.visibility).toHaveLength(0);
  });

  test('hidden Family Members navigation fails', async () => {
    const harness = await prepared('settings');
    harness.hidden.add('Family Members-button');
    await expect(harness.scenario(titles[0])).rejects.toThrow('expected visible Family Members-button');
  });

  test.each(['Dark theme', 'Light appearance', 'THEME OPTIONS'])(
    'Display click reveals matching theme text: %s', async (theme) => {
      const harness = await prepared('settings');
      harness.themeText = theme;
      await harness.scenario(titles[1]);
      expect(harness.section).toBe('Display');
      expect(harness.events.slice(2)).toEqual([
        'visible:role:button:/Display/i', 'click:role:button:/Display/i',
        'visible:text:/Theme|Dark|Light/i',
      ]);
      expect(harness.visibility.map(({ timeout, first }) => [timeout, first])).toEqual([
        [10000, false], [5000, true],
      ]);
    },
  );

  test.each(['hidden', 'missing'] as const)('Display rejects %s theme content', async (kind) => {
    const harness = await prepared('settings');
    if (kind === 'hidden') harness.hidden.add('theme');
    else harness.themeText = 'Unrelated section';
    await expect(harness.scenario(titles[1])).rejects.toThrow();
    expect(harness.section).toBe('Display');
  });

  test.each([
    [titles[1], 'Display', 'Display-button'],
    [titles[3], 'About', 'About-button'],
  ])('%s requires its section control to be visible', async (title, _section, key) => {
    const harness = await prepared('settings');
    harness.hidden.add(key);
    await expect(harness.scenario(title)).rejects.toThrow(`expected visible ${key}`);
    expect(harness.section).toBe('Family Members');
  });

  test.each([
    [titles[1], 'click:role:button:/Display/i'],
    [titles[2], 'click:role:button:/Family Members/i'],
    [titles[3], 'click:role:button:/About/i'],
  ])('%s exposes a failed click', async (title, operation) => {
    const harness = await prepared('settings');
    const failure = new Error('synthetic section click failure');
    harness.failures.set(operation, failure);
    await expect(harness.scenario(title)).rejects.toBe(failure);
    expect(harness.events.at(-1)).toBe(operation);
  });

  test('family list checks both cached names in content, with first-match disambiguation', async () => {
    const harness = await prepared('settings');
    await harness.scenario(titles[2]);
    expect(harness.events[2]).toBe('click:role:button:/Family Members/i');
    expect(harness.visibility).toEqual([
      { query: 'selector:.font-medium:Fixture Parent', timeout: 5000, first: true },
      { query: 'selector:.font-medium:Fixture Child', timeout: 5000, first: true },
    ]);
  });

  test.each([0, 1])('missing visible family member at index %s fails', async (index) => {
    const harness = await prepared('settings');
    harness.hidden.add(`member-${index}`);
    await expect(harness.scenario(titles[2])).rejects.toThrow(`expected visible member-${index}`);
  });

  test('cached one-member fixture produces one required content assertion', async () => {
    const harness = new ScenarioHarness('settings');
    harness.members = [harness.parent];
    harness.displayedMembers = [harness.parent.name];
    await harness.hook('beforeAll');
    await harness.scenario(titles[2]);
    expect(harness.visibility).toHaveLength(1);
  });

  test('original family sample is capped at two, with no invented third-member requirement', async () => {
    const harness = new ScenarioHarness('settings');
    harness.members.push({ id: 'third-fixture', name: 'Third Fixture Member' });
    await harness.hook('beforeAll');
    await harness.scenario(titles[2]);
    expect(harness.visibility).toHaveLength(2);
    expect(harness.visibility.some(({ query }) => query.includes('Third Fixture'))).toBe(false);
  });

  test('empty member fixture is characterized as vacuous, not declared a new product policy', async () => {
    const harness = new ScenarioHarness('settings');
    harness.members = [];
    harness.displayedMembers = [];
    await harness.hook('beforeAll');
    await harness.scenario(titles[2]);
    expect(harness.visibility).toHaveLength(0);
  });

  test('About click is required before showing a dotted numeric version', async () => {
    const harness = await prepared('settings');
    await harness.scenario(titles[3]);
    expect(harness.section).toBe('About');
    expect(harness.events.slice(2)).toEqual([
      'visible:role:button:/About/i', 'click:role:button:/About/i', 'visible:text:/\\d+\\.\\d+\\.\\d+/',
    ]);
    expect(harness.visibility.map(({ timeout, first }) => [timeout, first])).toEqual([
      [10000, false], [5000, true],
    ]);
  });

  test.each(['hidden', 'unmatched'] as const)('About rejects a %s version', async (kind) => {
    const harness = await prepared('settings');
    if (kind === 'hidden') harness.hidden.add('version');
    else harness.versionText = 'release unknown';
    await expect(harness.scenario(titles[3])).rejects.toThrow();
  });
});

for (const gap of gaps.filter((entry) => entry.source === 'settings')) {
  test.failing(`KNOWN GAP ${gap.id}`, () => expectedGap(gap));
}
