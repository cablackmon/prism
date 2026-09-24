'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  /** Renders a separator + section label before this option */
  dividerBefore?: string;
}

export interface FilterDropdownProps {
  /** Display label on the trigger button */
  label: string;
  /** All available options */
  options: FilterOption[];
  /** Currently selected values (empty set = no filter) */
  selected: Set<string>;
  /** Called when selection changes */
  onSelectionChange: (selected: Set<string>) => void;
  /** 'multi' for checkboxes, 'single' for radio-style (default: 'multi') */
  mode?: 'multi' | 'single';
  /** Optional icon on the trigger button */
  icon?: React.ReactNode;
  /** Additional className for the trigger */
  className?: string;
}

export function FilterDropdown({
  label,
  options,
  selected,
  onSelectionChange,
  mode = 'multi',
  icon,
  className,
}: FilterDropdownProps) {
  const isActive = selected.size > 0;
  const activeCount = selected.size;

  // For single mode, show the selected label in the trigger
  const singleLabel =
    mode === 'single' && selected.size === 1
      ? options.find((o) => selected.has(o.value))?.label
      : null;

  const handleToggle = (value: string) => {
    if (mode === 'single') {
      if (selected.has(value)) {
        onSelectionChange(new Set());
      } else {
        onSelectionChange(new Set([value]));
      }
    } else {
      const next = new Set(selected);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      onSelectionChange(next);
    }
  };

  const clearAll = () => onSelectionChange(new Set());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={isActive ? 'secondary' : 'outline'}
          size="sm"
          className={cn('h-8 shrink-0 gap-1', className)}
          aria-label={`${label}${activeCount > 0 ? `, ${activeCount} selected` : ''}`}
        >
          {icon}
          <span>{singleLabel ? `${label}: ${singleLabel}` : label}</span>
          {mode === 'multi' && activeCount > 0 && (
            <Badge variant="default" className="ml-0.5 h-4 min-w-4 px-1 text-[10px] leading-none">
              {activeCount}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {options.map((option) => (
          <React.Fragment key={option.value}>
            {option.dividerBefore && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 py-1 text-xs font-normal text-muted-foreground">
                  {option.dividerBefore}
                </DropdownMenuLabel>
              </>
            )}
            <DropdownMenuCheckboxItem
              checked={selected.has(option.value)}
              onCheckedChange={() => handleToggle(option.value)}
              onSelect={mode === 'multi' ? (e) => e.preventDefault() : undefined}
            >
              <span className="flex items-center gap-2">
                {option.icon}
                {option.label}
              </span>
            </DropdownMenuCheckboxItem>
          </React.Fragment>
        ))}
        {isActive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={clearAll}
              className="justify-center text-xs text-muted-foreground"
            >
              Clear all
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
