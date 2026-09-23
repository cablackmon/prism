/**
 * Widget placement helper for the 48-column dashboard grid.
 *
 * Used when a widget is added via the "Add Widget" UI. The naïve "stack at
 * the bottom" approach (`y = max(y + h)`) means a dashboard with gaps near
 * the top sends the new widget far down the page, forcing the user to
 * scroll to find it. Instead, scan rows top-to-bottom and within each row
 * left-to-right, returning the first (x, y) where the widget fits without
 * colliding with any visible widget.
 */

export interface PlaceableWidget {
  x: number;
  y: number;
  w: number;
  h: number;
  visible?: boolean;
}

export const GRID_COLS = 48;

/**
 * Finds the smallest (y, then x) coordinate where a widget of size newW x newH
 * fits without colliding with any visible existing widget. Visible filter
 * matches the existing layout-editor convention (`visible !== false`).
 *
 * Falls back to (0, maxY) — the row immediately below the lowest existing
 * widget — when nothing fits in the current band, so the function always
 * returns a valid placement.
 */
export function findNextFreeSlot(
  existing: PlaceableWidget[],
  newW: number,
  newH: number,
  gridCols: number = GRID_COLS
): { x: number; y: number } {
  const visible = existing.filter((w) => w.visible !== false);
  const maxY = visible.reduce((m, o) => Math.max(m, o.y + o.h), 0);

  const collides = (x: number, y: number) =>
    visible.some((o) => x < o.x + o.w && o.x < x + newW && y < o.y + o.h && o.y < y + newH);

  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= gridCols - newW; x++) {
      if (!collides(x, y)) {
        return { x, y };
      }
    }
  }
  // Defensive fallback — every slot up through maxY collides (shouldn't
  // happen mathematically, but keep the helper total).
  return { x: 0, y: maxY };
}
