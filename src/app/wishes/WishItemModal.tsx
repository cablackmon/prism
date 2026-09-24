'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { WishItem } from '@/types';

interface WishItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { name: string; url?: string; notes?: string }) => Promise<void>;
  editingItem?: WishItem | null;
}

export function WishItemModal({ open, onOpenChange, onSave, editingItem }: WishItemModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editingItem?.name || '');
      setUrl(editingItem?.url || '');
      setNotes(editingItem?.notes || '');
    }
  }, [open, editingItem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        url: url.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editingItem ? 'Edit Wish' : 'Add Wish'}</DialogTitle>
          <DialogDescription>
            {editingItem ? 'Update this wish list item.' : 'Add something to the wish list.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="wish-name" className="mb-1.5 block text-sm font-medium">
              Name
            </label>
            <Input
              id="wish-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What do you want?"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="wish-url" className="mb-1.5 block text-sm font-medium">
              Link (optional)
            </label>
            <Input
              id="wish-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              type="url"
            />
          </div>

          <div>
            <label htmlFor="wish-notes" className="mb-1.5 block text-sm font-medium">
              Notes (optional)
            </label>
            <Input
              id="wish-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Size, color, etc."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving ? 'Saving...' : editingItem ? 'Save' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
