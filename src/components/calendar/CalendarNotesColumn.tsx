'use client';

import { format } from 'date-fns';
import { NoteEditor } from './NoteEditor';
import type { CalendarNote } from '@/lib/hooks/useCalendarNotes';

interface CalendarNotesColumnProps {
  days: Date[];
  notesByDate: Map<string, CalendarNote>;
  onNoteChange?: (date: string, content: string) => void;
  hideDateHeaders?: boolean;
}

export function CalendarNotesColumn({
  days,
  notesByDate,
  onNoteChange,
  hideDateHeaders,
}: CalendarNotesColumnProps) {
  return (
    <div className="h-full overflow-auto">
      {days.map((day) => {
        const dateKey = format(day, 'yyyy-MM-dd');
        const note = notesByDate.get(dateKey);
        return (
          <div key={dateKey} className="border-b border-border/50">
            {!hideDateHeaders && (
              <div className="px-3 pb-1 pt-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {format(day, 'EEE, MMM d')}
                </span>
              </div>
            )}
            <NoteEditor
              dateKey={dateKey}
              content={note?.content || ''}
              onNoteChange={onNoteChange}
              className="min-h-[48px] px-3 pb-3"
            />
          </div>
        );
      })}
    </div>
  );
}
