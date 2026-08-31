'use client';

import { isPast, isToday, isTomorrow, parseISO, format } from 'date-fns';
import { Emoji } from '@/components/ui/Emoji';
import {
  AlertCircle,
  Trash2,
  Edit2,
  CheckCircle2,
  Hourglass,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import type { Chore } from '@/types';

export function getCategoryEmoji(category: string): string {
  switch (category) {
    case 'cleaning': return '🧹';
    case 'laundry': return '🧺';
    case 'dishes': return '🍽️';
    case 'yard': return '🌿';
    case 'pets': return '🐾';
    case 'trash': return '🗑️';
    default: return '✨';
  }
}

export function ChoreItem({
  chore,
  onComplete,
  onToggleEnabled,
  onEdit,
  onDelete,
}: {
  chore: Chore;
  onComplete: () => void;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isOverdue = chore.nextDue && isPast(parseISO(chore.nextDue));
  const isPendingApproval = !!chore.pendingApproval;
  const categoryEmoji = getCategoryEmoji(chore.category);

  const formatDueDate = (dateString: string) => {
    const date = parseISO(dateString);
    if (isToday(date)) return 'Due today';
    if (isTomorrow(date)) return 'Due tomorrow';
    if (isPast(date)) return 'Overdue';
    return `Due ${format(date, 'MMM d')}`;
  };

  const formatFrequency = (frequency: string, customDays?: number | null) => {
    switch (frequency) {
      case 'daily': return 'Daily';
      case 'weekly': return 'Weekly';
      case 'biweekly': return 'Every 2 weeks';
      case 'monthly': return 'Monthly';
      case 'custom': return customDays ? `Every ${customDays} days` : 'Custom';
      default: return frequency;
    }
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-4 p-4 rounded-lg border border-border bg-card/85 backdrop-blur-sm',
        'hover:border-seasonal-accent hover:ring-2 hover:ring-seasonal-accent/50 transition-all group',
        !chore.enabled && 'opacity-50',
        isPendingApproval && 'bg-amber-100/85 dark:bg-amber-950/85 border-amber-500/30'
      )}
    >
      {/* Complete button - always enabled for parents, shows pending state visually */}
      <Button
        size="icon"
        variant="ghost"
        onClick={onComplete}
        disabled={!chore.enabled}
        className={cn(
          'flex-shrink-0 h-9 w-9',
          isOverdue && !isPendingApproval && 'text-destructive hover:text-destructive',
          isPendingApproval && 'text-amber-500'
        )}
        title={isPendingApproval ? 'Approve and complete chore' : 'Mark as complete'}
      >
        {isPendingApproval ? (
          <Hourglass className="h-5 w-5" />
        ) : (
          <CheckCircle2 className="h-5 w-5" />
        )}
      </Button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base"><Emoji e={categoryEmoji} /></span>
          <span className={cn(
            'font-medium',
            isPendingApproval && 'text-amber-700 dark:text-amber-400'
          )}>{chore.title}</span>

          {chore.pointValue > 0 && (
            <Badge variant="secondary" className="text-xs">
              +{chore.pointValue} pts
            </Badge>
          )}

          {/* Show pending badge if pending approval, otherwise show requires approval */}
          {isPendingApproval ? (
            <Badge variant="default" className="text-xs bg-amber-500 hover:bg-amber-500">
              Pending Approval
            </Badge>
          ) : chore.requiresApproval && (
            <Badge variant="outline" className="text-xs">
              Requires approval
            </Badge>
          )}

          <Badge variant="outline" className="text-xs capitalize">
            {chore.category}
          </Badge>
        </div>

        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
          {/* Show who completed it if pending approval */}
          {isPendingApproval && chore.pendingApproval && (
            <div className="flex items-center gap-1">
              <UserAvatar
                name={chore.pendingApproval.completedBy.name}
                color={chore.pendingApproval.completedBy.color}
                size="sm"
                className="h-4 w-4 text-[8px]"
              />
              <span className="text-amber-600 dark:text-amber-400">
                Completed by {chore.pendingApproval.completedBy.name}
              </span>
            </div>
          )}

          {/* Show assigned to only if not pending */}
          {!isPendingApproval && chore.assignedTo && (
            <div className="flex items-center gap-1">
              <UserAvatar
                name={chore.assignedTo.name}
                imageUrl={chore.assignedTo.avatarUrl}
                color={chore.assignedTo.color}
                size="sm"
                className="h-4 w-4 text-[8px]"
              />
              <span>{chore.assignedTo.name}</span>
            </div>
          )}

          <span>{formatFrequency(chore.frequency, chore.customIntervalDays)}</span>

          {/* Show due date only if not pending */}
          {!isPendingApproval && chore.nextDue && (
            <span className={cn(isOverdue && 'text-destructive font-medium')}>
              {isOverdue && <AlertCircle className="h-3 w-3 inline mr-1" />}
              {formatDueDate(chore.nextDue)}
            </span>
          )}
        </div>

        {chore.description && (
          <p className="text-sm text-muted-foreground mt-1">{chore.description}</p>
        )}
      </div>

      {/* Edit is deliberately isolated from destructive chore controls. */}
      <div className="mt-3 flex w-full flex-wrap items-center justify-end gap-11 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          className="h-14 min-w-[5.5rem] gap-2"
          aria-label="Edit chore"
        >
          <Edit2 className="h-4 w-4" />
          Edit
        </Button>

        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-1.5" aria-label="Chore controls">
          <label className="flex min-h-14 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground">
            <span>{chore.enabled ? 'Enabled' : 'Disabled'}</span>
            <Switch
              checked={chore.enabled}
              onCheckedChange={onToggleEnabled}
              aria-label={`${chore.enabled ? 'Disable' : 'Enable'} ${chore.title}`}
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-14 min-w-14 gap-2 px-3 text-destructive hover:text-destructive"
            aria-label={`Delete ${chore.title}`}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Delete</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
