'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Settings error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold">Settings Error</h1>
        <p className="text-muted-foreground">
          {process.env.NODE_ENV === 'development'
            ? error.message
            : 'Failed to load settings. Please try again.'}
        </p>
        <div className="flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md bg-secondary px-4 py-2 text-secondary-foreground hover:opacity-90"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
