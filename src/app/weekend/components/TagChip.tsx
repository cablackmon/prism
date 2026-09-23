'use client';

import { cn } from '@/lib/utils';
import { TAG_PRESETS } from '../constants';

interface TagChipProps {
  tag: string;
  active?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
}

export function TagChip({ tag, active, onClick, size = 'md' }: TagChipProps) {
  const preset = TAG_PRESETS.find((t) => t.value === tag);
  const label = preset ? `${preset.emoji} ${preset.label}` : tag;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full border transition-colors',
        size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : onClick
            ? 'border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
            : 'cursor-default border-transparent bg-muted/60 text-muted-foreground'
      )}
    >
      {label}
    </button>
  );
}
