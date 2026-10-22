import { prepared, ScenarioHarness } from './burn4-harness';
import { expectedGap, gaps } from './burn4-known-gaps';

const activation = [
  ['away mode can be activated via API', '/api/away-mode'],
  ['babysitter mode can be activated via API', '/api/babysitter-mode'],
] as const;
const overlays = [
  ['away mode overlay appears when enabled', 'away-overlay', 15000],
  ['babysitter mode overlay appears when enabled', 'babysitter-overlay', 10000],
] as const;
const disable = 'away mode can be disabled via API';

describe('original mode suite registration and lifecycle', () => {
  test('captures exactly the original five cases and two lifecycle hooks through inert imports', () => {
    const harness = new ScenarioHarness('modes');
    expect(harness.suiteName).toBe('Away Mode & Babysitter Mode');
    expect([...harness.scenarios.keys()]).toEqual([
      activation[0][0], overlays[0][0], disable, activation[1][0], overlays[1][0],
    ]);
    expect(harness.hooks.beforeAll).toHaveLength(1);
    expect(harness.hooks.beforeEach).toHaveLength(0);
    expect(harness.hooks.afterEach).toHaveLength(1);
    expect(harness.imports).toEqual(['@playwright/test', './helpers/auth', './helpers/reset']);
  });

  test('resets both modes, discovers parent and closes the actual setup page', async () => {
    const harness = new ScenarioHarness('modes');
    harness.away = true;
    harness.babysitter = true;
    harness.parent = { id: 'different-parent', name: 'Another Fixture Parent' };
    await harness.hook('beforeAll');
    expect(harness.events).toEqual(['resetModes', 'newPage', 'getFirstParent', 'close:setup']);
    expect(harness.closedPages).toEqual([harness.setupPage]);
    expect(harness.away).toBe(false);
    expect(harness.babysitter).toBe(false);
    await harness.scenario(activation[0][0]);
    expect(harness.events).toContain('login:Another Fixture Parent');
  });

  test.each(['resetModes', 'newPage', 'getFirstParent', 'close:setup'])(
    'preserves setup error identity at %s', async (operation) => {
      const harness = new ScenarioHarness('modes');
      const failure = new Error(`fixture ${operation}`);
      harness.failures.set(operation, failure);
      await expect(harness.hook('beforeAll')).rejects.toBe(failure);
      expect(harness.events.at(-1)).toBe(operation);
    },
  );

  test('resets modes before logging out after a scenario', async () => {
    const harness = await prepared('modes');
    harness.away = true;
    harness.babysitter = true;
    await harness.hook('afterEach');
    expect(harness.events).toEqual(['resetModes', 'logout']);
    expect(harness.away).toBe(false);
    expect(harness.babysitter).toBe(false);
  });

  test.each(['resetModes', 'logout'])('cleanup error at %s is not swallowed', async (operation) => {
    const harness = await prepared('modes');
    const failure = new Error(`fixture ${operation}`);
    harness.failures.set(operation, failure);
    await expect(harness.hook('afterEach')).rejects.toBe(failure);
    expect(harness.events.at(-1)).toBe(operation);
  });

  test.each([...activation.map(([title]) => title), ...overlays.map(([title]) => title), disable])(
    '%s stops before effects when login fails', async (title) => {
      const harness = await prepared('modes');
      const failure = new Error('synthetic login failure');
      harness.failures.set('login:Fixture Parent', failure);
      await expect(harness.scenario(title)).rejects.toBe(failure);
      expect(harness.events).toEqual(['login:Fixture Parent']);
    },
  );
});

describe.each(activation)('original %s', (title, path) => {
  test('requires successful enabled mutation and verifies state for away mode', async () => {
    const harness = await prepared('modes');
    await harness.scenario(title);
    expect(harness.events.slice(0, 4)).toEqual([
      'login:Fixture Parent', `POST:${path}:true`, `ok:POST:${path}`, `json:POST:${path}`,
    ]);
    expect(path === '/api/away-mode' ? harness.away : harness.babysitter).toBe(true);
    if (path === '/api/away-mode') {
      expect(harness.events.slice(4)).toEqual([`GET:${path}`, `json:GET:${path}`]);
    } else expect(harness.events).toHaveLength(4);
  });

  test('rejects an unsuccessful mutation response even if body looks enabled', async () => {
    const harness = await prepared('modes');
    harness.plans.POST.push({ ok: false, body: { enabled: true } });
    await expect(harness.scenario(title)).rejects.toThrow();
    expect(harness.events).not.toContain(`json:POST:${path}`);
    expect(harness.events).not.toContain(`GET:${path}`);
  });

  test.each([false, undefined, 'true', 1])('rejects enabled=%s rather than coercing it', async (enabled) => {
    const harness = await prepared('modes');
    harness.plans.POST.push({ body: { enabled } });
    await expect(harness.scenario(title)).rejects.toThrow();
    expect(harness.events).not.toContain(`GET:${path}`);
  });

  test('propagates transport rejection', async () => {
    const harness = await prepared('modes');
    const failure = new Error('synthetic mutation transport failure');
    harness.plans.POST.push({ requestError: failure });
    await expect(harness.scenario(title)).rejects.toBe(failure);
  });

  test('propagates malformed response JSON', async () => {
    const harness = await prepared('modes');
    const failure = new Error('synthetic mutation JSON failure');
    harness.plans.POST.push({ jsonError: failure });
    await expect(harness.scenario(title)).rejects.toBe(failure);
  });
});

