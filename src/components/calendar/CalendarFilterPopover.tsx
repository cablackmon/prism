'use client';

import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { contrastText } from '@/lib/utils/color';
import type { CalendarGroup } from '@/lib/hooks/useCalendarFilter';

export interface CalendarFilterPopoverProps {
  calendarGroups: CalendarGroup[];
  selectedCalendarIds: Set<string>;
  onToggle: (id: string) => void;
}

export function CalendarFilterPopover({
  calendarGroups,
  selectedCalendarIds,
  onToggle,
}: CalendarFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (calendarGroups.length === 0) return null;

  const allSelected = selectedCalendarIds.has('all');

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn('rounded p-1 transition-colors hover:bg-accent', open && 'bg-accent')}
        aria-label="Filter calendars"
      >
        <Filter className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-card p-2 shadow-lg">
          {/* All toggle */}
          <button
            onClick={() => onToggle('all')}
            className={cn(
              'w-full rounded px-2 py-1.5 text-left text-xs font-medium transition-colors',
              allSelected
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            All Calendars
          </button>

          <div className="my-1 border-t border-border" />

          {/* Individual calendars */}
          {calendarGroups.map((group) => {
            const isSelected = selectedCalendarIds.has(group.id) || allSelected;
            return (
              <button
                key={group.id}
                onClick={() => onToggle(group.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium transition-colors',
                  isSelected ? '' : 'text-muted-foreground hover:bg-accent'
                )}
                style={
                  isSelected
                    ? { backgroundColor: group.color, color: contrastText(group.color) }
                    : undefined
                }
              >
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full border border-white/60 dark:border-white/80"
                  style={{ backgroundColor: group.color }}
                />
                {group.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
