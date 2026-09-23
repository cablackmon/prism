'use client';

import { cn } from '@/lib/utils';
import { MAX_PIPS, PIP_GROUP_SIZE } from '../constants';

interface VisitPipsProps {
  count: number;
  color?: string;
  className?: string;
}

export function VisitPips({ count, color = '#10B981', className }: VisitPipsProps) {
  if (count === 0) {
    return (
      <span className={cn('text-xs italic text-muted-foreground/50', className)}>not yet</span>
    );
  }

  if (count > MAX_PIPS) {
    return (
      <span className={cn('text-xs font-bold tabular-nums', className)} style={{ color }}>
        ×{count}
      </span>
    );
  }

  // Build groups of PIP_GROUP_SIZE
  const groups: boolean[][] = [];
  let remaining = count;
  while (remaining > 0 || groups.length === 0) {
    const groupFilled = Math.min(remaining, PIP_GROUP_SIZE);
    const group: boolean[] = Array(PIP_GROUP_SIZE)
      .fill(false)
      .map((_, i) => i < groupFilled);
    groups.push(group);
    remaining -= groupFilled;
    if (remaining <= 0) break;
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {group.map((filled, pi) => (
            <div
              key={pi}
              className="rounded-full transition-colors"
              style={{
                width: 6,
                height: 6,
                backgroundColor: filled ? color : 'transparent',
                border: `1.5px solid ${filled ? color : color + '55'}`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
