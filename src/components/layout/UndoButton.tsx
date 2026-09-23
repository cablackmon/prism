'use client';

import { useEffect } from 'react';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUndoStack, clearUndo } from '@/lib/hooks/useUndoStack';
import { toast } from '@/components/ui/use-toast';

export function UndoButton() {
  const { canUndo, count, undo } = useUndoStack();

  // Clear stale undos from other pages on unmount (navigation)
  useEffect(() => {
    return () => clearUndo();
  }, []);

  if (!canUndo) return null;

  const handleUndo = async () => {
    const success = await undo();
    if (!success) {
      toast({ title: 'Undo failed', variant: 'destructive' });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleUndo}
      className="gap-1"
      title="Undo last action"
    >
      <Undo2 className="h-4 w-4" />
      {count > 1 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
          {count}
        </span>
      )}
    </Button>
  );
}
