import { Gap, outcome, parent, pinGaps, Scenario } from './burn4-harness';

const titles = [
  'create an event via API', 'create event via modal UI', 'edit an event', 'delete an event', 'toggle all-day on an event',
];

describe('event callbacks against stateful local fixtures', () => {
  test.each(titles)('%s', async title => {
    const scenario = new Scenario('event-crud');
    scenario.page.events.set('unrelated', { id: 'unrelated', title: 'Unrelated synthetic event' });
    await scenario.run(title);
    expect(scenario.setupPage.closed).toBe(true);
    expect(scenario.authLog).toEqual(['discover', 'login', 'cleanup:original', 'cleanup:edited', 'logout']);
    expect(scenario.page.events.get('unrelated')).toEqual({ id: 'unrelated', title: 'Unrelated synthetic event' });
    const created = scenario.page.events.get('event-1');
    if (title === titles[3]) expect(created).toBeUndefined();
    else {
      expect(created?.title).toMatch(/^E2E Event /);
      if (title === titles[2]) {
        expect(created?.title).toMatch(/\(edited\)$/);
        expect(created?.location).toBe('Test Location');
      }
      if (title === titles[4]) expect(created?.allDay).toBe(true);
    }
    if (title !== titles[1]) expect(scenario.page.requests[0]?.data?.createdBy).toBe(parent.id);
  });

  test.each([
    ['2026-12-31T12:00:00', '2027-01-01'],
    ['2028-02-28T12:00:00', '2028-02-29'],
    ['2026-04-30T12:00:00', '2026-05-01'],
  ])('modal tomorrow formatting crosses %s', async (time, tomorrow) => {
    const scenario = new Scenario('event-crud', { time });
    await scenario.run(titles[1]!);
    expect(scenario.page.fields.get('event-start')).toBe(`${tomorrow}T14:00`);
    expect(scenario.page.fields.get('event-end')).toBe(`${tomorrow}T15:00`);
    expect(scenario.page.dialog).toBe(false);
    expect(scenario.page.events.get('event-1')?.startTime).toBe(`${tomorrow}T14:00`);
  });

  test.each([
    [titles[0]!, 'POST', '/api/events', 500, {}],
    [titles[2]!, 'PATCH', '/api/events/event-1', 500, {}],
    [titles[3]!, 'DELETE', '/api/events/event-1', 500, {}],
    [titles[4]!, 'PATCH', '/api/events/event-1', 200, { allDay: false }],
  ] as const)('rejects broken API behavior in %s', async (title, method, path, status, body) => {
    const scenario = new Scenario('event-crud', { fault: { method, path, status, body } });
    await expect(scenario.run(title)).rejects.toThrow('toBe');
    expect(scenario.authLog.slice(-3)).toEqual(['cleanup:original', 'cleanup:edited', 'logout']);
  });

  test('delete verification rejects a resource that remains readable', async () => {
    const scenario = new Scenario('event-crud', { fault: { method: 'GET', path: '/api/events/event-1', status: 200, body: {} } });
    await expect(scenario.run(titles[3]!)).rejects.toThrow('toBe');
  });

  test('API timed event spans exactly one hour on the next local day', async () => {
    const scenario = new Scenario('event-crud');
    await scenario.run(titles[0]!);
    const event = scenario.page.events.get('event-1')!;
    const start = new Date(String(event.startTime));
    const end = new Date(String(event.endTime));
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(0);
    expect(start.getFullYear()).toBe(2027);
    expect(start.getHours()).toBe(10);
    expect(end.getTime() - start.getTime()).toBe(3_600_000);
    expect(event.allDay).toBe(false);
  });

  test('registry contains every event callback and only inert helper imports', () => {
    const scenario = new Scenario('event-crud');
    expect([...scenario.tests.keys()]).toEqual(titles);
    expect(Object.values(scenario.hooks).map(hooks => hooks.length)).toEqual([1, 1, 1]);
    expect(scenario.imports).toEqual(['@playwright/test', './helpers/auth', './helpers/cleanup']);
  });
});

const gaps: Gap[] = [
  {
    name: 'modal creation accepts a closed dialog without saving an event', matcher: 'toBeDefined',
    async arrange() {
      const scenario = new Scenario('event-crud', { modalDoesNotSave: true });
      const result = await outcome(scenario, titles[1]!);
      return {
        current() {
          expect(result.error).toBeUndefined();
          expect(scenario.page.dialog).toBe(false);
          expect(scenario.page.fields.get('event-title')).toMatch(/^E2E Event /);
          expect(scenario.page.events.size).toBe(0);
        },
        contract: () => expect(result.error).toBeDefined(),
      };
    },
  },
  ...[1, 2].map(stage => ({
    name: `event teardown abandons remaining cleanup after deletion ${stage} rejects`, matcher: 'toEqual',
    async arrange() {
      const scenario = new Scenario('event-crud', { cleanupErrorAt: stage });
      await scenario.setup();
      let error: unknown;
      try { await scenario.hook('afterEach'); } catch (caught) { error = caught; }
      return {
        current() {
          expect((error as Error).message).toBe('synthetic cleanup failure');
          expect(scenario.authLog).toHaveLength(2 + stage);
        },
        contract: () => expect(scenario.authLog).toEqual(['discover', 'login', 'cleanup:original', 'cleanup:edited', 'logout']),
      };
    },
  })),
  {
    name: 'event setup leaks its temporary page after discovery failure', matcher: 'toBe',
    async arrange() {
      const scenario = new Scenario('event-crud', { discoveryError: true });
      let error: unknown;
      try { await scenario.hook('beforeAll'); } catch (caught) { error = caught; }
      return {
        current: () => expect((error as Error).message).toBe('synthetic discovery failure'),
        contract: () => expect(scenario.setupPage.closed).toBe(true),
      };
    },
  },
  {
    name: 'event creation retains an invalid redacted pre-login parent ID', matcher: 'toBe',
    async arrange() {
      const scenario = new Scenario('event-crud', { redacted: true });
      await scenario.run(titles[0]!);
      const creator = scenario.page.requests[0]?.data?.createdBy;
      return {
        current() {
          expect(scenario.authLog.slice(0, 2)).toEqual(['discover', 'login']);
          expect(creator).toBe('');
        },
        contract: () => expect(creator === undefined || creator === parent.id).toBe(true),
      };
    },
  },
];

pinGaps(gaps);
