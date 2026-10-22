import { loadAudit } from './burn4-audit-harness';

const viewport = { name: 'fixture', width: 800, height: 600 };

describe('UI audit concrete source defects', () => {
  test.each([404, 500])('documents HTTP %s navigation resolving into a normal finding', async (navigationStatus) => {
    const audit = loadAudit({ navigationStatus, severities: ['ok'] });
    const finding = await audit.helpers.probeRoute(audit.page, '/fixture', viewport, 100);
    expect(finding).toEqual(expect.objectContaining({ route: '/fixture', severity: 'ok' }));
    expect(audit.screenshots).toHaveLength(1);
  });

  test.failing.each([404, 500])(
    'KNOWN GAP: HTTP %s error pages are accepted as successful route findings',
    async (navigationStatus) => {
      const audit = loadAudit({ navigationStatus, severities: ['ok'] });
      await expect(audit.helpers.probeRoute(audit.page, '/fixture', viewport, 100))
        .rejects.toThrow();
      expect(audit.events.some((event) => ['evaluate', 'grade', 'screenshot'].includes(event.kind))).toBe(false);
      expect(audit.screenshots).toEqual([]);
    },
  );

  test('documents baseline dashboard metadata while its inherited zoom remains nondefault', async () => {
    const audit = loadAudit({ enabled: true, routes: ['/'], initialScale: 125 });
    audit.setup();
    await audit.sweep();
    const baseline = audit.report().findings.filter((finding) => finding.route === '/' && finding.scale === 100);
    expect(baseline).toHaveLength(5);
    expect(audit.screenshots.slice(0, 5).map((shot) => shot.effectiveScale)).toEqual([125, 125, 125, 125, 125]);
    expect(audit.screenshots.slice(5).map((shot) => shot.effectiveScale)).toEqual([75, 75, 125, 125, 150, 150]);
  });

  test.failing('KNOWN GAP: baseline dashboard findings claim 100 percent before stored zoom is reset', async () => {
    const audit = loadAudit({ enabled: true, routes: ['/'], initialScale: 125 });
    audit.setup();
    await audit.sweep();
    const baseline = audit.report().findings.filter((finding) => finding.route === '/' && finding.scale === 100);
    const actualScales = baseline.map((finding) => {
      const shot = audit.screenshots.find((item) => item.path.endsWith(`/${finding.screenshot}`));
      return shot?.effectiveScale;
    });
    expect(actualScales).toEqual(baseline.map((finding) => finding.scale));
  });
});
