'use client';

import { Star, ExternalLink, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VisitPips } from './VisitPips';
import { StarRating } from './StarRating';
import { TagChip } from './TagChip';
import { STATUS_CONFIG } from '../constants';
import type { WeekendPlace } from '../types';

interface WeekendPlaceCardProps {
  place: WeekendPlace;
  selected?: boolean;
  onClick: () => void;
}

export function WeekendPlaceCard({ place, selected, onClick }: WeekendPlaceCardProps) {
  const cfg = STATUS_CONFIG[place.status];
  const pipColor = place.isFavorite
    ? '#F59E0B'
    : place.status === 'visited'
      ? '#10B981'
      : '#6B7280';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border-2 bg-card text-left transition-all hover:shadow-md active:scale-[0.99]',
        selected ? 'border-primary shadow-md' : 'border-border hover:border-muted-foreground/30'
      )}
    >
      <div className="space-y-2 p-3">
        {/* Header row */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {place.isFavorite && (
                <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
              )}
              <h3 className="truncate text-sm font-semibold leading-tight">{place.name}</h3>
            </div>
            {place.placeName && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                {place.placeName}
              </p>
            )}
          </div>
          {place.url && (
            <a
              href={place.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
              title="Open website"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        {/* Status + pips row */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              cfg.bgClass,
              cfg.textClass
            )}
          >
            {cfg.label}
          </span>
          <VisitPips count={place.visitCount} color={pipColor} />
        </div>

        {/* Rating (only when visited) */}
        {place.status === 'visited' && place.rating && (
          <StarRating value={place.rating} size="sm" />
        )}

        {/* Tags */}
        {place.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {place.tags.slice(0, 4).map((tag) => (
              <TagChip key={tag} tag={tag} size="sm" />
            ))}
            {place.tags.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{place.tags.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
