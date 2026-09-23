'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface PinDisplayProps {
  length: number;
  filled: number;
  error: boolean;
  isShaking: boolean;
}

/**
 * PIN DISPLAY COMPONENT
 * Shows dots indicating PIN entry progress.
 * Filled dots = entered digits, empty dots = remaining positions.
 */
export function PinDisplay({ length, filled, error, isShaking }: PinDisplayProps) {
  return (
    <div className={cn('flex gap-3', isShaking && 'animate-shake')}>
      {Array.from({ length }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-4 w-4 rounded-full transition-all duration-150',
            i < filled
              ? error
                ? 'scale-110 bg-destructive'
                : 'scale-110 bg-primary'
              : 'border-2 border-border bg-muted'
          )}
        />
      ))}
    </div>
  );
}
