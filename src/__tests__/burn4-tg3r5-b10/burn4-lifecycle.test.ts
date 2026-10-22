import { loadAudit } from './burn4-audit-harness';

describe('UI audit registration and lifecycle', () => {
  it('registers callbacks without operational side effects and denies unknown imports', () => {
    const audit = loadAudit({ enabled: true });
    expect(audit.descriptions).toEqual(['UI audit sweep']);
    expect(audit.beforeAll).toHaveLength(1);
    expect(audit.afterAll).toHaveLength(1);
    expect(audit.tests).toHaveLength(1);
    expect(audit.events).toEqual([]);
    expect(audit.imports).toHaveLength(8);
    expect(() => audit.importModule('http')).toThrow('Import denied');
    expect(() => audit.importModule('node:child_process')).toThrow('Import denied');
  });

  it('leaves setup and teardown inert without the private synthetic gate', () => {
    const audit = loadAudit();
    audit.setup();
    audit.teardown();
    expect(audit.events).toEqual([]);
  });

  it('actually skips a disabled sweep before any Page operation', async () => {
    const audit = loadAudit();
    await expect(audit.sweep()).rejects.toBe(audit.skip);
    expect(audit.events).toEqual([{ kind: 'skip', value: true }]);
    expect(audit.writes.size).toBe(0);
  });

  it('resets, looks up the seeded parent, and creates output in order', () => {
    const audit = loadAudit({ enabled: true });
    audit.setup();
    expect(audit.events).toEqual([
      { kind: 'reset' },
      { kind: 'parent-lookup' },
      { kind: 'mkdir', value: { directory: 'e2e/ui-audit-artifacts', recursive: true } },
    ]);
  });

  it.each([
    ['reset', ['reset']],
    ['parent-lookup', ['reset', 'parent-lookup']],
    ['mkdir', ['reset', 'parent-lookup', 'mkdir']],
  ])('stops setup at a failed %s action', (failAt, expected) => {
    const audit = loadAudit({ enabled: true, failAt });
    expect(() => audit.setup()).toThrow(audit.failure);
    expect(audit.events.map((event) => event.kind)).toEqual(expected);
  });

  it('restores default zoom during enabled teardown without other effects', () => {
    const audit = loadAudit({ enabled: true, initialScale: 125 });
    audit.teardown();
    expect(audit.effectiveScale).toBe(100);
    expect(audit.events).toEqual([{ kind: 'scale-change', value: null }]);
  });

  it('propagates a teardown update failure and retains the earlier fake scale', () => {
    const audit = loadAudit({ enabled: true, initialScale: 125, failAt: 'scale-change' });
    expect(() => audit.teardown()).toThrow(audit.failure);
    expect(audit.effectiveScale).toBe(125);
  });
});

describe('UI audit private helpers', () => {
  it('trims synthetic seeded-parent output without retaining it across calls', () => {
    const audit = loadAudit({ parentOutput: ' \n  Fixture Parent  \n ' });
    expect(audit.helpers.getSeededParentName()).toBe('Fixture Parent');
    expect(audit.helpers.getSeededParentName()).toBe('Fixture Parent');
    expect(audit.events).toEqual([{ kind: 'parent-lookup' }, { kind: 'parent-lookup' }]);
  });

  it.each(['', ' \n\t '])('rejects absent seeded-parent output %j', (parentOutput) => {
    const audit = loadAudit({ parentOutput });
    expect(() => audit.helpers.getSeededParentName()).toThrow(/No seeded parent in DB/);
  });

  it('propagates lookup failures by identity', () => {
    const audit = loadAudit({ failAt: 'parent-lookup' });
    try {
      audit.helpers.getSeededParentName();
      throw new Error('Lookup unexpectedly returned');
    } catch (error) {
      expect(error).toBe(audit.failure);
    }
  });

  it.each([75, 125, 150, null])('dispatches font scale %j through the inert database boundary', (scale) => {
    const audit = loadAudit();
    audit.helpers.setDefaultFontScale(scale);
    expect(audit.events).toEqual([{ kind: 'scale-change', value: scale }]);
    expect(audit.effectiveScale).toBe(scale ?? 100);
  });

  it('execDb propagates an inert command failure rather than reporting a scale update', () => {
    const audit = loadAudit({ failAt: 'scale-change' });
    expect(() => audit.helpers.execDb('UPDATE layouts SET font_scale = 125 WHERE is_default = true'))
      .toThrow(audit.failure);
    expect(audit.effectiveScale).toBe(100);
  });

  it.each([
    ['/', 'dashboard'],
    ['/tasks', 'tasks'],
    ['/family/members', 'family-members'],
  ])('links route %s to basename %s', (route, expected) => {
    expect(loadAudit().helpers.slug(route)).toBe(expected);
  });

  it('orders all three severity ranks without treating layout findings as test failures', () => {
    const { severityRank } = loadAudit().helpers;
    expect(severityRank('high')).toBeGreaterThan(severityRank('medium'));
    expect(severityRank('medium')).toBeGreaterThan(severityRank('ok'));
  });
});
