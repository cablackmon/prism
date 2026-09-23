'use client';

import { format } from 'date-fns';
import { isPast, differenceInDays, formatDistanceToNow } from 'date-fns';
import { CalendarDays, Hourglass, Settings, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PendingApproval {
  completionId: string;
  completedBy: { id: string; name: string; color: string };
}

export interface ChoreCardData {
  id: string;
  title: string;
  pointValue: number;
  nextDue?: string | null;
  lastCompleted?: string | null;
  pendingApproval?: PendingApproval | null;
}

interface ChoreGroupCardProps {
  chore: ChoreCardData;
  assignedUser: { id: string; name: string } | null;
  allChores: ChoreCardData[];
  onComplete: () => Promise<boolean>;
  onEdit: () => void;
  onDelete: () => void;
  setCelebratingUser: (user: { id: string; name: string } | null) => void;
}

export function ChoreGroupCard({
  chore,
  assignedUser,
  allChores,
  onComplete,
  onEdit,
  onDelete,
  setCelebratingUser,
}: ChoreGroupCardProps) {
  const nextDue = chore.nextDue ? new Date(chore.nextDue) : null;
  const isOverdue = nextDue && isPast(nextDue);
  const daysUntil = nextDue ? differenceInDays(nextDue, new Date()) : null;
  const isCompletedToday =
    chore.lastCompleted &&
    new Date(chore.lastCompleted) > new Date(Date.now() - 24 * 60 * 60 * 1000);
  const isPendingApproval = !!chore.pendingApproval;

  return (
    <div
      className={cn(
        'group cursor-pointer rounded-md border p-2 transition-colors hover:bg-muted/50',
        isPendingApproval
          ? 'border-amber-500/50 bg-amber-50/80 dark:bg-amber-950/30'
          : isCompletedToday
            ? 'border-green-500/30 bg-green-50/50 opacity-60 dark:bg-green-950/20'
            : isOverdue
              ? 'border-red-500/50 bg-red-50/50 dark:bg-red-950/20'
              : 'border-border'
      )}
      onClick={async () => {
        const success = await onComplete();
        if (success && assignedUser) {
          const otherChores = allChores.filter((c) => c.id !== chore.id);
          const allOthersCompleted = otherChores.every(
            (c) =>
              c.lastCompleted &&
              new Date(c.lastCompleted) > new Date(Date.now() - 24 * 60 * 60 * 1000)
          );
          if (allOthersCompleted && !isCompletedToday) {
            setCelebratingUser({ id: assignedUser.id, name: assignedUser.name });
          }
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isPendingApproval && <Hourglass className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            <p
              className={cn(
                'truncate text-sm font-medium',
                isCompletedToday && !isPendingApproval && 'line-through',
                isPendingApproval && 'text-amber-700 dark:text-amber-400'
              )}
            >
              {chore.title}
            </p>
          </div>
          {isPendingApproval && chore.pendingApproval && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <span>Awaiting approval</span>
              <span className="text-muted-foreground">
                &middot; {chore.pendingApproval.completedBy.name}
              </span>
            </div>
          )}
          {!isPendingApproval && nextDue && !isCompletedToday && (
            <div
              className={cn(
                'mt-0.5 flex items-center gap-1 text-xs',
                isOverdue ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
              )}
            >
              <CalendarDays className="h-3 w-3" />
              {isOverdue ? (
                <span>Due {formatDistanceToNow(nextDue, { addSuffix: true })}</span>
              ) : daysUntil === 0 ? (
                <span>Due today</span>
              ) : daysUntil === 1 ? (
                <span>Due tomorrow</span>
              ) : (
                <span>Due {format(nextDue, 'MMM d')}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isPendingApproval && (
            <Badge
              variant="default"
              className="bg-amber-500 px-1.5 py-0 text-[10px] hover:bg-amber-500"
            >
              Pending
            </Badge>
          )}
          {chore.pointValue > 0 && (
            <Badge variant="secondary" className="text-xs">
              {chore.pointValue} pts
            </Badge>
          )}
        </div>
      </div>
      <div
        className="mt-2 flex flex-col gap-14 border-t border-border/60 pt-2"
        onClick={(event) => event.stopPropagation()}
      >
        <Button
          variant="outline"
          size="sm"
          className="h-14 w-full gap-2"
          aria-label={`Edit ${chore.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Settings className="h-4 w-4" />
          Edit
        </Button>
        <div className="w-full rounded-lg border border-destructive/30 bg-destructive/5 p-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-14 w-full gap-2 px-3 text-destructive hover:text-destructive"
            aria-label={`Delete ${chore.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
