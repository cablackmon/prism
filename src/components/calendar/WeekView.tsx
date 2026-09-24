'use client';

import { format, startOfWeek, addDays, isSameDay, isBefore, startOfDay } from 'date-fns';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWidgetBgOverride } from '@/components/widgets/WidgetContainer';
import { useOrientation } from '@/lib/hooks/useOrientation';
import { useHiddenHours } from '@/lib/hooks/useHiddenHours';
import { useWeekStartsOn } from '@/lib/hooks/useWeekStartsOn';
import { calculateEventPositions, positionToCSS } from '@/lib/utils/eventLayout';
import { hexToRgba } from '@/lib/utils/color';
import type { CalendarEvent } from '@/types/calendar';
import type { DayBucket } from '@/lib/hooks/useWeekViewData';
import {
  DroppableOverlayCell,
  useDayDroppable,
  weatherIcon,
  getMealTime,
  getChoreTime,
  getTaskTime,
  formatTimeOfDay,
  type OverlayItemRef,
} from './cells';
import { WeekItemCard } from './cells/WeekItemCard';
import { useTimeFormat } from '@/components/providers';
import {
  eventOccursOnDisplayDay,
  eventSpansMultipleDisplayDays,
  eventStartsOnDisplayDay,
  formatDisplayHour,
  formatDisplayTime,
  formatDisplayTimeRange,
  toDisplayDate,
} from '@/lib/utils/timeFormat';
import { eventsOverlappingRange } from '@/lib/utils/calendarRange';

export type CalendarDisplayMode = 'inline' | 'cards';

export interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  bordered?: boolean;
  /** 'inline' = colored block (default); 'cards' = dark translucent card with left stripe. */
  displayMode?: CalendarDisplayMode;
  bucketsByDate?: Map<string, DayBucket>;
  enableDnd?: boolean;
  /** Color used for meal stripes (Family calendar-group color). */
  mealColor?: string;
  /** Click handler for meal/chore/task overlay cards (opens edit modal). */
  onItemClick?: (ref: OverlayItemRef) => void;
}

