/** @jest-environment jsdom */

import { layoutProbe } from '../../../e2e/helpers/ui-detectors';
import { addBox, measurement, overhang, rectangle, resetGeometry } from './burn4-dom-fixture';

beforeEach(() => resetGeometry());

describe('layoutProbe viewport and element geometry', () => {
  it('reports an empty viewport without inventing overflow or navigation', () => {
    expect(layoutProbe(2)).toEqual({
      viewportW: 320,
      viewportH: 240,
      pageOverflowX: 0,
      overflowers: [],
      navClipped: false,
      navDetail: null,
    });
  });

  it.each([
    [300, 0],
    [320, 0],
    [320.4, 0],
    [320.6, 1],
    [331.7, 12],
  ])('clamps and rounds document width %s to overflow %s', (scrollWidth, expected) => {
    measurement(document.documentElement, 'scrollWidth', scrollWidth);
    expect(layoutProbe(2).pageOverflowX).toBe(expected);
  });

  it('uses the current viewport dimensions on each call', () => {
    overhang(10);
    expect(layoutProbe(2).overflowers).toHaveLength(1);
    measurement(window, 'innerWidth', 640);
    measurement(window, 'innerHeight', 480);
    measurement(document.documentElement, 'scrollWidth', 640);
    expect(layoutProbe(2)).toEqual(expect.objectContaining({
      viewportW: 640,
      viewportH: 480,
      pageOverflowX: 0,
      overflowers: [],
    }));
  });

  it.each([
    [1.99, false],
    [2, false],
    [2.01, true],
  ])('applies a strict tolerance boundary to an overhang of %s', (pixels, included) => {
    overhang(pixels);
    expect(layoutProbe(2).overflowers).toHaveLength(included ? 1 : 0);
  });

  it('accepts a caller tolerance of zero', () => {
    overhang(0);
    overhang(0.1);
    expect(layoutProbe(0).overflowers).toHaveLength(1);
  });

  it.each([
    [0, 20],
    [20, 0],
    [0, 0],
  ])('ignores hidden zero-size geometry %s by %s', (width, height) => {
    addBox('div', { left: 400, top: 0, width, height });
    expect(layoutProbe(2).overflowers).toEqual([]);
  });

  it('ignores overwide containers but includes the exact permitted width', () => {
    const ignored = addBox('section', { left: 1, top: 0, width: 322.01, height: 10 });
    ignored.id = 'too-wide';
    const included = addBox('section', { left: 1, top: 0, width: 322, height: 10 });
    included.id = 'boundary';
    expect(layoutProbe(2).overflowers.map((item) => item.desc)).toEqual(['section#boundary']);
  });

  it('rounds all recorded measurements after deciding whether to include an element', () => {
    const node = addBox('article', { left: 301.2, top: 3.1, width: 21.4, height: 12.6 });
    node.id = 'rounded';
    expect(layoutProbe(2).overflowers).toEqual([
      { desc: 'article#rounded', right: 323, overflow: 3, w: 21, h: 13 },
    ]);
  });

  it('records element tag, id, first three nonempty classes and widget identity', () => {
    const node = overhang(12);
    node.id = 'weather-card';
    node.className = '  one   two\nthree four  ';
    node.setAttribute('data-widget', 'weather');
    expect(layoutProbe(2).overflowers[0]?.desc).toBe(
      'div#weather-card.one.two.three[data-widget="weather"]',
    );
  });

  it('omits empty class, id and widget attributes from the description', () => {
    const node = overhang(12);
    node.className = ' \n ';
    node.setAttribute('data-widget', '');
    expect(layoutProbe(2).overflowers[0]?.desc).toBe('div');
  });

  it('handles SVG class names without treating SVGAnimatedString as text', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'symbol');
    svg.setAttribute('class', 'one two');
    svg.setAttribute('data-widget', 'icon');
    rectangle(svg, { left: 310, top: 0, width: 20, height: 20 });
    document.body.appendChild(svg);
    expect(layoutProbe(2).overflowers[0]?.desc).toBe('svg#symbol[data-widget="icon"]');
  });

  it('sorts all candidates by worst overflow before retaining the top eight', () => {
    for (const amount of [5, 32, 12, 7, 40, 3, 18, 25, 10, 15]) {
      overhang(amount).id = `over-${amount}`;
    }
    expect(layoutProbe(2).overflowers.map((item) => item.overflow)).toEqual([
      40, 32, 25, 18, 15, 12, 10, 7,
    ]);
  });

  it('does not retain nodes or results between probes', () => {
    const element = overhang(10);
    const first = layoutProbe(2);
    element.remove();
    const second = layoutProbe(2);
    expect(first.overflowers).toHaveLength(1);
    expect(second.overflowers).toEqual([]);
    expect(second.overflowers).not.toBe(first.overflowers);
  });
});

describe('layoutProbe intentional horizontal scrolling', () => {
  it.each(['auto', 'scroll'])('ignores a descendant of an overflow-x %s parent', (style) => {
    const container = addBox('section', { left: 0, top: 0, width: 320, height: 50 });
    container.style.overflowX = style;
    overhang(10, container);
    expect(layoutProbe(2).overflowers).toEqual([]);
  });

  it('finds a scrolling ancestor across multiple non-scrolling wrappers', () => {
    const container = addBox('section', { left: 0, top: 0, width: 320, height: 50 });
    container.style.overflowX = 'auto';
    const outer = addBox('div', { left: 0, top: 0, width: 100, height: 20 }, container);
    const inner = addBox('div', { left: 0, top: 0, width: 100, height: 20 }, outer);
    overhang(20, inner);
    expect(layoutProbe(2).overflowers).toEqual([]);
  });

  it.each(['visible', 'hidden', 'clip'])('does not exempt overflow-x %s ancestors', (style) => {
    const container = addBox('section', { left: 0, top: 0, width: 320, height: 50 });
    container.style.overflowX = style;
    overhang(10, container);
    expect(layoutProbe(2).overflowers).toHaveLength(1);
  });

  it('still flags a scroller that itself overhangs outside its non-scrolling parent', () => {
    const container = overhang(10);
    container.style.overflowX = 'auto';
    overhang(20, container);
    expect(layoutProbe(2).overflowers).toEqual([
      { desc: 'div', right: 330, overflow: 10, w: 20, h: 10 },
    ]);
  });
});
