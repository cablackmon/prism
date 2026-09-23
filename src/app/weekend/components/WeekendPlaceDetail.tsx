'use client';

import { X, Star, ExternalLink, MapPin, Pencil, Trash2, CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VisitPips } from './VisitPips';
import { StarRating } from './StarRating';
import { TagChip } from './TagChip';
import { STATUS_CONFIG } from '../constants';
import type { WeekendPlace } from '../types';

interface WeekendPlaceDetailProps {
  place: WeekendPlace;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onMarkVisited: () => void;
}

export function WeekendPlaceDetail({
  place,
  onClose,
  onEdit,
  onDelete,
  onToggleFavorite,
  onMarkVisited,
}: WeekendPlaceDetailProps) {
  const cfg = STATUS_CONFIG[place.status];
  const pipColor = place.isFavorite
    ? '#F59E0B'
    : place.status === 'visited'
      ? '#10B981'
      : '#6B7280';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {place.isFavorite && (
              <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />
            )}
            <h2 className="text-base font-bold leading-tight">{place.name}</h2>
          </div>
          {place.placeName && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              {place.placeName}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {/* Status + visits */}
        <div className="flex items-center justify-between">
          <span
            className={cn('rounded-full px-2 py-1 text-xs font-medium', cfg.bgClass, cfg.textClass)}
          >
            {cfg.label}
          </span>
          <VisitPips count={place.visitCount} color={pipColor} />
        </div>

        {/* Rating */}
        {place.status === 'visited' && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Rating</p>
            <StarRating value={place.rating} size="md" />
            {place.lastVisitedDate && (
              <p className="text-xs text-muted-foreground">Last visited: {place.lastVisitedDate}</p>
            )}
          </div>
        )}

        {/* Description */}
        {place.description && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">About</p>
            <p className="text-sm">{place.description}</p>
          </div>
        )}

        {/* Notes */}
        {place.notes && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Notes</p>
            <p className="whitespace-pre-wrap text-sm">{place.notes}</p>
          </div>
        )}

        {/* Tags */}
        {place.tags.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {place.tags.map((tag) => (
                <TagChip key={tag} tag={tag} />
              ))}
            </div>
          </div>
        )}

        {/* Website */}
        {place.url && (
          <a
            href={place.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Visit website
          </a>
        )}

        {/* Address */}
        {place.address && <p className="text-xs text-muted-foreground">{place.address}</p>}
      </div>

      {/* Actions */}
      <div className="shrink-0 space-y-2 border-t border-border px-4 py-3">
        {place.status === 'backlog' && (
          <Button onClick={onMarkVisited} className="w-full" size="sm" variant="default">
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Mark as Visited
          </Button>
        )}
        {place.status === 'visited' && (
          <Button onClick={onMarkVisited} className="w-full" size="sm" variant="outline">
            <Circle className="mr-1.5 h-4 w-4" />
            Log Another Visit
          </Button>
        )}
        <div className="flex gap-2">
          <Button
            onClick={onToggleFavorite}
            variant="outline"
            size="sm"
            className={cn('flex-1', place.isFavorite && 'border-amber-400 text-amber-500')}
          >
            <Star className={cn('mr-1.5 h-4 w-4', place.isFavorite && 'fill-amber-400')} />
            {place.isFavorite ? 'Unfavorite' : 'Favorite'}
          </Button>
          <Button onClick={onEdit} variant="outline" size="sm" className="flex-1">
            <Pencil className="mr-1.5 h-4 w-4" />
            Edit
          </Button>
          <Button
            onClick={onDelete}
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
