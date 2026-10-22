import { deferred, drainMicrotasks, loadAudit } from './burn4-audit-harness';

const viewport = { name: 'fixture', width: 800, height: 600 };

describe('probeRoute asynchronous pipeline', () => {
  it('links geometry, grade and screenshot metadata in the awaited pipeline', async () => {
    const audit = loadAudit();
    const finding = await audit.helpers.probeRoute(audit.page, '/family/planning', viewport, 125);
    expect(audit.events.map((event) => event.kind)).toEqual([
      'viewport', 'navigate', 'networkidle', 'stabilize', 'evaluate', 'grade', 'screenshot',
    ]);
    expect(audit.events[2]).toEqual({ kind: 'networkidle', value: 'networkidle' });
    expect(audit.events[3]).toEqual({ kind: 'stabilize', value: 500 });
    expect(finding).toEqual({
      route: '/family/planning', viewport: 'fixture', width: 800, height: 600,
      scale: 125, severity: 'high', summary: 'synthetic finding 0', probe: audit.probes[0],
      screenshot: 'family-planning__fixture__s125.png',
    });
    expect(finding.probe).toBe(audit.probes[0]);
    expect(audit.screenshots).toEqual([{
      path: 'e2e/ui-audit-artifacts/family-planning__fixture__s125.png',
      fullPage: false, animations: 'disabled', route: '/family/planning',
      viewport: { width: 800, height: 600 }, effectiveScale: 100,
    }]);
  });

  it('continues after a best-effort network-idle rejection', async () => {
    const audit = loadAudit({ failAt: 'networkidle' });
    const finding = await audit.helpers.probeRoute(audit.page, '/', viewport, 100);
    expect(finding.screenshot).toBe('dashboard__fixture__s100.png');
    expect(audit.screenshots).toHaveLength(1);
    expect(audit.events.map((event) => event.kind)).toEqual([
      'viewport', 'navigate', 'networkidle', 'stabilize', 'evaluate', 'grade', 'screenshot',
    ]);
  });

  it.each(['viewport', 'navigate', 'stabilize', 'evaluate', 'grade', 'screenshot'])(
    'rejects at %s failure and performs no later pipeline step',
    async (failAt) => {
      const audit = loadAudit({ failAt });
      await expect(audit.helpers.probeRoute(audit.page, '/', viewport, 100)).rejects.toBe(audit.failure);
      expect(audit.events.at(-1)?.kind).toBe(failAt);
      expect(audit.screenshots).toEqual([]);
    },
  );

  it('waits for navigation to finish before measuring or taking a screenshot', async () => {
    const audit = loadAudit();
    const gate = deferred();
    audit.holds.set('navigate', gate.promise);
    let settled = false;
    const pending = audit.helpers.probeRoute(audit.page, '/', viewport, 100).then((finding) => {
      settled = true;
      return finding;
    });
    await drainMicrotasks();
    expect(audit.events.map((event) => event.kind)).toEqual(['viewport', 'navigate']);
    expect(settled).toBe(false);
    gate.resolve();
    await pending;
    expect(settled).toBe(true);
    expect(audit.screenshots).toHaveLength(1);
  });

  it('does not resolve a finding while the screenshot is still pending', async () => {
    const audit = loadAudit();
    const gate = deferred();
    audit.holds.set('screenshot', gate.promise);
    let settled = false;
    const pending = audit.helpers.probeRoute(audit.page, '/', viewport, 100).then(() => { settled = true; });
    await drainMicrotasks();
    await drainMicrotasks();
    expect(audit.events.at(-1)?.kind).toBe('screenshot');
    expect(settled).toBe(false);
    expect(audit.screenshots).toEqual([]);
    gate.resolve();
    await pending;
    expect(settled).toBe(true);
  });

  it('keeps independent concurrent VM probes isolated', async () => {
    const first = loadAudit({ severities: ['high'] });
    const second = loadAudit({ severities: ['ok'] });
    const [a, b] = await Promise.all([
      first.helpers.probeRoute(first.page, '/first', viewport, 100),
      second.helpers.probeRoute(second.page, '/second', { ...viewport, width: 500 }, 150),
    ]);
    expect(a).toEqual(expect.objectContaining({ route: '/first', width: 800, severity: 'high' }));
    expect(b).toEqual(expect.objectContaining({ route: '/second', width: 500, severity: 'ok' }));
    expect(first.screenshots).toHaveLength(1);
    expect(second.screenshots).toHaveLength(1);
    expect(a.probe).not.toBe(b.probe);
  });
});
