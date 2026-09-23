'use client';

import { cn } from '@/lib/utils';

export interface PersonFilterProps {
  members: Array<{ id: string; name: string; color: string; avatarUrl?: string | null }>;
  selected: string[] | null;
  onSelect: (ids: string[] | null) => void;
  className?: string;
}

export function PersonFilter({ members, selected, onSelect, className }: PersonFilterProps) {
  const isAll = !selected || selected.length === 0;

  const toggle = (id: string) => {
    const current = selected ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onSelect(next.length === 0 ? null : next);
  };

  return (
    <div className={cn('flex shrink-0 flex-wrap gap-1', className)}>
      <button
        onClick={() => onSelect(null)}
        className={cn(
          'h-8 rounded-md px-3 text-sm font-medium transition-colors',
          isAll ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-accent'
        )}
      >
        All
      </button>
      {members.map((member) => {
        const active = selected?.includes(member.id) ?? false;
        return (
          <button
            key={member.id}
            onClick={() => toggle(member.id)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <span
              className="h-3 w-3 flex-shrink-0 rounded-full"
              style={{ backgroundColor: member.color }}
            />
            <span className="hidden sm:inline">{member.name}</span>
          </button>
        );
      })}
    </div>
  );
}
