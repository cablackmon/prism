import { gradeProbe, type LayoutProbeResult } from '../../../e2e/helpers/ui-detectors';

function probe(changes: Partial<LayoutProbeResult> = {}): LayoutProbeResult {
  return {
    viewportW: 320,
    viewportH: 240,
    pageOverflowX: 0,
    overflowers: [],
    navClipped: false,
    navDetail: null,
    ...changes,
  };
}

const worst = { desc: 'div#card', right: 330, overflow: 10, w: 20, h: 10 };

describe('gradeProbe diagnostic priority', () => {
  it('grades an unclipped empty result as ok', () => {
    expect(gradeProbe(probe())).toEqual({ severity: 'ok', summary: 'no layout overflow detected' });
  });

  it.each([0, 1, 4])('accepts page overflow %s at or below the severity threshold', (pageOverflowX) => {
    expect(gradeProbe(probe({ pageOverflowX })).severity).toBe('ok');
  });

  it('reports page overflow above four pixels as high', () => {
    expect(gradeProbe(probe({ pageOverflowX: 5 }))).toEqual({
      severity: 'high',
      summary: 'page scrolls horizontally by 5px',
    });
  });

  it('reports the detector first overflower and retained count as medium', () => {
    expect(gradeProbe(probe({ overflowers: [worst, { ...worst, desc: 'span', overflow: 3 }] })))
      .toEqual({
        severity: 'medium',
        summary: '2 element(s) overhang the right edge (worst: div#card by 10px)',
      });
  });

  it('retains element warnings when document overflow is within the high threshold', () => {
    expect(gradeProbe(probe({ pageOverflowX: 4, overflowers: [worst] })).severity).toBe('medium');
  });

  it('prioritizes page overflow over element overflow', () => {
    expect(gradeProbe(probe({ pageOverflowX: 5, overflowers: [worst] }))).toEqual({
      severity: 'high',
      summary: 'page scrolls horizontally by 5px',
    });
  });

  it('prioritizes navigation diagnostics over both other overflow categories', () => {
    expect(gradeProbe(probe({
      navClipped: true,
      navDetail: 'rail diagnostic',
      pageOverflowX: 20,
      overflowers: [worst],
    }))).toEqual({ severity: 'high', summary: 'rail diagnostic' });
  });

  it.each([null, ''])('uses the navigation fallback when its detail is %j', (navDetail) => {
    expect(gradeProbe(probe({ navClipped: true, navDetail }))).toEqual({
      severity: 'high', summary: 'navigation clipped',
    });
  });

  it('ignores stale navigation text when navClipped is false', () => {
    expect(gradeProbe(probe({ navDetail: 'stale' })).severity).toBe('ok');
  });

  it('leaves its input and recorded element objects unchanged', () => {
    const item = Object.freeze({ ...worst });
    const input = probe({ overflowers: [item] });
    Object.freeze(input.overflowers);
    Object.freeze(input);
    const before = JSON.stringify(input);
    gradeProbe(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
