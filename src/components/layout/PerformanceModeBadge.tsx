'use client';

import { Zap } from 'lucide-react';
import { usePerformanceMode } from '@/lib/hooks/usePerformanceMode';

export function PerformanceModeBadge() {
  const { enabled, setEnabled } = usePerformanceMode();
  if (!enabled) return null;

  return (
    <button
      onClick={() => setEnabled(false)}
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent"
      aria-label="Performance Mode active — click to turn off"
      title="Performance Mode active — click to turn off"
    >
      <Zap className="h-4 w-4" />
    </button>
  );
}