export function WeekView({
  currentDate,
  events,
  onEventClick,
  bordered = true,
  displayMode = 'inline',
  bucketsByDate,
  enableDnd = false,
  mealColor,
  onItemClick,
}: WeekViewProps) {
  const { timeFormat, displayTimezone } = useTimeFormat();
  const displayNow = toDisplayDate(new Date(), displayTimezone);
  const cards = displayMode === 'cards';
  const { weekStartsOn } = useWeekStartsOn();
  const bgOverride = useWidgetBgOverride();
  const transparentMode = bgOverride?.hasCustomBg === true;
  const cellBg = bgOverride?.cellBackgroundColor;
  const cellBgOpacity = bgOverride?.cellBackgroundOpacity ?? 1;
  const cellBgStyle = cellBg ? { backgroundColor: hexToRgba(cellBg, cellBgOpacity) } : undefined;
  const weekStart = startOfWeek(currentDate, { weekStartsOn });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const orientation = useOrientation();
  const isPortrait = orientation === 'portrait';

  // Hidden hours hook
  const { settings: hiddenSettings, toggleHidden, getVisibleHours } = useHiddenHours();

  const weekEnd = addDays(weekStart, 7);
  // Scope the wide event list to this week once; the per-day/per-hour filters
  // below all read the local slice instead of thousands of events.
  const scopedEvents = eventsOverlappingRange(events, weekStart, weekEnd);
  const timedWeekEvents = scopedEvents
    .filter((event) => {
      const displayStart = toDisplayDate(event.startTime, displayTimezone);
      return (
        !event.allDay &&
        !eventSpansMultipleDisplayDays(event.startTime, event.endTime, false, displayTimezone) &&
        displayStart >= weekStart &&
        displayStart < weekEnd
      );
    })
    .map((event) => ({
      ...event,
      startTime: toDisplayDate(event.startTime, displayTimezone),
      endTime: toDisplayDate(event.endTime, displayTimezone),
    }));

  // Get visible hours (filtered if hidden mode is enabled)
  const hours = getVisibleHours(timedWeekEvents, { from: weekStart, to: weekEnd });

  // Multi-day timed events share the persistent header with all-day events so
  // they do not become oversized blocks in the hourly grid.
  const getAllDayEvents = (date: Date) =>
    scopedEvents.filter(
      (event) =>
        (event.allDay ||
          eventSpansMultipleDisplayDays(event.startTime, event.endTime, false, displayTimezone)) &&
        eventOccursOnDisplayDay(event.startTime, event.endTime, event.allDay, date, displayTimezone)
    );

  const getHeaderEventLabel = (event: CalendarEvent, date: Date) =>
    !event.allDay && eventStartsOnDisplayDay(event.startTime, false, date, displayTimezone)
      ? `${formatDisplayTime(event.startTime, timeFormat, {}, displayTimezone)} ${event.title}`
      : event.title;

  // Get all timed events for a day (used to compute side-by-side positions
  // across the entire day, so events that overlap but start in different
  // hours still split the column horizontally).
  const getDayTimedEvents = (date: Date) =>
    scopedEvents.filter(
      (event) =>
        !event.allDay &&
        !eventSpansMultipleDisplayDays(event.startTime, event.endTime, false, displayTimezone) &&
        isSameDay(toDisplayDate(event.startTime, displayTimezone), date)
    );

  // Get timed events for a specific day and hour
  const getHourEvents = (date: Date, hour: number) =>
    scopedEvents.filter(
      (e) =>
        isSameDay(toDisplayDate(e.startTime, displayTimezone), date) &&
        !e.allDay &&
        !eventSpansMultipleDisplayDays(e.startTime, e.endTime, false, displayTimezone) &&
        toDisplayDate(e.startTime, displayTimezone).getHours() === hour
    );

  // For portrait, split into two rows
  const row1Days = days.slice(0, 4); // Sun-Wed
  const nextSunday = addDays(weekStart, 7);
  const row2Days = [...days.slice(4, 7), nextSunday]; // Thu-Sat + next Sun

  const renderDayColumn = (date: Date, compact: boolean = false) => {
    const isPast = isBefore(date, startOfDay(displayNow)) && !isSameDay(date, displayNow);
    const allDayEvents = getAllDayEvents(date);
    const dayPositions = calculateEventPositions(getDayTimedEvents(date));

    return (
      <PortraitDayColumn key={date.toISOString()} date={date} cards={cards} enableDnd={enableDnd}>
        {/* Day header */}
        <div
          className={cn(
            'shrink-0 rounded-t-md py-1 text-center',
            !transparentMode && isPast && 'bg-muted/50 text-muted-foreground',
            isSameDay(date, displayNow) && 'bg-primary text-primary-foreground'
          )}
        >
          <div className={cn('font-bold uppercase tracking-wide', compact ? 'text-xs' : 'text-sm')}>
            {format(date, 'EEE')}
          </div>
          <div className={cn('font-bold', compact ? 'text-lg' : 'text-xl')}>
            {format(date, 'd')}
          </div>
        </div>

        {/* All-day events */}
        {allDayEvents.length > 0 && (
          <div
            className={cn('flex shrink-0 flex-col gap-px p-0.5', !transparentMode && 'bg-card/50')}
          >
            {allDayEvents.map((event) => (
              <button
                key={event.id}
                onClick={() => onEventClick(event)}
                className={cn(
                  'w-full truncate rounded px-1 py-px text-left text-xs transition-all hover:opacity-80',
                  cards && 'border border-border/40 bg-card/85 shadow-sm backdrop-blur-sm'
                )}
                style={
                  cards
                    ? { borderLeft: `3px solid ${event.color}` }
                    : {
                        backgroundColor: event.color,
                        color: '#fff',
                        borderLeft: `2px solid ${event.color}`,
                      }
                }
              >
                {getHeaderEventLabel(event, date)}
              </button>
            ))}
          </div>
        )}

        {/* Hourly grid - scales to fit available space */}
        <div
          className={cn('grid flex-1 shrink-0', !transparentMode && isPast && 'bg-muted/20')}
          style={{ gridTemplateRows: `repeat(${hours.length}, minmax(20px, 1fr))` }}
        >
          {hours.map((hour) => {
            const hourEvents = getHourEvents(date, hour);
            return (
              <div
                key={hour}
                className={cn(
                  'relative min-h-0 overflow-visible',
                  bordered && 'border-t border-border/50'
                )}
                style={cellBgStyle}
              >
                {hourEvents.map((event) => {
                  const pos = dayPositions.get(event.id);
                  if (!pos) return null;
                  const css = positionToCSS(pos);
                  const durationMin =
                    ((event.endTime?.getTime() ?? event.startTime.getTime() + 3600000) -
                      event.startTime.getTime()) /
                    60000;
                  const heightPct = Math.max((durationMin / 60) * 100, 20);
                  return (
                    <button
                      key={event.id}
                      onClick={() => onEventClick(event)}
                      className={cn(
                        'absolute z-10 flex flex-col items-start overflow-hidden rounded px-0.5 pt-0.5 text-left text-xs transition-all hover:opacity-90 hover:ring-1 hover:ring-seasonal-accent/50',
                        cards && 'border border-border/40 bg-card/85 shadow-sm backdrop-blur-sm'
                      )}
                      style={
                        cards
                          ? {
                              borderLeft: `3px solid ${event.color}`,
                              top: `calc(${(toDisplayDate(event.startTime, displayTimezone).getMinutes() / 60) * 100}% + 2px)`,
                              height: `calc(${heightPct}% - 4px)`,
                              left: css.left,
                              width: css.width,
                            }
                          : {
                              backgroundColor: event.color,
                              color: '#fff',
                              borderLeft: `2px solid ${event.color}`,
                              top: `${(toDisplayDate(event.startTime, displayTimezone).getMinutes() / 60) * 100}%`,
                              height: `${heightPct}%`,
                              left: css.left,
                              width: css.width,
                            }
                      }
                    >
                      <span
                        className={cn(
                          'w-full truncate text-[10px] font-medium leading-tight',
                          cards && 'text-foreground'
                        )}
                      >
                        {event.title}
                      </span>
                      {cards && durationMin >= 30 && (
                        <span className="w-full truncate text-[9px] leading-tight text-muted-foreground">
                          {formatDisplayTimeRange(
                            event.startTime,
                            event.endTime ?? new Date(event.startTime.getTime() + 3600000),
                            timeFormat,
                            displayTimezone
                          )}
                        </span>
                      )}
                      {cards && durationMin >= 60 && (event.location || event.calendarName) && (
                        <span className="w-full truncate text-[9px] leading-tight text-muted-foreground">
                          {event.location || event.calendarName}
                        </span>
                      )}
                      {!cards && (
                        <span className="text-[9px] leading-tight opacity-70">
                          {formatDisplayTimeRange(
                            event.startTime,
                            event.endTime ?? new Date(event.startTime.getTime() + 3600000),
                            timeFormat,
                            displayTimezone
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </PortraitDayColumn>
    );
  };

  // Portrait: 2 rows of 4 days each (compact) - grid ensures equal split
  if (isPortrait) {
    return (
      <div
        className="grid h-full gap-1 overflow-auto"
        style={{ gridTemplateRows: `repeat(2, minmax(${48 + hours.length * 20}px, 1fr))` }}
      >
        <div
          className={cn(
            'flex gap-px rounded-md',
            !transparentMode && 'bg-card/85 backdrop-blur-sm'
          )}
        >
          {/* Time column */}
          <div className="flex w-8 shrink-0 flex-col">
            {/* Header with toggle button */}
            <div className="flex h-12 shrink-0 items-center justify-center">
              <button
                onClick={toggleHidden}
                className={cn(
                  'rounded-full p-1 transition-colors',
                  hiddenSettings.enabled
                    ? 'bg-blue-500 text-white'
                    : 'text-muted-foreground hover:bg-accent'
                )}
                title={hiddenSettings.enabled ? 'Show all hours' : 'Hide time block'}
                aria-label={hiddenSettings.enabled ? 'Show all hours' : 'Hide time block'}
              >
                <Clock className="h-3 w-3" />
              </button>
            </div>
            <div
              className="grid flex-1 shrink-0"
              style={{ gridTemplateRows: `repeat(${hours.length}, minmax(20px, 1fr))` }}
            >
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="flex items-start border-t border-transparent pl-0.5 pr-0.5 text-right text-[9px] text-muted-foreground"
                >
                  {formatDisplayHour(new Date().setHours(hour, 0), timeFormat, { compact: true })}
                </div>
              ))}
            </div>
          </div>
          {row1Days.map((date) => renderDayColumn(date, true))}
        </div>
        <div
          className={cn(
            'flex gap-px rounded-md',
            !transparentMode && 'bg-card/85 backdrop-blur-sm'
          )}
        >
          {/* Time column */}
          <div className="flex w-8 shrink-0 flex-col">
            <div className="h-12 shrink-0" /> {/* Header spacer */}
            <div
              className="grid flex-1 shrink-0"
              style={{ gridTemplateRows: `repeat(${hours.length}, minmax(20px, 1fr))` }}
            >
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="flex items-start border-t border-transparent pl-0.5 pr-0.5 text-right text-[9px] text-muted-foreground"
                >
                  {formatDisplayHour(new Date().setHours(hour, 0), timeFormat, { compact: true })}
                </div>
              ))}
            </div>
          </div>
          {row2Days.map((date) => renderDayColumn(date, true))}
        </div>
      </div>
    );
  }

  // Landscape: single scroll container with sticky header — keeps header/content columns in
  // the same layout context so they always align (no scrollbar-width mismatch).
  // The inner min-h-full flex-col wrapper makes the hourly grid stretch to fill available
  // space; 1fr rows distribute the remaining height so hours grow when fewer are visible.
  return (
    <div
      className={cn(
        'h-full overflow-hidden rounded-md',
        !transparentMode && 'bg-card/85 backdrop-blur-sm'
      )}
    >
      <div className="h-full overflow-y-auto">
        <div className="flex h-full min-h-full flex-col">
          {/* Sticky day headers */}
          <div className={cn('sticky top-0 z-20 flex', !transparentMode && 'bg-card')}>
            {/* Time column spacer with toggle button */}
            <div className="flex w-16 shrink-0 items-center justify-center">
              <button
                onClick={toggleHidden}
                className={cn(
                  'rounded-full p-1.5 transition-colors',
                  hiddenSettings.enabled
                    ? 'bg-blue-500 text-white'
                    : 'text-muted-foreground hover:bg-accent'
                )}
                title={hiddenSettings.enabled ? 'Show all hours' : 'Hide time block'}
                aria-label={hiddenSettings.enabled ? 'Show all hours' : 'Hide time block'}
              >
                <Clock className="h-4 w-4" />
              </button>
            </div>
            {days.map((date) => {
              const isPast = isBefore(date, startOfDay(displayNow)) && !isSameDay(date, displayNow);
              const allDayEvents = getAllDayEvents(date);
              const dayBucket = bucketsByDate?.get(format(date, 'yyyy-MM-dd'));
              const dayWeather = dayBucket?.weather;
              // Header bucket: items WITHOUT a time-of-day OR with a time
              // that falls inside the hidden-hours block (so they don't
              // disappear when the user collapses morning/evening). Everything
              // else renders in the hour grid via TimedBucketLayer.
              const headerBucket = dayBucket
                ? {
                    ...dayBucket,
                    meals: dayBucket.meals.filter(
                      (m) => !isTimeInVisibleHours(getMealTime(m), hours)
                    ),
                    chores: dayBucket.chores.filter((c) => {
                      const t = getChoreTime(c);
                      return !t || !isTimeInVisibleHours(t, hours);
                    }),
                    tasks: dayBucket.tasks.filter((t) => {
                      const tt = getTaskTime(t);
                      return !tt || !isTimeInVisibleHours(tt, hours);
                    }),
                  }
                : undefined;
              return (
                <LandscapeDayHeader
                  key={date.toISOString()}
                  date={date}
                  today={isSameDay(date, displayNow)}
                  isPast={isPast}
                  cards={cards}
                  enableDnd={enableDnd}
                  transparentMode={transparentMode}
                >
                  <div
                    className={cn(
                      'flex items-baseline justify-between gap-1 px-2 py-1.5',
                      !transparentMode && isPast && 'bg-muted/50 text-muted-foreground',
                      isSameDay(date, displayNow) && !cards && 'bg-primary text-primary-foreground'
                    )}
                  >
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <span className="text-2xl font-bold leading-none">{format(date, 'd')}</span>
                      <span
                        className={cn(
                          'truncate text-xs font-medium uppercase leading-none tracking-wide',
                          isSameDay(date, displayNow) && cards
                            ? 'font-semibold text-seasonal-accent'
                            : undefined
                        )}
                      >
                        {isSameDay(date, displayNow) ? 'Today' : format(date, 'EEE')}
                      </span>
                    </div>
                    {dayWeather && (
                      <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        {weatherIcon(dayWeather.condition)}
                        <span className="tabular-nums">
                          {Math.round(dayWeather.high)}°/{Math.round(dayWeather.low)}°
                        </span>
                      </div>
                    )}
                  </div>
                  {allDayEvents.length > 0 && (
                    <div
                      className={cn(
                        'flex flex-col gap-px px-0.5 pb-0.5',
                        !transparentMode && 'bg-card/50'
                      )}
                    >
                      {allDayEvents.map((event) => (
                        <button
                          key={event.id}
                          onClick={() => onEventClick(event)}
                          className={cn(
                            'w-full truncate rounded px-1 py-px text-left text-[10px] font-medium leading-tight transition-all hover:opacity-80',
                            cards && 'border border-border/40 bg-card/85 shadow-sm backdrop-blur-sm'
                          )}
                          style={
                            cards
                              ? { borderLeft: `3px solid ${event.color}` }
                              : {
                                  backgroundColor: event.color,
                                  color: '#fff',
                                  borderLeft: `2px solid ${event.color}`,
                                }
                          }
                        >
                          {getHeaderEventLabel(event, date)}
                        </button>
                      ))}
                    </div>
                  )}
                  {headerBucket && (
                    <div className="px-0.5 pb-0.5">
                      <DroppableOverlayCell
                        date={date}
                        bucket={headerBucket}
                        size="xs"
                        layout="row"
                        enableDnd={enableDnd}
                        mealColor={mealColor}
                        onItemClick={onItemClick}
                      />
                    </div>
                  )}
                </LandscapeDayHeader>
              );
            })}
          </div>

          {/* Hourly grid — flex-1 fills remaining space; 1fr rows stretch when hours are hidden */}
          <div className="flex flex-1">
            {/* Time column */}
            <div
              className="grid h-full w-16 shrink-0"
              style={{ gridTemplateRows: `repeat(${hours.length}, 1fr)` }}
            >
              {hours.map((hour) => (
                <div
                  key={hour}
                  className={cn(
                    'flex min-h-0 items-start pl-1 pr-1 pt-0.5 text-right text-xs text-muted-foreground',
                    bordered && 'border-t border-border'
                  )}
                >
                  {formatDisplayHour(new Date().setHours(hour, 0), timeFormat)}
                </div>
              ))}
            </div>
            {/* Day columns */}
            {days.map((date) => {
              const isPast = isBefore(date, startOfDay(displayNow)) && !isSameDay(date, displayNow);
              const dayPositions = calculateEventPositions(getDayTimedEvents(date));
              const dayBucket = bucketsByDate?.get(format(date, 'yyyy-MM-dd'));
              return (
                <LandscapeDayBody
                  key={date.toISOString()}
                  date={date}
                  today={isSameDay(date, displayNow)}
                  isPast={isPast}
                  cards={cards}
                  enableDnd={enableDnd}
                  transparentMode={transparentMode}
                >
                  <div
                    className="grid h-full"
                    style={{ gridTemplateRows: `repeat(${hours.length}, 1fr)` }}
                  >
                    {hours.map((hour) => {
                      const hourEvents = getHourEvents(date, hour);
                      return (
                        <div
                          key={hour}
                          className={cn(
                            'relative min-h-0 overflow-visible',
                            bordered && 'border-t border-border'
                          )}
                          style={cellBgStyle}
                        >
                          {hourEvents.map((event) => {
                            const pos = dayPositions.get(event.id);
                            if (!pos) return null;
                            const css = positionToCSS(pos);
                            const durationMin =
                              ((event.endTime?.getTime() ?? event.startTime.getTime() + 3600000) -
                                event.startTime.getTime()) /
                              60000;
                            const heightPct = Math.max((durationMin / 60) * 100, 20);
                            return (
                              <button
                                key={event.id}
                                onClick={() => onEventClick(event)}
                                className={cn(
                                  'absolute z-10 flex flex-col items-start overflow-hidden rounded p-0.5 text-left text-xs transition-all hover:opacity-90 hover:ring-2 hover:ring-seasonal-accent/50',
                                  cards &&
                                    'border border-border/40 bg-card/85 shadow-sm backdrop-blur-sm'
                                )}
                                style={
                                  cards
                                    ? {
                                        borderLeft: `3px solid ${event.color}`,
                                        top: `calc(${(toDisplayDate(event.startTime, displayTimezone).getMinutes() / 60) * 100}% + 2px)`,
                                        height: `calc(${heightPct}% - 4px)`,
                                        left: css.left,
                                        width: css.width,
                                      }
                                    : {
                                        backgroundColor: event.color,
                                        color: '#fff',
                                        borderLeft: `2px solid ${event.color}`,
                                        top: `${(toDisplayDate(event.startTime, displayTimezone).getMinutes() / 60) * 100}%`,
                                        height: `${heightPct}%`,
                                        left: css.left,
                                        width: css.width,
                                      }
                                }
                              >
                                {/* Time-grid rows in priority order: title, then
                                  time, then subtitle. Thresholds tuned so a
                                  45-min block stays single-line and a 60-min
                                  block stays at most two lines (60-min cells
                                  can't fit 3 lines without clipping). */}
                                <div
                                  className={cn(
                                    'w-full truncate text-[10px] font-medium leading-tight',
                                    cards && 'text-foreground'
                                  )}
                                >
                                  {event.title}
                                </div>
                                {cards && durationMin >= 60 && (
                                  <div className="w-full truncate text-[9px] leading-tight text-muted-foreground">
                                    {formatDisplayTimeRange(
                                      event.startTime,
                                      event.endTime ??
                                        new Date(event.startTime.getTime() + 3600000),
                                      timeFormat,
                                      displayTimezone
                                    )}
                                  </div>
                                )}
                                {cards &&
                                  durationMin >= 90 &&
                                  (event.location || event.calendarName) && (
                                    <div className="w-full truncate text-[9px] leading-tight text-muted-foreground">
                                      {event.location || event.calendarName}
                                    </div>
                                  )}
                                {!cards && durationMin >= 45 && (
                                  <div className="text-[9px] leading-tight opacity-70">
                                    {formatDisplayTimeRange(
                                      event.startTime,
                                      event.endTime ??
                                        new Date(event.startTime.getTime() + 3600000),
                                      timeFormat,
                                      displayTimezone
                                    )}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                  {/* Timed-overlay layer: meals/chores/tasks placed by time-of-day. */}
                  {cards && dayBucket && (
                    <TimedBucketLayer
                      bucket={dayBucket}
                      hours={hours}
                      mealColor={mealColor}
                      enableDnd={enableDnd}
                      onItemClick={onItemClick}
                    />
                  )}
                </LandscapeDayBody>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Returns true when the HH:mm value falls inside one of the visible hour
 * slots. Used to decide whether a timed bucket item lands in the grid or
 * spills back to the header row when the user has hidden hours.
 */
function isTimeInVisibleHours(hhmm: string | null, hours: number[]): boolean {
  if (!hhmm) return false;
  const m = /^(\d{2}):/.exec(hhmm);
  if (!m) return false;
  return hours.includes(Number(m[1]));
}

/**
 * Renders a day's bucket items (meals, chores, tasks) at their time-of-day
 * over the hour grid. Items at hidden hours are filtered out by the caller
 * and rendered in the header row instead.
 */
function TimedBucketLayer({
  bucket,
  hours,
  mealColor,
  enableDnd,
  onItemClick,
}: {
  bucket: DayBucket;
  hours: number[];
  mealColor: string | undefined;
  enableDnd: boolean;
  onItemClick?: (ref: OverlayItemRef) => void;
}) {
  const { timeFormat } = useTimeFormat();
  const slotPct = 100 / hours.length;
  const visibleSet = new Set(hours);

  type Placed = {
    key: string;
    dragId: string;
    variant: 'meal' | 'chore' | 'task';
    title: string;
    timeLabel: string;
    subtitle?: string;
    stripeColor: string;
    muted?: boolean;
    pendingApproval?: boolean;
    /** Visible hour index (0-based within `hours` array). */
    rowIndex: number;
    minute: number;
    durationMin: number;
  };

  const placed: Placed[] = [];

  for (const meal of bucket.meals) {
    const t = getMealTime(meal);
    const hh = Number(t.slice(0, 2));
    if (!visibleSet.has(hh)) continue;
    const mm = Number(t.slice(3, 5));
    placed.push({
      key: `meal-${meal.id}`,
      dragId: `meal:${meal.id}`,
      variant: 'meal',
      title: meal.name,
      timeLabel: formatTimeOfDay(t, timeFormat),
      subtitle: meal.cookedBy?.name ? `Cooked by ${meal.cookedBy.name}` : undefined,
      stripeColor: mealColor ?? '#10b981',
      muted: Boolean(meal.cookedAt),
      rowIndex: hours.indexOf(hh),
      minute: mm,
      durationMin: meal.mealType === 'dinner' ? 60 : 30,
    });
  }
  for (const chore of bucket.chores) {
    const t = getChoreTime(chore);
    if (!t) continue;
    const hh = Number(t.slice(0, 2));
    if (!visibleSet.has(hh)) continue;
    const mm = Number(t.slice(3, 5));
    placed.push({
      key: `chore-${chore.id}`,
      dragId: `chore:${chore.id}`,
      variant: 'chore',
      title: chore.title,
      timeLabel: formatTimeOfDay(t, timeFormat),
      subtitle: chore.assignedTo?.name,
      stripeColor: chore.assignedTo?.color || '#f59e0b',
      pendingApproval: Boolean(chore.pendingApproval),
      rowIndex: hours.indexOf(hh),
      minute: mm,
      durationMin: 30,
    });
  }
  for (const task of bucket.tasks) {
    const t = getTaskTime(task);
    if (!t) continue;
    const hh = Number(t.slice(0, 2));
    if (!visibleSet.has(hh)) continue;
    const mm = Number(t.slice(3, 5));
    placed.push({
      key: `task-${task.id}`,
      dragId: `task:${task.id}`,
      variant: 'task',
      title: task.title,
      timeLabel: formatTimeOfDay(t, timeFormat),
      subtitle: task.assignedTo?.name,
      stripeColor: task.assignedTo?.color || '#3b82f6',
      muted: task.completed,
      rowIndex: hours.indexOf(hh),
      minute: mm,
      durationMin: 30,
    });
  }

  if (placed.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {placed.map((p) => {
        const topPct = (p.rowIndex + p.minute / 60) * slotPct;
        const heightPct = (p.durationMin / 60) * slotPct;
        return (
          <div
            key={p.key}
            className="pointer-events-auto absolute px-0.5"
            style={{ top: `${topPct}%`, height: `${heightPct}%`, left: 0, right: 0, zIndex: 5 }}
          >
            <WeekItemCard
              onClick={
                onItemClick
                  ? () => onItemClick({ kind: p.variant, id: p.dragId.split(':')[1]! })
                  : undefined
              }
              variant={p.variant}
              size="sm"
              layout="row"
              stripeColor={p.stripeColor}
              title={p.title}
              timeLabel={p.timeLabel}
              subtitle={p.subtitle}
              muted={p.muted}
              pendingApproval={p.pendingApproval}
              dragId={enableDnd ? p.dragId : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Wraps a portrait-mode day column with a useDayDroppable target so meals,
 * chores, and tasks can be dropped onto the entire day.
 */
function PortraitDayColumn({
  date,
  cards,
  enableDnd,
  children,
}: {
  date: Date;
  cards: boolean;
  enableDnd: boolean;
  children: React.ReactNode;
}) {
  const droppable = useDayDroppable({ date, enabled: cards && enableDnd });
  return (
    <div
      ref={cards && enableDnd ? droppable.setNodeRef : undefined}
      data-droppable-day={cards && enableDnd ? droppable.droppableId : undefined}
      className={cn(
        'flex min-w-0 flex-1 flex-col',
        cards && enableDnd && droppable.isOver && 'rounded-md shadow-lg ring-2 ring-seasonal-accent'
      )}
    >
      {children}
    </div>
  );
}

/**
 * Wraps the landscape-mode day BODY (time-grid column under the sticky header)
 * with a separate useDayDroppable target so meals/chores/tasks can be dropped
 * directly onto the time grid as well as the header. Uses region='body' so its
 * id doesn't collide with the header's same-date droppable.
 */
function LandscapeDayBody({
  date,
  today,
  isPast,
  cards,
  enableDnd,
  transparentMode,
  children,
}: {
  date: Date;
  today: boolean;
  isPast: boolean;
  cards: boolean;
  enableDnd: boolean;
  transparentMode: boolean;
  children: React.ReactNode;
}) {
  const droppable = useDayDroppable({ date, enabled: cards && enableDnd, region: 'body' });
  return (
    <div
      ref={cards && enableDnd ? droppable.setNodeRef : undefined}
      data-droppable-day={cards && enableDnd ? droppable.droppableId : undefined}
      className={cn(
        'relative h-full min-w-0 flex-1 border-l border-border',
        !transparentMode && isPast && 'bg-muted/10',
        // For today: 3-sided border (left + right + bottom, no top) so it joins
        // seamlessly with LandscapeDayHeader's 3-sided border to form a single
        // continuous perimeter spanning header + time grid.
        today && cards && 'border-2 border-t-0 border-seasonal-accent/80',
        cards && enableDnd && droppable.isOver && 'shadow-lg ring-2 ring-inset ring-seasonal-accent'
      )}
    >
      {children}
    </div>
  );
}

/**
 * Wraps a landscape-mode day header (per-day column in the sticky header) with
 * a useDayDroppable target. Drop highlight covers the header column where the
 * meals/chores/tasks bucket lives.
 */
function LandscapeDayHeader({
  date,
  today,
  isPast,
  cards,
  enableDnd,
  transparentMode,
  children,
}: {
  date: Date;
  today: boolean;
  isPast: boolean;
  cards: boolean;
  enableDnd: boolean;
  transparentMode: boolean;
  children: React.ReactNode;
}) {
  const droppable = useDayDroppable({ date, enabled: cards && enableDnd });
  return (
    <div
      ref={cards && enableDnd ? droppable.setNodeRef : undefined}
      data-droppable-day={cards && enableDnd ? droppable.droppableId : undefined}
      className={cn(
        'min-w-0 flex-1 border-l border-border',
        !transparentMode && isPast && 'bg-muted/20',
        // For today: 3-sided border (top + left + right, no bottom) using
        // explicit border-2 so it joins seamlessly with LandscapeDayBody's
        // matching 3-sided border (left + right + bottom). Together the two
        // form a single continuous 4-sided perimeter spanning the full column.
        today && cards && 'border-2 border-b-0 border-seasonal-accent/80',
        cards && enableDnd && droppable.isOver && 'shadow-lg ring-2 ring-inset ring-seasonal-accent'
      )}
    >
      {children}
    </div>
  );
}
