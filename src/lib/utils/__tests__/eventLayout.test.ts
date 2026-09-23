import { calculateEventPositions, positionToCSS } from '../eventLayout';

function makeEvent(
  id: string,
  startHour: number,
  startMin: number,
  endHour?: number,
  endMin?: number
) {
  const start = new Date(2026, 0, 1, startHour, startMin);
  const end = endHour !== undefined ? new Date(2026, 0, 1, endHour, endMin ?? 0) : undefined;
  return { id, startTime: start, endTime: end ?? null };
}

describe('calculateEventPositions', () => {
  it('returns empty map for empty input', () => {
    const result = calculateEventPositions([]);
    expect(result.size).toBe(0);
  });

  it('gives a single event column 0 of 1', () => {
    const events = [makeEvent('a', 9, 0, 10, 0)];
    const result = calculateEventPositions(events);
    expect(result.get('a')).toEqual({ column: 0, totalColumns: 1 });
  });

  it('puts two overlapping events in 2 columns', () => {
    const events = [makeEvent('a', 9, 0, 10, 0), makeEvent('b', 9, 30, 10, 30)];
    const result = calculateEventPositions(events);
    expect(result.get('a')!.totalColumns).toBe(2);
    expect(result.get('b')!.totalColumns).toBe(2);
    // They should be in different columns
    expect(result.get('a')!.column).not.toBe(result.get('b')!.column);
  });

  it('gives two non-overlapping events 1 column each', () => {
    const events = [makeEvent('a', 9, 0, 10, 0), makeEvent('b', 10, 0, 11, 0)];
    const result = calculateEventPositions(events);
    expect(result.get('a')).toEqual({ column: 0, totalColumns: 1 });
    expect(result.get('b')).toEqual({ column: 0, totalColumns: 1 });
  });

  it('puts three mutually overlapping events in 3 columns', () => {
    const events = [
      makeEvent('a', 9, 0, 10, 0),
      makeEvent('b', 9, 15, 10, 0),
      makeEvent('c', 9, 30, 10, 0),
    ];
    const result = calculateEventPositions(events);
    expect(result.get('a')!.totalColumns).toBe(3);
    expect(result.get('b')!.totalColumns).toBe(3);
    expect(result.get('c')!.totalColumns).toBe(3);
    // All different columns
    const cols = new Set([
      result.get('a')!.column,
      result.get('b')!.column,
      result.get('c')!.column,
    ]);
    expect(cols.size).toBe(3);
  });

  it('reuses columns for partial overlap (A↔B, B↔C, not A↔C)', () => {
    // A: 9:00-9:30, B: 9:15-9:45, C: 9:31-10:00
    // A overlaps B, B overlaps C, but A does NOT overlap C
    const events = [
      makeEvent('a', 9, 0, 9, 30),
      makeEvent('b', 9, 15, 9, 45),
      makeEvent('c', 9, 31, 10, 0),
    ];
    const result = calculateEventPositions(events);
    // All 3 are in the same connected component (A-B-C chain)
    expect(result.get('a')!.totalColumns).toBe(2);
    expect(result.get('b')!.totalColumns).toBe(2);
    expect(result.get('c')!.totalColumns).toBe(2);
    // A and C can share a column since they don't overlap
    expect(result.get('a')!.column).toBe(result.get('c')!.column);
    expect(result.get('a')!.column).not.toBe(result.get('b')!.column);
  });

  it('defaults missing endTime to 1 hour after start', () => {
    // Event with no end time: 9:00 -> defaults to 10:00
    // Event at 9:30: overlaps with the first
    const events = [
      makeEvent('a', 9, 0), // no endTime → 10:00
      makeEvent('b', 9, 30, 10, 0), // 9:30-10:00, overlaps with a
    ];
    const result = calculateEventPositions(events);
    expect(result.get('a')!.totalColumns).toBe(2);
    expect(result.get('b')!.totalColumns).toBe(2);
  });

  it('assigns independent column counts to separate clusters', () => {
    // Cluster 1: a,b overlap (9:00-10:00)
    // Cluster 2: c alone (11:00-12:00)
    const events = [
      makeEvent('a', 9, 0, 10, 0),
      makeEvent('b', 9, 30, 10, 30),
      makeEvent('c', 11, 0, 12, 0),
    ];
    const result = calculateEventPositions(events);
    expect(result.get('a')!.totalColumns).toBe(2);
    expect(result.get('b')!.totalColumns).toBe(2);
    expect(result.get('c')!.totalColumns).toBe(1);
  });
});

describe('positionToCSS', () => {
  it('returns full width for 1 column', () => {
    const css = positionToCSS({ column: 0, totalColumns: 1 });
    expect(css.left).toBe('calc(0% + 2px)');
    expect(css.width).toBe('calc(100% - 4px)');
  });

  it('returns correct values for column 0 of 2', () => {
    const css = positionToCSS({ column: 0, totalColumns: 2 });
    expect(css.left).toBe('calc(0% + 2px)');
    expect(css.width).toBe('calc(50% - 4px)');
  });

  it('returns correct values for column 1 of 2', () => {
    const css = positionToCSS({ column: 1, totalColumns: 2 });
    expect(css.left).toBe('calc(50% + 2px)');
    expect(css.width).toBe('calc(50% - 4px)');
  });

  it('returns correct values for 3 columns', () => {
    const pct = 100 / 3;
    const css0 = positionToCSS({ column: 0, totalColumns: 3 });
    expect(css0.left).toBe(`calc(0% + 2px)`);
    expect(css0.width).toBe(`calc(${pct}% - 4px)`);

    const css1 = positionToCSS({ column: 1, totalColumns: 3 });
    expect(css1.left).toBe(`calc(${pct}% + 2px)`);

    const css2 = positionToCSS({ column: 2, totalColumns: 3 });
    expect(css2.left).toBe(`calc(${pct * 2}% + 2px)`);
  });

  it('respects custom gap', () => {
    const css = positionToCSS({ column: 0, totalColumns: 1 }, 4);
    expect(css.left).toBe('calc(0% + 4px)');
    expect(css.width).toBe('calc(100% - 8px)');
  });
});
