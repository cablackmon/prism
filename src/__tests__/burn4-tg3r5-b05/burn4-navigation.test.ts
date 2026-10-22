/** @jest-environment jsdom */

import { layoutProbe } from '../../../e2e/helpers/ui-detectors';
import { addBox, measurement, resetGeometry } from './burn4-dom-fixture';

beforeEach(() => resetGeometry());

describe('layoutProbe navigation geometry', () => {
  it('accepts a visible rail without a nav element', () => {
    addBox('aside', { left: 0, top: 0, width: 60, height: 240 });
    expect(layoutProbe(2)).toEqual(expect.objectContaining({ navClipped: false, navDetail: null }));
  });

  it.each([
    [100, 100],
    [102, 100],
    [80, 100],
  ])('accepts navigation height %s within rail height %s and tolerance', (scroll, client) => {
    const aside = addBox('aside', { left: 0, top: 0, width: 60, height: 240 });
    const nav = document.createElement('nav');
    aside.appendChild(nav);
    measurement(nav, 'scrollHeight', scroll);
    measurement(nav, 'clientHeight', client);
    expect(layoutProbe(2).navClipped).toBe(false);
    expect(layoutProbe(2).navDetail).toBeNull();
  });

  it('finds the nav inside a nested wrapper and explains clipped items', () => {
    const aside = addBox('aside', { left: 0, top: 0, width: 60, height: 240 });
    const wrapper = document.createElement('div');
    const nav = document.createElement('nav');
    aside.appendChild(wrapper);
    wrapper.appendChild(nav);
    measurement(nav, 'scrollHeight', 160);
    measurement(nav, 'clientHeight', 100);
    expect(layoutProbe(2)).toEqual(expect.objectContaining({
      navClipped: true,
      navDetail: 'side-nav list clipped: 160px of items in a 100px rail',
    }));
  });

  it.each([
    [0, 0, 322, 242],
    [0, 0, 60, 242],
    [262, 0, 60, 240],
  ])('permits rail edges exactly at tolerance (%s,%s,%s,%s)', (left, top, width, height) => {
    addBox('aside', { left, top, width, height });
    expect(layoutProbe(2).navClipped).toBe(false);
  });

  it.each([
    [{ left: 0, top: 0, width: 60, height: 242.1 }, 'nav spills viewport (bottom 242/240, right 60/320)'],
    [{ left: 262.1, top: 0, width: 60, height: 240 }, 'nav spills viewport (bottom 240/240, right 322/320)'],
    [{ left: 262.7, top: 3.7, width: 60, height: 240 }, 'nav spills viewport (bottom 244/240, right 323/320)'],
  ])('reports bottom and right spill using rounded coordinates (%j)', (box, detail) => {
    addBox('aside', box);
    expect(layoutProbe(2)).toEqual(expect.objectContaining({ navClipped: true, navDetail: detail }));
  });

  it('combines item clipping and rail spill in one diagnostic', () => {
    const aside = addBox('aside', { left: 270, top: 10, width: 60, height: 240 });
    const nav = document.createElement('nav');
    aside.appendChild(nav);
    measurement(nav, 'scrollHeight', 160);
    measurement(nav, 'clientHeight', 100);
    expect(layoutProbe(2).navDetail).toBe(
      'side-nav list clipped: 160px of items in a 100px rail; nav spills viewport (bottom 250/240, right 330/320)',
    );
  });

  it('does not confuse unrelated nav elements with the side rail nav', () => {
    const unrelated = addBox('nav', { left: 0, top: 0, width: 100, height: 20 });
    measurement(unrelated, 'scrollHeight', 200);
    measurement(unrelated, 'clientHeight', 20);
    addBox('aside', { left: 0, top: 0, width: 60, height: 240 });
    expect(layoutProbe(2).navClipped).toBe(false);
  });
});
