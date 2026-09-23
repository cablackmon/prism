'use client';

import { isToday, isTomorrow, isPast, format } from 'date-fns';
import { AlertCircle, Trash2, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/avatar';
import type { Task } from '@/types';

interface TaskList {
  id: string;
  name: string;
  color?: string | null;
}

export function TaskItem({
  task,
  onToggle,
  onEdit,
  onDelete,
  taskLists = [],
}: {
  task: Task;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  taskLists?: TaskList[];
}) {
  const taskList = taskLists.find((l) => l.id === task.listId);
  const isOverdue = task.dueDate && isPast(task.dueDate) && !task.completed;

  const formatDueDate = (date: Date | string) => {
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'MMM d');
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-4 rounded-lg border border-border bg-card/85 p-4 backdrop-blur-sm',
        'transition-all hover:border-seasonal-accent hover:ring-2 hover:ring-seasonal-accent/50',
        task.completed && 'opacity-60'
      )}
    >
      {/* Checkbox */}
      <Checkbox
        checked={task.completed}
        onCheckedChange={onToggle}
        className="flex-shrink-0"
        style={task.assignedTo ? { borderColor: task.assignedTo.color } : undefined}
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn('font-medium', task.completed && 'text-muted-foreground line-through')}
          >
            {task.title}
          </span>

          {task.priority === 'high' && (
            <Badge variant="destructive" className="text-xs">
              High
            </Badge>
          )}

          {task.category && (
            <Badge variant="outline" className="text-xs">
              {task.category}
            </Badge>
          )}
        </div>

        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
          {task.assignedTo && (
            <div className="flex items-center gap-1">
              <UserAvatar
                name={task.assignedTo.name}
                color={task.assignedTo.color}
                size="sm"
                className="h-4 w-4 text-[8px]"
              />
              <span>{task.assignedTo.name}</span>
            </div>
          )}

          {task.dueDate && (
            <span className={cn(isOverdue && 'font-medium text-destructive')}>
              {isOverdue && <AlertCircle className="mr-1 inline h-3 w-3" />}
              {formatDueDate(task.dueDate)}
            </span>
          )}
        </div>
      </div>

      {/* List Tag */}
      {taskList && (
        <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: taskList.color || '#6B7280' }}
          />
          <span>{taskList.name}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-50 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Edit task"
        >
          <Edit2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          aria-label="Delete task"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
