/**
 *
 * The full messages page with all family messages.
 * This is the expanded version of the messages widget.
 *
 * FEATURES:
 * - View all messages
 * - Filter by author
 * - Mark messages as pinned/important
 * - Add new messages
 * - Delete messages
 *
 */

import { Suspense } from 'react';
import { MessagesView } from './MessagesView';

/**
 * PAGE METADATA
 */
export const metadata = {
  title: 'Messages',
  description: 'Family message board.',
};

/**
 * MESSAGES PAGE COMPONENT
 */
export default function MessagesPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={<MessagesSkeleton />}>
        <MessagesView />
      </Suspense>
    </main>
  );
}

/**
 * MESSAGES SKELETON
 */
function MessagesSkeleton() {
  return (
    <div className="flex h-screen flex-col p-4">
      {/* Header skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-10 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>

      {/* Message list skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded bg-muted/50" />
        ))}
      </div>
    </div>
  );
}
