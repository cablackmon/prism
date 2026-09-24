/**
 *
 * The full-screen calendar view with multiple display options.
 * This is the expanded version of the calendar widget.
 *
 * VIEWS:
 * - Day: Single day with hourly breakdown
 * - Week: Current week overview
 * - Two-Week: Current + next week (default)
 * - Month: Full calendar month
 *
 * FEATURES:
 * - View switching between day/week/two-week/month
 * - Calendar filtering by family member
 * - Event creation (tap on empty time slot)
 * - Event details (tap on event)
 * - Navigation (previous/next period)
 *
 */

import { Suspense } from 'react';
import { CalendarView } from './CalendarView';

/**
 * PAGE METADATA
 */
export const metadata = {
  title: 'Calendar',
  description: 'View and manage your family calendar events.',
};

/**
 * CALENDAR PAGE COMPONENT
 * Server component that renders the calendar page.
 * The CalendarView is a client component for interactivity.
 */
export default function CalendarPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={<CalendarSkeleton />}>
        <CalendarView />
      </Suspense>
    </main>
  );
}

/**
 * CALENDAR SKELETON
 * Loading placeholder while the calendar component loads.
 */
function CalendarSkeleton() {
  return (
    <div className="flex h-screen flex-col p-4">
      {/* Header skeleton */}
      <div className="mb-4 flex items-center justify-between">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-10 w-24 animate-pulse rounded bg-muted" />
          <div className="h-10 w-24 animate-pulse rounded bg-muted" />
        </div>
      </div>

      {/* Calendar grid skeleton */}
      <div className="grid flex-1 grid-cols-7 gap-1">
        {/* Day headers */}
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={`header-${i}`} className="h-8 animate-pulse rounded bg-muted/50" />
        ))}

        {/* Calendar cells */}
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={`cell-${i}`} className="h-24 animate-pulse rounded bg-muted/30" />
        ))}
      </div>
    </div>
  );
}
