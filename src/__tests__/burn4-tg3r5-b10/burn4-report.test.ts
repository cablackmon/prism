import { deferred, drainMicrotasks, loadAudit } from './burn4-audit-harness';

describe('registered UI audit sweep', () => {
  it('executes the actual storage callback before login and sets the sweep timeout', async () => {
    const audit = loadAudit({ enabled: true });
    audit.setup();
    await audit.sweep();
    expect([...audit.storage]).toEqual([
      ['prism-theme', 'light'], ['prism:auto-hide-ui', 'false'],
    ]);
    const kinds = audit.events.map((event) => event.kind);
    expect(kinds.indexOf('init-script')).toBeLessThan(kinds.indexOf('storage'));
    expect(kinds.lastIndexOf('storage')).toBeLessThan(kinds.indexOf('login'));
    expect(audit.events.find((event) => event.kind === 'test-timeout')?.value).toBe(600000);
    expect(audit.events.find((event) => event.kind === 'login')?.value).toBe('Fixture Parent');
  });

  it('covers each route at baseline and only the dashboard at explicit scales', async () => {
    const audit = loadAudit({ enabled: true });
    audit.setup();
    await audit.sweep();
    const findings = audit.report().findings;
    const baseline = findings.filter((finding) => finding.scale === 100);
    expect(baseline).toHaveLength(10);
    for (const route of ['/', '/fixture']) {
      const rows = baseline.filter((finding) => finding.route === route);
      expect(rows).toHaveLength(5);
      expect(new Set(rows.map((finding) => finding.viewport)).size).toBe(5);
    }
    const scaled = findings.filter((finding) => finding.scale !== 100);
    expect(scaled).toHaveLength(6);
    expect(scaled.every((finding) => finding.route === '/')).toBe(true);
    expect(new Set(scaled.map((finding) => `${finding.viewport}:${finding.width}x${finding.height}`)))
      .toEqual(new Set(['desktop:1440x900', 'wall:1920x1080']));
    expect(audit.events.filter((event) => event.kind === 'scale-change').map((event) => event.value))
      .toEqual([75, 125, 150, null]);
    expect(audit.effectiveScale).toBe(100);
  });

  it('writes consistent totals and stable severity ordering for every synthetic probe', async () => {
    const audit = loadAudit({ enabled: true });
    audit.setup();
    await audit.sweep();
    const report = audit.report();
    expect(report.totals).toEqual({ checks: 16, high: 6, medium: 5, ok: 5 });
    expect(report.findings.map((finding) => finding.probe.index)).toEqual([
      0, 3, 6, 9, 12, 15, 1, 4, 7, 10, 13, 2, 5, 8, 11, 14,
    ]);
    expect(report.generatedAtNote).toContain('render time');
    expect(audit.events.find((event) => event.kind === 'completion-assertion')?.value).toBe(16);
  });

  it('links every report finding to one saved screenshot with matching route and dimensions', async () => {
    const audit = loadAudit({ enabled: true });
    audit.setup();
    await audit.sweep();
    const report = audit.report();
    expect(audit.screenshots).toHaveLength(report.totals.checks);
    expect(new Set(audit.screenshots.map((shot) => shot.path)).size).toBe(report.totals.checks);
    for (const finding of report.findings) {
      const shot = audit.screenshots.find((item) => item.path === `e2e/ui-audit-artifacts/${finding.screenshot}`);
      expect(shot).toEqual(expect.objectContaining({
        route: finding.route,
        viewport: { width: finding.width, height: finding.height },
        fullPage: false, animations: 'disabled',
      }));
      expect(finding.probe.viewportW).toBe(finding.width);
      expect(finding.probe.viewportH).toBe(finding.height);
    }
  });

  it('logs only warning findings after the report is written', async () => {
    const audit = loadAudit({ enabled: true });
    audit.setup();
    await audit.sweep();
    expect(audit.normalizedLogs).toHaveLength(12);
    expect(audit.normalizedLogs[0]).toContain('16 checks');
    expect(audit.normalizedLogs.slice(1).every((message) => /^  \[(high|medium)\]/.test(message))).toBe(true);
    const kinds = audit.events.map((event) => event.kind);
    expect(kinds.indexOf('write-report')).toBeLessThan(kinds.indexOf('log'));
  });

  it('completes as a diagnostic even when every finding is high severity', async () => {
    const audit = loadAudit({ enabled: true, severities: ['high'] });
    audit.setup();
    await expect(audit.sweep()).resolves.toBeUndefined();
    expect(audit.report().totals).toEqual({ checks: 16, high: 16, medium: 0, ok: 0 });
  });

  it('records six explicit-scale findings even when the fake navigation list is empty', async () => {
    const audit = loadAudit({ enabled: true, routes: [] });
    audit.setup();
    await audit.sweep();
    expect(audit.report().totals.checks).toBe(6);
    expect(audit.report().findings.every((finding) => finding.route === '/' && finding.scale !== 100)).toBe(true);
  });

  it.each(['init-script', 'storage', 'login', 'scale-change', 'screenshot', 'write-report'])(
    'propagates %s failure without reporting completion',
    async (failAt) => {
      const audit = loadAudit({ enabled: true, failAt });
      audit.setup();
      await expect(audit.sweep()).rejects.toBe(audit.failure);
      expect(audit.events.at(-1)?.kind).toBe(failAt);
      expect(audit.events.some((event) => event.kind === 'completion-assertion')).toBe(false);
      expect(audit.writes.size).toBe(0);
      expect(audit.normalizedLogs).toEqual([]);
    },
  );

  it('waits for login before navigating', async () => {
    const audit = loadAudit({ enabled: true });
    const gate = deferred();
    audit.holds.set('login', gate.promise);
    audit.setup();
    const pending = audit.sweep();
    await drainMicrotasks();
    expect(audit.events.at(-1)?.kind).toBe('login');
    expect(audit.screenshots).toEqual([]);
    expect(audit.events.some((event) => event.kind === 'navigate')).toBe(false);
    gate.resolve();
    await pending;
    expect(audit.report().totals.checks).toBe(16);
  });

  it('runs teardown after an aborted explicit-scale probe to restore zoom', async () => {
    const audit = loadAudit({ enabled: true, failAt: 'navigate', failOccurrence: 11 });
    audit.setup();
    await expect(audit.sweep()).rejects.toBe(audit.failure);
    expect(audit.effectiveScale).toBe(75);
    audit.teardown();
    expect(audit.effectiveScale).toBe(100);
    expect(audit.events.at(-1)).toEqual({ kind: 'scale-change', value: null });
    expect(audit.writes.size).toBe(0);
  });

  it('keeps repeated concurrent synthetic sweep instances independent', async () => {
    const first = loadAudit({ enabled: true, routes: ['/'], severities: ['ok'] });
    const second = loadAudit({ enabled: true, routes: ['/second'], severities: ['medium'] });
    first.setup();
    second.setup();
    await Promise.all([first.sweep(), second.sweep()]);
    expect(first.report().totals).toEqual({ checks: 11, high: 0, medium: 0, ok: 11 });
    expect(second.report().totals).toEqual({ checks: 11, high: 0, medium: 11, ok: 0 });
    expect(first.report().findings.some((finding) => finding.route === '/second')).toBe(false);
    expect(first.storage).not.toBe(second.storage);
    expect(first.writes).not.toBe(second.writes);
  });
});
