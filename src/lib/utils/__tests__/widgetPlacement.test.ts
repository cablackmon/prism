import { findNextFreeSlot } from '../widgetPlacement';

describe('findNextFreeSlot', () => {
  it('returns (0, 0) for an empty grid', () => {
    expect(findNextFreeSlot([], 3, 3)).toEqual({ x: 0, y: 0 });
  });

  it('slots a new widget next to an existing one when the row has horizontal room', () => {
    // One 4-wide widget at top-left; new 3-wide widget should land at x=4, y=0
    const existing = [{ x: 0, y: 0, w: 4, h: 2 }];
    expect(findNextFreeSlot(existing, 3, 2)).toEqual({ x: 4, y: 0 });
  });

  it('drops to the next row when the first row is full', () => {
    // Two widgets that together span the full 48-col grid at y=0..1
    const existing = [
      { x: 0, y: 0, w: 24, h: 2 },
      { x: 24, y: 0, w: 24, h: 2 },
    ];
    expect(findNextFreeSlot(existing, 12, 2)).toEqual({ x: 0, y: 2 });
  });

  it('fills a top-row gap before stacking at the bottom', () => {
    // Tall widget on the left; small widget on the right at the bottom.
    // A new small widget should fill the top-right gap, not stack below.
    const existing = [
      { x: 0, y: 0, w: 12, h: 6 }, // tall left widget
      { x: 0, y: 6, w: 4, h: 2 }, // small bottom widget
    ];
    // The top-right region (x=12..47, y=0..5) is wide open.
    expect(findNextFreeSlot(existing, 6, 3)).toEqual({ x: 12, y: 0 });
  });

  it('ignores hidden widgets', () => {
    const existing = [{ x: 0, y: 0, w: 12, h: 6, visible: false }];
    expect(findNextFreeSlot(existing, 3, 3)).toEqual({ x: 0, y: 0 });
  });

  it('respects a custom grid width', () => {
    const existing = [{ x: 0, y: 0, w: 10, h: 2 }];
    // 12-col grid; new widget of width 3 fits at x=10 (10+3=13 > 12) -> nope,
    // 10+3 = 13 exceeds 12, so x must be <= 12-3 = 9. Collides with widget.
    // First free is next row.
    expect(findNextFreeSlot(existing, 3, 2, 12)).toEqual({ x: 0, y: 2 });
  });
});
