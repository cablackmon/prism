'use client';

import { useState } from 'react';
import { Emoji } from '@/components/ui/Emoji';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StarRating } from './StarRating';
import { TagChip } from './TagChip';
import { TAG_PRESETS } from '../constants';
import type { WeekendPlace } from '../types';

interface WeekendPlaceFormProps {
  initial?: Partial<WeekendPlace>;
  onSave: (
    data: Omit<
      WeekendPlace,
      'id' | 'visitCount' | 'lastVisitedDate' | 'createdBy' | 'createdAt' | 'updatedAt'
    >
  ) => Promise<void>;
  onCancel: () => void;
  hideHeader?: boolean;
}

export function WeekendPlaceForm({ initial, onSave, onCancel, hideHeader }: WeekendPlaceFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [status, setStatus] = useState<'backlog' | 'visited'>(initial?.status ?? 'backlog');
  const [isFavorite, setIsFavorite] = useState(initial?.isFavorite ?? false);
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [saving, setSaving] = useState(false);

  const toggleTag = (v: string) =>
    setTags((prev) => (prev.includes(v) ? prev.filter((t) => t !== v) : [...prev, v]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        latitude: initial?.latitude ?? null,
        longitude: initial?.longitude ?? null,
        placeName: initial?.placeName ?? null,
        address: initial?.address ?? null,
        url: url.trim() || null,
        status,
        isFavorite,
        rating: status === 'visited' ? rating : null,
        notes: notes.trim() || null,
        tags,
        sourceProvider: initial?.sourceProvider ?? 'manual',
        sourceId: initial?.sourceId ?? null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col">
      {!hideHeader && (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{initial?.id ? 'Edit Place' : 'Add Place'}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div>
          <Label htmlFor="wp-name">Name *</Label>
          <Input
            id="wp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Central Park Zoo"
            className="mt-1"
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="wp-desc">Description</Label>
          <Input
            id="wp-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's there to do?"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="wp-url">Website</Label>
          <Input
            id="wp-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="mt-1"
          />
        </div>

        {/* Status */}
        <div>
          <Label>Status</Label>
          <div className="mt-1 flex gap-2">
            {(['backlog', 'visited'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors ${
                  status === s
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-transparent bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {s === 'backlog' ? 'Want to Try' : 'Been There'}
              </button>
            ))}
          </div>
        </div>

        {/* Rating (visited only) */}
        {status === 'visited' && (
          <div>
            <Label>Rating</Label>
            <StarRating value={rating} onChange={setRating} className="mt-1" />
          </div>
        )}

        {/* Favorite */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsFavorite((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              isFavorite
                ? 'border-amber-400 bg-amber-50 text-amber-600 dark:bg-amber-950'
                : 'border-transparent bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            <Emoji e="⭐" /> {isFavorite ? 'Favorite' : 'Mark as favorite'}
          </button>
        </div>

        {/* Tags */}
        <div>
          <Label>Tags</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {TAG_PRESETS.map((t) => (
              <TagChip
                key={t.value}
                tag={t.value}
                active={tags.includes(t.value)}
                onClick={() => toggleTag(t.value)}
              />
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="wp-notes">Notes</Label>
          <Textarea
            id="wp-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Parking tips, best time to visit, what to get..."
            className="mt-1 resize-none"
            rows={3}
          />
        </div>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || saving} className="flex-1">
          {saving ? 'Saving…' : initial?.id ? 'Save Changes' : 'Add Place'}
        </Button>
      </div>
    </form>
  );
}
