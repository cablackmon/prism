import { Suspense } from 'react';
import { GoalsView } from './GoalsView';

export const metadata = {
  title: 'Goals',
  description: 'Manage goals and track points earned from chores.',
};

export default function GoalsPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={<GoalsSkeleton />}>
        <GoalsView />
      </Suspense>
    </main>
  );
}

function GoalsSkeleton() {
  return (
    <div className="flex h-screen flex-col p-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="h-10 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    </div>
  );
}
