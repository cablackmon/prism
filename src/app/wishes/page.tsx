import { Suspense } from 'react';
import { WishesView } from './WishesView';

export const metadata = {
  title: 'Wishes',
  description: 'Family wish lists for birthdays, holidays, and anytime.',
};

export default function WishesPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={<WishesSkeleton />}>
        <WishesView />
      </Suspense>
    </main>
  );
}

function WishesSkeleton() {
  return (
    <div className="flex h-screen flex-col p-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="h-10 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="mb-4 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-20 animate-pulse rounded bg-muted" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded bg-muted/50" />
        ))}
      </div>
    </div>
  );
}
