import { deferred, fixtureParent, flush, loadSpec } from './burn4-harness';

const mobile = 'More menu exposes Settings, section selector switches sections';

describe('mobile settings callback gates and actual regression oracles', () => {
  test('disabled fixture gate skips before any request, login or navigation', async () => {
    const spec = loadSpec('mobile-pwa-settings');
    await expect(spec.run(mobile)).rejects.toBe(spec.skip);
    expect(spec.events).toEqual([{ kind: 'skip', detail: true }]);
  });

  test.each(['array', 'wrapped'] as const)('%s family responses reach integrations through the mobile menu and selector', async (familyShape) => {
    const spec = loadSpec('mobile-pwa-settings', { enabled: true, familyShape });
    await spec.run(mobile);
    expect(spec.currentPath).toBe('/settings');
    expect(spec.sessionRole).toBe('parent');
    const actions = spec.events.map((event) => event.kind);
    expect(actions.indexOf('verify')).toBeLessThan(actions.indexOf('goto'));
    expect(actions.indexOf('click:button[aria-label="Open menu"]')).toBeLessThan(actions.indexOf('click:a[href="/settings"]'));
    expect(actions.indexOf('select')).toBeLessThan(actions.indexOf('visible:#microsoft'));
    expect(actions.at(-1)).toBe('visible:#google');
  });

  test('public-index and authenticated-member branches execute without observing auth payloads', async () => {
    for (const loginMember of [fixtureParent, { ...fixtureParent, id: 'fixture-parent-id' }]) {
      const spec = loadSpec('mobile-pwa-settings', { enabled: true, loginMember });
      await spec.run(mobile);
      expect(spec.events.filter((event) => event.kind === 'verify')).toEqual([{ kind: 'verify' }]);
    }
  });

  test.each(['get:/api/family', 'json:/api/family', 'login', 'verify'])('%s rejection stops the callback before any UI navigation', async (failAt) => {
    const spec = loadSpec('mobile-pwa-settings', { enabled: true, failAt });
    await expect(spec.run(mobile)).rejects.toBe(spec.failure);
    expect(spec.events.at(-1)?.kind).toBe(failAt);
    expect(spec.events.some((event) => event.kind === 'goto')).toBe(false);
  });

  test('an unverified parent receives an explicit status error before UI navigation', async () => {
    const spec = loadSpec('mobile-pwa-settings', { enabled: true, responses: { '/api/auth/verify-pin': { status: 403 } } });
    await expect(spec.run(mobile)).rejects.toThrow('Settings verify-pin failed: 403');
    expect(spec.events.some((event) => event.kind === 'goto')).toBe(false);
  });

  test('verification must finish before navigation starts', async () => {
    const wait = deferred();
    const spec = loadSpec('mobile-pwa-settings', { enabled: true, holdAt: 'verify', hold: wait.promise });
    const pending = spec.run(mobile);
    await flush();
    expect(spec.events.some((event) => event.kind === 'verify')).toBe(true);
    expect(spec.events.some((event) => event.kind === 'goto')).toBe(false);
    wait.resolve();
    await pending;
  });

  test.each([
    'button[aria-label="Open menu"]',
    'a[href="/settings"]',
    '#settings-section-select',
    'h2:has-text("Integrations")',
    '#microsoft',
    '#google',
  ])('removing %s makes the regression callback fail', async (selector) => {
    const spec = loadSpec('mobile-pwa-settings', { enabled: true, visible: { [selector]: false } });
    await expect(spec.run(mobile)).rejects.toThrow('Expected visible locator');
    expect(spec.events.at(-1)?.kind).toBe(`visible:${selector}`);
  });

  test.each(['integrations', 'photos'])('missing %s option rejects before switching the settings section', async (value) => {
    const selector = `#settings-section-select >> option[value="${value}"]`;
    const spec = loadSpec('mobile-pwa-settings', { enabled: true, counts: { [selector]: 0 } });
    await expect(spec.run(mobile)).rejects.toThrow('Unexpected locator count');
    expect(spec.events.some((event) => event.kind === 'select')).toBe(false);
  });

  test('wrong settings navigation stops before using section controls', async () => {
    const spec = loadSpec('mobile-pwa-settings', { enabled: true, destinations: { '/settings': '/unrelated' } });
    await expect(spec.run(mobile)).rejects.toThrow('Destination did not match');
    expect(spec.events.some((event) => event.kind === 'select')).toBe(false);
  });

  test('an empty family cannot silently pass settings regression coverage', async () => {
    const spec = loadSpec('mobile-pwa-settings', { enabled: true, members: [] });
    await expect(spec.run(mobile)).rejects.toThrow();
    expect(spec.events.some((event) => ['login', 'verify', 'goto'].includes(event.kind))).toBe(false);
  });

  test('strict fakes deny unknown imports, routes, selectors and hidden clicks', async () => {
    const spec = loadSpec('mobile-pwa-settings', { enabled: true });
    expect(() => spec.importModule('node:child_process')).toThrow('Import denied');
    expect(() => spec.page.locator('#unknown')).toThrow('Unexpected locator');
    await expect(spec.request.get('/api/unknown')).rejects.toThrow('Unexpected GET route');
    await expect(spec.page.locator('a[href="/settings"]').click()).rejects.toThrow('Hidden locator cannot be clicked');
    expect(spec.imports).toEqual(['@playwright/test', './helpers/auth']);
    expect(spec.events.some((event) => event.kind === 'login')).toBe(false);
  });
});
