import { Suspense } from 'react';
import { BabysitterView } from './BabysitterView';

export const metadata = {
  title: 'Babysitter Info',
  description: 'Important information for babysitters and caregivers.',
};

export default function BabysitterPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={<BabysitterSkeleton />}>
        <BabysitterView />
      </Suspense>
    </main>
  );
}

function BabysitterSkeleton() {
  return (
    <div className="flex h-screen flex-col p-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-10 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="h-6 w-32 animate-pulse rounded bg-muted" />
            <div className="h-32 animate-pulse rounded-lg bg-muted/50" />
          </div>
        ))}
      </div>
    </div>
  );
}
