'use client';

import { useState, useMemo, useRef } from 'react';
import { toast } from '@/components/ui/use-toast';
import {
  Lightbulb,
  Plus,
  ExternalLink,
  Pencil,
  Trash2,
  GripVertical,
  DollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CarouselArrows } from '@/components/ui/CarouselArrows';
import { EmptyState } from '@/components/ui/empty-state';
import { PageLoader } from '@/components/ui/spinner';
import { useConfirmDialog } from '@/lib/hooks/useConfirmDialog';
import { useFamily } from '@/components/providers/FamilyProvider';
import { useAuth } from '@/components/providers';
import { useGiftIdeas } from '@/lib/hooks/useGiftIdeas';
import { cn } from '@/lib/utils';
import { useOrientation } from '@/lib/hooks/useOrientation';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import type { GiftIdea, FamilyMember } from '@/types';

interface GiftIdeasViewProps {
  /** PersonFilter selection from the parent. null/empty = show all members. */
  selectedMemberIds?: string[] | null;
}

export function GiftIdeasView({ selectedMemberIds }: GiftIdeasViewProps = {}) {
  const { members } = useFamily();
  const { activeUser, requireAuth } = useAuth();
  const { ideas, loading, error, addIdea, updateIdea, deleteIdea, togglePurchased } = useGiftIdeas(
    activeUser?.id
  );
  const { confirm, dialogProps } = useConfirmDialog();
  const orientation = useOrientation();
  const isMobile = useIsMobile();
  const isPortrait = orientation === 'portrait';

  const [editingIdea, setEditingIdea] = useState<GiftIdea | null>(null);
  const [quickAddByUser, setQuickAddByUser] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const otherMembers = useMemo(() => {
    // Gift ideas are tracked for OTHER people — never render a self-column
    // (the API already excludes the active user, so a self-column is blank).
    const withoutSelf = members.filter((m) => m.id !== activeUser?.id);
    const hasFilter = selectedMemberIds && selectedMemberIds.length > 0;
    if (!hasFilter) return withoutSelf;
    return withoutSelf.filter((m) => selectedMemberIds!.includes(m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, selectedMemberIds?.join(','), activeUser?.id]);

  // Group ideas by forUserId
  const ideasByUser = useMemo(() => {
    const map: Record<string, GiftIdea[]> = {};
    for (const idea of ideas) {
      if (!map[idea.forUserId]) map[idea.forUserId] = [];
      map[idea.forUserId]!.push(idea);
    }
    return map;
  }, [ideas]);

  const handleQuickAdd = async (forUserId: string) => {
    const name = (quickAddByUser[forUserId] || '').trim();
    if (!name) return;
    const user = await requireAuth("Who's adding this idea?");
    if (!user) return;
    try {
      await addIdea({ forUserId, name });
      setQuickAddByUser((prev) => ({ ...prev, [forUserId]: '' }));
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Failed to add',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (idea: GiftIdea) => {
    const ok = await confirm(
      `Remove "${idea.name}"?`,
      'This gift idea will be permanently deleted.'
    );
    if (!ok) return;
    try {
      await deleteIdea(idea.id);
      toast({ title: `Removed "${idea.name}"` });
    } catch {
      toast({ title: 'Failed to delete', variant: 'destructive' });
    }
  };

  const handleTogglePurchased = async (idea: GiftIdea) => {
    try {
      await togglePurchased(idea.id);
    } catch {
      toast({ title: 'Failed to update', variant: 'destructive' });
    }
  };

  if (!activeUser) {
    return (
      <div className="flex h-64 items-center justify-center">
        <EmptyState icon={<Lightbulb />} title="Log in to see your gift ideas" />
      </div>
    );
  }

  if (loading) {
    return <PageLoader className="py-8" />;
  }

  if (error) {
    return <div className="py-8 text-center text-destructive">{error}</div>;
  }

  // See ChoreGroupGrid for full context. N members visible at a time
  // (1 mobile, 4 desktop); snap carousel when total exceeds N.
  const groupsPerScreen = isMobile ? 1 : 4;
  const isCarousel = otherMembers.length > groupsPerScreen;
  const colTrack = isCarousel
    ? isMobile
      ? 'calc(100vw - 32px)'
      : `calc((100% - ${(groupsPerScreen - 1) * 12}px) / ${groupsPerScreen})`
    : 'minmax(220px, 1fr)';
  return (
    <>
      <div className="relative h-full">
        <div
          ref={scrollRef}
          className={cn(
            // See ChoreGroupGrid for the grid-rows-1 reasoning.
            'grid h-full grid-rows-1 gap-3 overflow-x-auto scroll-smooth',
            isCarousel && 'snap-x snap-mandatory'
          )}
          style={{
            gridTemplateColumns: `repeat(${Math.max(otherMembers.length, 1)}, ${colTrack})`,
          }}
        >
          {otherMembers.map((member) => {
            const memberIdeas = ideasByUser[member.id] || [];
            return (
              <div
                key={member.id}
                className={cn(
                  'flex min-h-0 flex-col overflow-hidden rounded-xl border-2 bg-card/50',
                  isCarousel && 'snap-start'
                )}
                style={{ borderColor: member.color }}
              >
                {/* Card header */}
                <div
                  className="flex shrink-0 select-none items-center gap-1 px-2 py-1.5"
                  style={{ backgroundColor: member.color + '20' }}
                >
                  <Lightbulb className="h-4 w-4 shrink-0" style={{ color: member.color }} />
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: member.color }}
                  />
                  <h3 className="truncate text-sm font-semibold" style={{ color: member.color }}>
                    {member.name}
                  </h3>
                  <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">
                    {memberIdeas.length}
                  </span>
                </div>

                {/* Quick add + item list */}
                <div className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
                  <Input
                    placeholder={`Gift idea for ${member.name}...`}
                    value={quickAddByUser[member.id] || ''}
                    onChange={(e) =>
                      setQuickAddByUser((prev) => ({ ...prev, [member.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleQuickAdd(member.id);
                      }
                    }}
                    className="mb-1 h-8 text-sm"
                  />
                  {memberIdeas.length === 0 ? (
                    <EmptyState size="sm" title="No ideas yet" />
                  ) : (
                    memberIdeas.map((idea) => (
                      <GiftIdeaRow
                        key={idea.id}
                        idea={idea}
                        onTogglePurchased={() => handleTogglePurchased(idea)}
                        onEdit={() => setEditingIdea(idea)}
                        onDelete={() => handleDelete(idea)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {isCarousel && !isMobile && <CarouselArrows scrollRef={scrollRef} />}
      </div>

      {/* Edit modal (inline for simplicity) */}
      {editingIdea && (
        <EditGiftIdeaModal
          idea={editingIdea}
          onClose={() => setEditingIdea(null)}
          onSave={async (data) => {
            try {
              await updateIdea(editingIdea.id, data);
              setEditingIdea(null);
              toast({ title: 'Gift idea updated' });
            } catch {
              toast({ title: 'Failed to update', variant: 'destructive' });
            }
          }}
        />
      )}

      <ConfirmDialog {...dialogProps} />
    </>
  );
}

function GiftIdeaRow({
  idea,
  onTogglePurchased,
  onEdit,
  onDelete,
}: {
  idea: GiftIdea;
  onTogglePurchased: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2',
        'group transition-colors hover:bg-muted/50',
        idea.purchased && 'opacity-60'
      )}
      onClick={onTogglePurchased}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'truncate text-sm font-medium',
              idea.purchased && 'text-muted-foreground line-through'
            )}
          >
            {idea.name}
          </span>
          {idea.url && (
            <a
              href={idea.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title="Open link"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {idea.price && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {idea.price}
            </span>
          )}
        </div>
        {idea.notes && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{idea.notes}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function EditGiftIdeaModal({
  idea,
  onClose,
  onSave,
}: {
  idea: GiftIdea;
  onClose: () => void;
  onSave: (data: { name: string; url?: string; notes?: string; price?: string }) => void;
}) {
  const [name, setName] = useState(idea.name);
  const [url, setUrl] = useState(idea.url || '');
  const [notes, setNotes] = useState(idea.notes || '');
  const [price, setPrice] = useState(idea.price || '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold">Edit Gift Idea</h2>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Link (optional)</label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <label className="text-sm font-medium">Price (optional)</label>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="29.99" />
          </div>
          <div>
            <label className="text-sm font-medium">Notes (optional)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Size, color, etc."
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                name,
                url: url || undefined,
                notes: notes || undefined,
                price: price || undefined,
              })
            }
            disabled={!name.trim()}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
