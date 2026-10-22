import { Gap, outcome, pinGaps, Scenario, today } from './burn4-harness';

const titles = [
  'calendar page loads in day view with notes button',
  'toggle notes panel via sticky note button in day view',
  'calendar notes API returns expected shape',
  'upsert and delete a calendar note via API',
  'calendar notes require date range params',
  'notes button not visible in month view',
];

describe('calendar notes workflows in an isolated date-keyed store', () => {
  test.each(titles)('%s', async title => {
    const unrelated = { date: '2026-12-30', content: 'Unrelated synthetic note' };
    const scenario = new Scenario('calendar-notes', { notes: [unrelated] });
    await scenario.run(title);
    expect(scenario.authLog).toEqual(['discover', 'login', 'logout']);
    expect(scenario.setupPage.closed).toBe(true);
    expect(scenario.page.notes.get(unrelated.date)).toEqual(unrelated);
    if (title === titles[0] || title === titles[1]) expect(scenario.page.view).toBe('Day');
    if (title === titles[1]) {
      expect(scenario.page.notesActive).toBe(true);
      await expect(scenario.page.locator('[data-testid="calendar-notes"]').isVisible()).resolves.toBe(true);
    }
    if (title === titles[3]) {
      expect(scenario.page.notes.has(today)).toBe(false);
      expect(scenario.page.requests.map(req => req.method)).toEqual(['PUT', 'GET', 'PUT', 'GET']);
      expect(scenario.page.requests[0]?.data?.date).toBe(today);
      expect(scenario.page.requests[2]?.data?.content).toBe('');
    }
    if (title === titles[5]) expect(scenario.page.view).toBe('Month');
  });

  test.each([
    [titles[2]!, 'GET', '/api/calendar-notes?', 500, {}],
    [titles[2]!, 'GET', '/api/calendar-notes?', 200, {}],
    [titles[2]!, 'GET', '/api/calendar-notes?', 200, { notes: 'wrong shape' }],
    [titles[3]!, 'PUT', '/api/calendar-notes', 500, {}],
    [titles[3]!, 'PUT', '/api/calendar-notes', 200, { note: { date: today, content: 'wrong content' } }],
    [titles[4]!, 'GET', '/api/calendar-notes', 200, { notes: [] }],
  ] as const)('rejects failed status or corrupt shape in %s', async (title, method, path, status, body) => {
    const scenario = new Scenario('calendar-notes', { fault: { method, path, status, body } });
    await expect(scenario.run(title)).rejects.toThrow();
    expect(scenario.authLog.at(-1)).toBe('logout');
  });

  test('toggle rejects a missing notes panel when styling is also inactive', async () => {
    const scenario = new Scenario('calendar-notes', { notesMissing: true, notesStyle: 'none' });
    await expect(scenario.run(titles[1]!)).rejects.toThrow('toBeTruthy');
  });

  test('notes registry preserves all six tests and lifecycle hooks without helper execution', () => {
    const scenario = new Scenario('calendar-notes');
    expect([...scenario.tests.keys()]).toEqual(titles);
    expect(Object.values(scenario.hooks).map(hooks => hooks.length)).toEqual([1, 1, 1]);
    expect(scenario.imports).toEqual(['@playwright/test', './helpers/auth']);
  });
});

const gaps: Gap[] = [
  {
    name: 'note CRUD destroys a pre-existing shared daily note', matcher: 'toEqual',
    async arrange() {
      const original = { date: today, content: 'Preserve this synthetic household note' };
      const scenario = new Scenario('calendar-notes', { notes: [original] });
      await scenario.run(titles[3]!);
      return {
        current() {
          expect(scenario.page.notes.has(today)).toBe(false);
          expect(scenario.page.requests[0]?.method).toBe('PUT');
        },
        contract: () => expect(scenario.page.notes.get(today)).toEqual(original),
      };
    },
  },
  ...['transport', 'wrong persisted content'].map(mode => ({
    name: `note CRUD leaves its mutation after ${mode} verification failure`, matcher: 'toBe',
    async arrange() {
      const scenario = new Scenario('calendar-notes', {
        fault: { method: 'GET', path: '/api/calendar-notes?', ...(mode === 'transport'
          ? { error: 'synthetic read failure' }
          : { status: 200, body: { notes: [{ date: today, content: 'wrong content' }] } }) },
      });
      const result = await outcome(scenario, titles[3]!);
      return {
        current() {
          expect(result.error).toBeDefined();
          if (mode === 'transport') expect((result.error as Error).message).toBe('synthetic read failure');
          else expect((result.error as Error).message).toContain('toBe');
          expect(scenario.page.notes.get(today)?.content).toMatch(/^E2E Note /);
          expect(scenario.authLog.at(-1)).toBe('logout');
          expect(scenario.page.requests.map(req => req.method)).toEqual(['PUT', 'GET']);
        },
        contract: () => expect(scenario.page.notes.has(today)).toBe(false),
      };
    },
  })),
  ...(['state', 'class'] as const).map(style => ({
    name: `notes toggle accepts ${style} styling while the panel is absent`, matcher: 'toBeDefined',
    async arrange() {
      const scenario = new Scenario('calendar-notes', { notesMissing: true, notesStyle: style });
      const result = await outcome(scenario, titles[1]!);
      return {
        async current() {
          expect(result.error).toBeUndefined();
          expect(scenario.page.notesActive).toBe(true);
          await expect(scenario.page.locator('[data-testid="calendar-notes"]').isVisible()).resolves.toBe(false);
        },
        contract: () => expect(result.error).toBeDefined(),
      };
    },
  })),
  {
    name: 'notes month absence callback passes without entering Month', matcher: 'toBeDefined',
    async arrange() {
      const scenario = new Scenario('calendar-notes', { hidden: ['Month', 'notes-button'] });
      const result = await outcome(scenario, titles[5]!);
      return {
        current() {
          expect(result.error).toBeUndefined();
          expect(scenario.page.view).toBe('Week');
        },
        contract: () => expect(result.error).toBeDefined(),
      };
    },
  },
  {
    name: 'notes setup leaks its temporary page after discovery failure', matcher: 'toBe',
    async arrange() {
      const scenario = new Scenario('calendar-notes', { discoveryError: true });
      let error: unknown;
      try { await scenario.hook('beforeAll'); } catch (caught) { error = caught; }
      return {
        current: () => expect((error as Error).message).toBe('synthetic discovery failure'),
        contract: () => expect(scenario.setupPage.closed).toBe(true),
      };
    },
  },
];

pinGaps(gaps);
