'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { cn } from '@/lib/utils';

export interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
}

export function FilterBar({ children, className }: FilterBarProps) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);

  if (isMobile) {
    return (
      <div
        className={cn(
          'flex-shrink-0 border-b border-border bg-card/85 backdrop-blur-sm',
          className
        )}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>Filters</span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
          />
        </button>
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-200',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pb-2">
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'max-h-24 flex-shrink-0 overflow-y-auto border-b border-border bg-card/85 px-3 py-1.5 backdrop-blur-sm',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">{children}</div>
    </div>
  );
}
