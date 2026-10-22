import { ARTIFACT_DIR, finding, renderBoard, report } from './burn4-board-harness';

const injectedMarkup = '<script>syntheticMarkup()</script>';
const numericDisplayCases: [string, () => unknown][] = [
  ...['width', 'height', 'scale'].map((field): [string, () => unknown] => [field, () => ({
    findings: [{ ...finding(), [field]: injectedMarkup }],
  })]),
  ...['checks', 'high', 'medium', 'ok'].map((field): [string, () => unknown] => [`totals.${field}`, () => ({
    ...report(),
    totals: { checks: 1, high: 1, medium: 0, ok: 0, [field]: injectedMarkup },
  })]),
  ...['overflow', 'w'].map((field): [string, () => unknown] => [`probe.overflowers.${field}`, () => ({
    findings: [{
      ...finding(),
      probe: { overflowers: [{ desc: 'synthetic element', overflow: 1, w: 800, [field]: injectedMarkup }] },
    }],
  })]),
];

describe('confirmed UI audit board defects', () => {
  test.failing.each(numericDisplayCases)('KNOWN GAP: numeric display field %s inserts unescaped report markup', (_field, input) => {
    const result = renderBoard({ report: input() });
    expect(result.error).toBeUndefined();
    expect(result.writes.size).toBe(1);
    expect(result.html).toBeDefined();
    expect(result.html).not.toContain(injectedMarkup);
  });

  test.failing('KNOWN GAP: severity is interpolated into class, badge and text without escaping', () => {
    const severity = 'high"><script>syntheticMarkup()</script>';
    const result = renderBoard({ report: { findings: [{ ...finding(), severity }] } });
    expect(result.error).toBeUndefined();
    expect(result.writes.size).toBe(1);
    expect(result.html).toBeDefined();
    expect(result.html).not.toContain('<script>syntheticMarkup()</script>');
  });

  test.failing.each([
    ['parent traversal', '../../outside.png', 'outside.png'],
    ['sibling directory', '../ui-audit-artifacts-archive/outside.png', 'e2e/ui-audit-artifacts-archive/outside.png'],
  ])('KNOWN GAP: screenshot %s reads and embeds a file outside the artifact directory', (_name, screenshot, outsidePath) => {
    const result = renderBoard({
      report: report([finding({ screenshot })]),
      files: { [outsidePath]: 'synthetic outside image bytes' },
    });
    expect(result.error).toBeUndefined();
    expect(result.writes.size).toBe(1);
    expect(outsidePath.startsWith(`${ARTIFACT_DIR}/`)).toBe(false);
    expect(result.reads).not.toContain(outsidePath);
    expect(result.html).not.toContain(Buffer.from('synthetic outside image bytes').toString('base64'));
  });
});
