/**
 *
 * The full shopping list management page with multiple lists and items.
 * This is the expanded version of the shopping widget.
 *
 * FEATURES:
 * - Multiple shopping lists (Grocery, Target, etc.)
 * - Add/edit/delete lists
 * - Add/edit/delete items
 * - Check off items as purchased
 * - Filter by list and checked status
 * - Sort by category
 * - Progress tracking
 *
 */

import { Suspense } from 'react';
import { ShoppingView } from './ShoppingView';

/**
 * PAGE METADATA
 */
export const metadata = {
  title: 'Shopping',
  description: 'Manage your shopping lists and items.',
};

/**
 * SHOPPING PAGE COMPONENT
 */
export default function ShoppingPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={<ShoppingSkeleton />}>
        <ShoppingView />
      </Suspense>
    </main>
  );
}

/**
 * SHOPPING SKELETON
 */
function ShoppingSkeleton() {
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

      {/* Lists skeleton */}
      <div className="mb-4 flex gap-2">
        <div className="h-10 w-24 animate-pulse rounded bg-muted" />
        <div className="h-10 w-24 animate-pulse rounded bg-muted" />
        <div className="h-10 w-24 animate-pulse rounded bg-muted" />
      </div>

      {/* Item list skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-muted/50" />
        ))}
      </div>
    </div>
  );
}
