import { Gap, outcome, pinGaps, Scenario } from './burn4-harness';

const titles = [
  'calendar page loads with date header',
  'Today button navigates to current date',
  'prev/next buttons navigate dates',
  'view switching buttons change calendar layout',
  'add event button is visible for parents',
];

describe('calendar callbacks against a strict offline page', () => {
  test.each(titles)('%s', async title => {
    const scenario = new Scenario('calendar');
    await scenario.run(title);
    expect(scenario.authLog).toEqual(['discover', 'login', 'logout']);
    expect(scenario.setupPage.closed).toBe(true);
    expect(scenario.page.journal.slice(0, 2)).toEqual(['goto:/calendar', 'load:networkidle']);
    if (title === titles[1] || title === titles[2]) expect(scenario.page.offset).toBe(0);
    if (title === titles[3]) {
      expect(scenario.page.view).toBe('Day');
      expect(scenario.page.journal).toContain('click:Month');
      expect(scenario.page.journal).toContain('click:Day');
    }
  });

  test.each([
    ['header', titles[0]!], ['Previous', titles[0]!], ['Next', titles[0]!], ['Add Event', titles[4]!],
  ])('detects missing %s and still logs out', async (hidden, title) => {
    const scenario = new Scenario('calendar', { hidden: [hidden] });
    await expect(scenario.run(title)).rejects.toThrow('toBe');
    expect(scenario.authLog.at(-1)).toBe('logout');
  });

  test.each(['Next', 'Previous'])('navigation oracle rejects a no-op %s', async control => {
    const scenario = new Scenario('calendar', { noOp: [control] });
    await expect(scenario.run(titles[2]!)).rejects.toThrow('toBe');
    expect(scenario.authLog.at(-1)).toBe('logout');
  });

  test('callback and hook registry imports no original helper implementations', async () => {
    const scenario = new Scenario('calendar');
    expect([...scenario.tests.keys()]).toEqual(titles);
    expect(Object.values(scenario.hooks).map(hooks => hooks.length)).toEqual([1, 1, 1]);
    expect(scenario.imports).toEqual(['@playwright/test', './helpers/auth']);
    expect(() => scenario.page.locator('iframe')).toThrow('Denied selector');
    await expect(scenario.page.request.get('/api/unknown')).rejects.toThrow('Denied request');
  });
});

const gaps: Gap[] = [
  {
    name: 'Today callback accepts a no-op Today button', matcher: 'toBeDefined',
    async arrange() {
      const scenario = new Scenario('calendar', { noOp: ['Today'] });
      const result = await outcome(scenario, titles[1]!);
      return {
        current() {
          expect(result.error).toBeUndefined();
          expect(scenario.page.offset).toBe(1);
          expect(scenario.page.journal).toContain('click:Today');
        },
        contract: () => expect(result.error).toBeDefined(),
      };
    },
  },
  {
    name: 'view switching callback accepts missing Month and Day controls', matcher: 'toBeDefined',
    async arrange() {
      const scenario = new Scenario('calendar', { hidden: ['Month', 'Day'] });
      const result = await outcome(scenario, titles[3]!);
      return {
        current() {
          expect(result.error).toBeUndefined();
          expect(scenario.page.view).toBe('Week');
          expect(scenario.page.journal.some(entry => entry.startsWith('click:'))).toBe(false);
        },
        contract: () => expect(result.error).toBeDefined(),
      };
    },
  },
  {
    name: 'view switching callback accepts controls that leave the layout unchanged', matcher: 'toBeDefined',
    async arrange() {
      const scenario = new Scenario('calendar', { noOp: ['Month', 'Day'] });
      const result = await outcome(scenario, titles[3]!);
      return {
        current() {
          expect(result.error).toBeUndefined();
          expect(scenario.page.view).toBe('Week');
          expect(scenario.page.journal).toContain('click:Month');
          expect(scenario.page.journal).toContain('click:Day');
        },
        contract: () => expect(result.error).toBeDefined(),
      };
    },
  },
  {
    name: 'calendar setup leaks its temporary page after discovery failure', matcher: 'toBe',
    async arrange() {
      const scenario = new Scenario('calendar', { discoveryError: true });
      let error: unknown;
      try { await scenario.hook('beforeAll'); } catch (caught) { error = caught; }
      return {
        current() {
          expect((error as Error).message).toBe('synthetic discovery failure');
          expect(scenario.authLog).toEqual(['discover']);
        },
        contract: () => expect(scenario.setupPage.closed).toBe(true),
      };
    },
  },
];

pinGaps(gaps);
