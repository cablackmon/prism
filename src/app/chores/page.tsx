/**
 *
 * The full chore management page with filtering, sorting, and full CRUD.
 * This is the expanded version of the chores widget.
 *
 * FEATURES:
 * - View all chores with filtering
 * - Filter by person, category, frequency
 * - Sort by next due date, category, frequency
 * - Add new chores
 * - Edit existing chores
 * - Complete chores with approval workflow
 * - Enable/disable chores
 * - Delete chores
 *
 */

import { Suspense } from 'react';
import { ChoresView } from './ChoresView';

/**
 * PAGE METADATA
 */
export const metadata = {
  title: 'Chores',
  description: 'Manage household chores and track completion.',
};

/**
 * CHORES PAGE COMPONENT
 */
export default function ChoresPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={<ChoresSkeleton />}>
        <ChoresView />
      </Suspense>
    </main>
  );
}

/**
 * CHORES SKELETON
 */
function ChoresSkeleton() {
  return (
    <div className="flex h-screen flex-col p-4">
      {/* Header skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-10 w-32 animate-pulse rounded bg-muted" />
          <div className="h-10 w-24 animate-pulse rounded bg-muted" />
        </div>
      </div>

      {/* Filter bar skeleton */}
      <div className="mb-4 flex gap-2">
        <div className="h-10 w-40 animate-pulse rounded bg-muted" />
        <div className="h-10 w-40 animate-pulse rounded bg-muted" />
        <div className="h-10 w-40 animate-pulse rounded bg-muted" />
      </div>

      {/* Chore list skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded bg-muted/50" />
        ))}
      </div>
    </div>
  );
}
