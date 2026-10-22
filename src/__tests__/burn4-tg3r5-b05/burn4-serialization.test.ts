/** @jest-environment jsdom */

import { runInNewContext } from 'node:vm';
import { gradeProbe, layoutProbe, type LayoutProbeResult } from '../../../e2e/helpers/ui-detectors';
import { addBox, measurement, overhang, resetGeometry } from './burn4-dom-fixture';

beforeEach(() => resetGeometry());

describe('UI audit detector serialization contract', () => {
  it('runs the serialized browser callback without module closures or imports', () => {
    const parent = addBox('section', { left: 0, top: 0, width: 320, height: 50 });
    parent.style.overflowX = 'auto';
    overhang(100, parent);
    overhang(15).id = 'outside';
    measurement(document.documentElement, 'scrollWidth', 335);
    const isolated = runInNewContext(`(${layoutProbe.toString()})(2)`, {
      window: { innerWidth: 320, innerHeight: 240 },
      document,
      getComputedStyle: window.getComputedStyle.bind(window),
    }, { timeout: 1000 }) as LayoutProbeResult;
    expect(isolated).toEqual(layoutProbe(2));
    expect(isolated.overflowers.map((item) => item.desc)).toEqual(['div#outside']);
    expect(gradeProbe(isolated)).toEqual({
      severity: 'high', summary: 'page scrolls horizontally by 15px',
    });
  });

  it('preserves diagnostics through the JSON boundary used by the report writer', () => {
    const aside = addBox('aside', { left: 0, top: 0, width: 60, height: 240 });
    const nav = document.createElement('nav');
    aside.appendChild(nav);
    measurement(nav, 'scrollHeight', 150);
    measurement(nav, 'clientHeight', 100);
    overhang(10).setAttribute('data-widget', 'calendar');
    const original = layoutProbe(2);
    const transported = JSON.parse(JSON.stringify(original)) as LayoutProbeResult;
    expect(transported).toEqual(original);
    expect(gradeProbe(transported)).toEqual({
      severity: 'high', summary: 'side-nav list clipped: 150px of items in a 100px rail',
    });
  });
});
