'use client';

import * as React from 'react';
import { Emoji } from '@/components/ui/Emoji';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { TravelTrip, TripStyle } from '../types';
import { TRIP_STYLE_CONFIG } from '../types';

interface TripFormProps {
  initialData?: Partial<TravelTrip>;
  hideHeader?: boolean;
  onSave: (
    data: Omit<TravelTrip, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'stops'>
  ) => Promise<void>;
  onCancel: () => void;
}

export function TripForm({ initialData, hideHeader, onSave, onCancel }: TripFormProps) {
  const [name, setName] = React.useState(initialData?.name ?? '');
  const [description, setDescription] = React.useState(initialData?.description ?? '');
  const [tripStyle, setTripStyle] = React.useState<TripStyle>(initialData?.tripStyle ?? 'route');
  const [status, setStatus] = React.useState<'want_to_go' | 'been_there'>(
    initialData?.status ?? 'want_to_go'
  );
  const [visitedDate, setVisitedDate] = React.useState(initialData?.visitedDate ?? '');
  const [visitedEndDate, setVisitedEndDate] = React.useState(initialData?.visitedEndDate ?? '');
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        tripStyle,
        status,
        isBucketList: false,
        color: null,
        emoji: null,
        visitedDate: visitedDate || null,
        visitedEndDate: visitedEndDate || null,
        year: visitedDate ? new Date(visitedDate).getFullYear() : null,
        memberIds: [],
        tags: [],
        sortOrder: 0,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col">
      {/* Header */}
      {!hideHeader && (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{initialData?.id ? 'Edit Trip' : 'New Trip'}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Trip Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Pacific Coast Road Trip"
            className="text-sm"
            autoFocus
            required
          />
        </div>

        {/* Trip style */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Trip Style
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              Object.entries(TRIP_STYLE_CONFIG) as [
                TripStyle,
                (typeof TRIP_STYLE_CONFIG)[TripStyle],
              ][]
            ).map(([key, cfg]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTripStyle(key)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-colors',
                  tripStyle === key
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground'
                )}
              >
                <span className="text-lg leading-none">{cfg.icon}</span>
                <span className="text-xs font-medium">{cfg.label}</span>
                <span className="text-[10px] leading-snug opacity-75">{cfg.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Status */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </label>
          <div className="flex gap-2">
            {(['want_to_go', 'been_there'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  'flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors',
                  status === s
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {s === 'been_there' ? (
                  '✓ Been There'
                ) : (
                  <>
                    <Emoji e="📍" /> Want to Go
                  </>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Dates */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {status === 'been_there' ? 'Trip Dates' : 'Planned Dates'}
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={visitedDate}
              onChange={(e) => setVisitedDate(e.target.value)}
              className="flex-1 text-sm"
            />
            <span className="shrink-0 text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={visitedEndDate}
              onChange={(e) => setVisitedEndDate(e.target.value)}
              className="flex-1 text-sm"
              min={visitedDate}
            />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Notes
          </label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Trip notes, highlights, memories…"
            className="resize-none text-sm"
            rows={3}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1 text-sm">
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !name.trim()} className="flex-1 text-sm">
          {saving ? 'Saving…' : initialData?.id ? 'Save Changes' : 'Create Trip'}
        </Button>
      </div>
    </form>
  );
}
