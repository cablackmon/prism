import { Suspense } from 'react';
import { PhotosView } from './PhotosView';

export const metadata = {
  title: 'Photos',
  description: 'Photo gallery and slideshow management.',
};

export default function PhotosPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={<PhotosSkeleton />}>
        <PhotosView />
      </Suspense>
    </main>
  );
}

function PhotosSkeleton() {
  return (
    <div className="flex h-screen flex-col p-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="h-10 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}