describe('original away verification and disable transition', () => {
  test('rejects a verification body that contradicts the successful mutation', async () => {
    const harness = await prepared('modes');
    harness.plans.GET.push({ body: { enabled: false } });
    await expect(harness.scenario(activation[0][0])).rejects.toThrow();
    expect(harness.events.at(-1)).toBe('json:GET:/api/away-mode');
  });

  test.each(['requestError', 'jsonError'] as const)('preserves verification %s', async (field) => {
    const harness = await prepared('modes');
    const failure = new Error(`synthetic verification ${field}`);
    harness.plans.GET.push({ [field]: failure });
    await expect(harness.scenario(activation[0][0])).rejects.toBe(failure);
  });

  test('actually enables then disables and validates the final response', async () => {
    const harness = await prepared('modes');
    await harness.scenario(disable);
    expect(harness.events).toEqual([
      'login:Fixture Parent', 'POST:/api/away-mode:true', 'POST:/api/away-mode:false',
      'ok:POST:/api/away-mode', 'json:POST:/api/away-mode',
    ]);
    expect(harness.away).toBe(false);
  });

  test('a rejected preliminary enable stops before disabling', async () => {
    const harness = await prepared('modes');
    const failure = new Error('synthetic preliminary enable failure');
    harness.plans.POST.push({ requestError: failure });
    await expect(harness.scenario(disable)).rejects.toBe(failure);
    expect(harness.events).not.toContain('POST:/api/away-mode:false');
  });

  test.each([
    { ok: false, body: { enabled: false } },
    { body: { enabled: true } },
    { body: { enabled: 'false' } },
  ])('rejects invalid final disable response %j', async (response) => {
    const harness = await prepared('modes');
    harness.plans.POST.push({}, response);
    await expect(harness.scenario(disable)).rejects.toThrow();
  });

  test.each(['requestError', 'jsonError'] as const)('preserves final disable %s', async (field) => {
    const harness = await prepared('modes');
    const failure = new Error(`synthetic disable ${field}`);
    harness.plans.POST.push({}, { [field]: failure });
    await expect(harness.scenario(disable)).rejects.toBe(failure);
  });
});

describe.each(overlays)('original %s', (title, key, timeout) => {
  test('mutates before navigation then requires the correct overlay with its timeout', async () => {
    const harness = await prepared('modes');
    await harness.scenario(title);
    expect(harness.events.indexOf('goto:/')).toBeGreaterThan(1);
    expect(harness.events.indexOf('load:networkidle')).toBeGreaterThan(harness.events.indexOf('goto:/'));
    expect(harness.visibility[0]?.timeout).toBe(timeout);
    expect(harness.visibility[0]?.query.replaceAll('\\', '')).toBe(
      `selector:.z-[${key === 'away-overlay' ? '9998' : '9997'}]`,
    );
    expect(harness.visibility).toHaveLength(key === 'away-overlay' ? 1 : 2);
  });

  test('an invisible overlay fails the original assertion', async () => {
    const harness = await prepared('modes');
    harness.hidden.add(key);
    await expect(harness.scenario(title)).rejects.toThrow(`expected visible ${key}`);
  });

  test('a rejected enable request stops before navigation', async () => {
    const harness = await prepared('modes');
    const failure = new Error('synthetic overlay enable rejection');
    harness.plans.POST.push({ requestError: failure });
    await expect(harness.scenario(title)).rejects.toBe(failure);
    expect(harness.events).not.toContain('goto:/');
  });

  test.each(['goto:/', 'load:networkidle'])('navigation failure at %s remains visible', async (operation) => {
    const harness = await prepared('modes');
    const failure = new Error(`synthetic ${operation}`);
    harness.failures.set(operation, failure);
    await expect(harness.scenario(title)).rejects.toBe(failure);
    expect(harness.visibility).toHaveLength(0);
  });
});

test('babysitter heading must be visible even when its overlay is visible', async () => {
  const harness = await prepared('modes');
  harness.hidden.add('babysitter-heading');
  await expect(harness.scenario(overlays[1][0])).rejects.toThrow('expected visible babysitter-heading');
  expect(harness.visibility).toHaveLength(2);
});

for (const gap of gaps.filter((entry) => entry.source === 'modes')) {
  test.failing(`KNOWN GAP ${gap.id}`, () => expectedGap(gap));
}
