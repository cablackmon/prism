'use client';

import { SortAsc } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface SortSelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  showSortIcon?: boolean;
  className?: string;
}

export function SortSelect<T extends string>({
  value,
  onValueChange,
  options,
  showSortIcon = false,
  className,
}: SortSelectProps<T>) {
  return (
    <div className={cn('flex shrink-0 items-center gap-1.5', className)}>
      {showSortIcon && <SortAsc className="h-4 w-4 text-muted-foreground" />}
      <Select value={value} onValueChange={(v) => onValueChange(v as T)}>
        <SelectTrigger className="h-8 w-auto min-w-[100px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
