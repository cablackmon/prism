'use client';

import * as React from 'react';
import { ChevronIcon } from './LayoutEditorIcons';

export function PopoverButton({
  label,
  isActive,
  onToggle,
  children,
  width,
  align = 'left',
}: {
  label: React.ReactNode;
  isActive: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  width?: number;
  align?: 'left' | 'right';
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs transition-colors ${
          isActive ? 'bg-accent text-accent-foreground' : 'bg-muted hover:bg-accent'
        }`}
      >
        {label}
        <ChevronIcon open={isActive} />
      </button>
      {isActive && (
        <div
          className="absolute top-full z-50 mt-1 rounded-md border border-border bg-popover shadow-lg"
          style={{
            width: width ?? 'auto',
            ...(align === 'right' ? { right: 0 } : { left: 0 }),
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
