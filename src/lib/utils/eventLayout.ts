/**
 * Shared utility for calculating side-by-side positions of overlapping calendar events.
 *
 * Used by DayViewSideBySide and WeekView to lay out events within an hour cell.
 */

interface LayoutEvent {
  id: string;
  startTime: Date;
  endTime?: Date | null;
}

export interface EventPosition {
  column: number;
  totalColumns: number;
}

/**
 * Calculate column positions for a set of events that may overlap.
 *
 * Algorithm:
 * 1. Sort by start time, then longest duration first
 * 2. Build overlap graph (A overlaps B if A.start < B.end && B.start < A.end)
 * 3. Find connected components (overlap clusters) via BFS
 * 4. Within each cluster, greedily assign columns (first available without conflict)
 * 5. Each cluster gets its own totalColumns count
 */
export function calculateEventPositions(events: LayoutEvent[]): Map<string, EventPosition> {
  const result = new Map<string, EventPosition>();
  if (events.length === 0) return result;

  // Default endTime to 1 hour after start if missing
  const getEnd = (e: LayoutEvent): Date => e.endTime ?? new Date(e.startTime.getTime() + 3600000);

  // Sort: earliest start first, then longest duration first
  const sorted = [...events].sort((a, b) => {
    const timeDiff = a.startTime.getTime() - b.startTime.getTime();
    if (timeDiff !== 0) return timeDiff;
    const aDur = getEnd(a).getTime() - a.startTime.getTime();
    const bDur = getEnd(b).getTime() - b.startTime.getTime();
    return bDur - aDur;
  });

  // Build adjacency list for overlap graph
  const n = sorted.length;
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const aStart = sorted[i]!.startTime.getTime();
      const aEnd = getEnd(sorted[i]!).getTime();
      const bStart = sorted[j]!.startTime.getTime();
      const bEnd = getEnd(sorted[j]!).getTime();
      if (aStart < bEnd && bStart < aEnd) {
        adj[i]!.add(j);
        adj[j]!.add(i);
      }
    }
  }

  // Find connected components via BFS
  const visited = new Array<boolean>(n).fill(false);
  const components: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const component: number[] = [];
    const queue = [i];
    visited[i] = true;
    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (const neighbor of adj[curr]!) {
        if (!visited[neighbor]) {
          visited[neighbor] = true;
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  // Assign columns within each component
  for (const component of components) {
    const columns = new Map<number, number>(); // index -> column

    for (const idx of component) {
      // Find the first column not used by any overlapping neighbor
      const usedColumns = new Set<number>();
      for (const neighbor of adj[idx]!) {
        const col = columns.get(neighbor);
        if (col !== undefined) usedColumns.add(col);
      }

      let col = 0;
      while (usedColumns.has(col)) col++;
      columns.set(idx, col);
    }

    const totalColumns = Math.max(...Array.from(columns.values())) + 1;

    for (const idx of component) {
      result.set(sorted[idx]!.id, {
        column: columns.get(idx)!,
        totalColumns,
      });
    }
  }

  return result;
}

/**
 * Convert a column position to CSS left/width values.
 * @param pos - The event's column position
 * @param gapPx - Pixels of gap/margin on each side (default 2)
 */
export function positionToCSS(
  pos: EventPosition,
  gapPx: number = 2
): { left: string; width: string } {
  const pct = 100 / pos.totalColumns;
  const left = pct * pos.column;
  return {
    left: `calc(${left}% + ${gapPx}px)`,
    width: `calc(${pct}% - ${gapPx * 2}px)`,
  };
}
