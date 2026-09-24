'use client';

import { format, isPast, differenceInDays, formatDistanceToNow } from 'date-fns';
import { CalendarDays, Settings, Trash2 } from 'lucide-react';
import { UserAvatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Task } from '@/types';

export function TaskRow({
  task,
  onToggle,
  onEdit,
  onDelete,
  showAvatar = false,
  showList = false,
  taskLists = [],
}: {
  task: Task;
  onToggle: () => void;
  onEdit: () => void;
  /** Omitted where a row is not deletable; the button is then not rendered. */
  onDelete?: () => void;
  showAvatar?: boolean;
  showList?: boolean;
  taskLists?: Array<{ id: string; name: string; color?: string | null }>;
}) {
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const isOverdue = dueDate && !task.completed && isPast(dueDate);
  const daysUntil = dueDate ? differenceInDays(dueDate, new Date()) : null;
  const taskList = showList
    ? taskLists.find((l) => l.id === (task as typeof task & { listId?: string }).listId)
    : null;

  return (
    <div
      className={cn(
        'cursor-pointer rounded-md border p-2 transition-colors hover:bg-muted/50',
        task.completed ? 'border-green-500/30 bg-green-50/50 opacity-60 dark:bg-green-950/20' : '',
        isOverdue
          ? 'border-red-500/50 bg-red-50/50 dark:bg-red-950/20'
          : !task.completed
            ? 'border-border'
            : ''
      )}
      onClick={onToggle}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {showAvatar && task.assignedTo && (
            <UserAvatar
              name={task.assignedTo.name}
              color={task.assignedTo.color}
              size="sm"
              className="mt-0.5 h-5 w-5 shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'truncate text-sm font-medium',
                task.completed && 'text-muted-foreground line-through'
              )}
            >
              {task.title}
            </p>
            {(dueDate || taskList) && !task.completed && (
              <div className="mt-0.5 flex items-center gap-2">
                {dueDate && (
                  <div
                    className={cn(
                      'flex items-center gap-1 text-xs',
                      isOverdue ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
                    )}
                  >
                    <CalendarDays className="h-3 w-3" />
                    {isOverdue ? (
                      <span>Due {formatDistanceToNow(dueDate, { addSuffix: true })}</span>
                    ) : daysUntil === 0 ? (
                      <span>Due today</span>
                    ) : daysUntil === 1 ? (
                      <span>Due tomorrow</span>
                    ) : (
                      <span>Due {format(dueDate, 'MMM d')}</span>
                    )}
                  </div>
                )}
                {taskList && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: taskList.color || '#6B7280' }}
                    />
                    <span>{taskList.name}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {task.priority === 'high' && (
            <Badge variant="destructive" className="text-xs">
              !
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            aria-label="Edit task"
          >
            <Settings className="h-3 w-3" />
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-50 hover:text-destructive hover:opacity-100"
              onClick={(e) => {
                // The row itself toggles completion, so a delete tap must not
                // also mark the task done on its way out.
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete task"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
