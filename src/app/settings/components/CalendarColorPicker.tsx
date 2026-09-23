'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const calendarColorOptions = [
  '#3B82F6',
  '#EC4899',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EF4444',
  '#06B6D4',
  '#84CC16',
  '#F97316',
  '#6366F1',
  '#14B8A6',
  '#A855F7',
  '#F43F5E',
  '#0EA5E9',
  '#D946EF',
  '#FFFFFF',
  '#9CA3AF',
  '#6B7280',
  '#374151',
  '#000000',
];

export function CalendarColorPicker({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="h-5 w-5 rounded-full border-2 border-border transition-transform hover:scale-110"
        style={{ backgroundColor: color }}
        title="Change color"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-5 z-20 rounded-lg border border-border bg-card p-2 shadow-lg">
            <div className="flex w-[140px] flex-wrap gap-1.5">
              {calendarColorOptions.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className={cn(
                    'h-5 w-5 rounded-full border-2 transition-transform hover:scale-110',
                    color === c ? 'scale-110 border-foreground' : 'border-transparent'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
