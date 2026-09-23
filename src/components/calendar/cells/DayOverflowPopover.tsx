'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/types/calendar';
import { useTimeFormat } from '@/components/providers';
import { formatDisplayTime, isCalendarEventPast } from '@/lib/utils/timeFormat';

interface DayOverflowPopoverProps {
  /** The date this popover represents — shown in the popover header. */
  date: Date;
  /** Events that didn't fit in the cell. */
  hiddenEvents: CalendarEvent[];
  /** Click handler for an individual event. */
  onEventClick: (event: CalendarEvent) => void;
  /** Optional className for the trigger button. */
  triggerClassName?: string;
}

/**
 * "+N more" button that opens a popover listing the events that didn't fit.
 * Touch-friendly: trigger is a 32px+ tappable button; the popover itself is
 * Radix-managed and dismisses on outside click / Escape.
 */
export function DayOverflowPopover({
  date,
  hiddenEvents,
  onEventClick,
  triggerClassName,
}: DayOverflowPopoverProps) {
  const { timeFormat, displayTimezone } = useTimeFormat();
  const [open, setOpen] = React.useState(false);

  if (hiddenEvents.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={cn(
            // Full-width + a taller min-height so it's an easy touch target on a
            // wall display (was min-h-20px / 10px text — fiddly to tap).
            'flex w-full items-center rounded px-2 py-1 text-left text-[11px] font-medium',
            'bg-muted/60 text-muted-foreground transition-colors hover:bg-muted active:bg-muted',
            'min-h-[28px]',
            triggerClassName
          )}
        >
          + {hiddenEvents.length} more
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-xs font-semibold text-muted-foreground">
          {format(date, 'EEEE, MMM d')}
        </div>
        <ul className="m-0 list-none space-y-1 p-0">
          {hiddenEvents.map((event) => (
            <li key={event.id}>
              <button
                onClick={() => {
                  onEventClick(event);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded border border-border/40 bg-card px-2 py-1 text-left transition-colors hover:bg-accent',
                  isCalendarEventPast(
                    event.startTime,
                    event.endTime,
                    event.allDay,
                    new Date(),
                    displayTimezone
                  ) && 'opacity-55 saturate-[0.65]'
                )}
                style={{ borderLeft: `3px solid ${event.color}` }}
              >
                {!event.allDay && (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {formatDisplayTime(event.startTime, timeFormat, {}, displayTimezone)}
                  </span>
                )}
                <span className="flex-1 truncate text-xs font-medium text-foreground">
                  {event.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
