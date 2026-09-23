/**
 *
 * The main interactive messages view with all family messages.
 *
 * FEATURES:
 * - Display all messages in a list/card format
 * - Show message author, content, timestamp
 * - Mark messages as pinned/important
 * - Delete messages
 * - Add new message button
 *
 */

'use client';

import * as React from 'react';
import { useState, useMemo } from 'react';
import { toast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialog } from '@/lib/hooks/useConfirmDialog';
import { formatDistanceToNow, format } from 'date-fns';
import {
  MessageSquare,
  Plus,
  Pin,
  AlertTriangle,
  Trash2,
  Pencil,
  Check,
  X as XIcon,
  Clock,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/avatar';
import { PageWrapper, SubpageHeader, FilterBar, PersonFilter } from '@/components/layout';
import { useMessages } from '@/lib/hooks';
import { useAuth } from '@/components/providers';
import { useFamily } from '@/components/providers';
import { AddMessageModal } from '@/components/modals/AddMessageModal';
import { EmptyState } from '@/components/ui/empty-state';
import { PageLoader } from '@/components/ui/spinner';
import type { FamilyMessage } from '@/components/widgets/MessagesWidget';
import type { FamilyMember } from '@/types';

/**
 * MESSAGES VIEW COMPONENT
 */
export function MessagesView() {
  const { activeUser, requireAuth } = useAuth();
  const { members: familyMembers } = useFamily();
  const { confirm: confirmDelete, dialogProps: confirmDialogProps } = useConfirmDialog();

  // State
  const { messages, loading, error, refresh, deleteMessage, updateMessage } = useMessages();
  const [filterAuthor, setFilterAuthor] = useState<string[] | null>(null);
  const [groupByPerson, setGroupByPerson] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Get unique authors
  const authors = useMemo(() => {
    const authorMap = new Map<string, FamilyMember>();
    messages.forEach((msg) => {
      if (!authorMap.has(msg.author.id)) {
        authorMap.set(msg.author.id, {
          id: msg.author.id,
          name: msg.author.name,
          color: msg.author.color,
        });
      }
    });
    return Array.from(authorMap.values());
  }, [messages]);

  // Filter messages
  const filteredMessages = useMemo(() => {
    let result = [...messages];

    // Apply author filter
    if (filterAuthor && filterAuthor.length > 0) {
      result = result.filter((msg) => filterAuthor.includes(msg.author.id));
    }

    // Sort: pinned first, then by date (newest first)
    result.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return result;
  }, [messages, filterAuthor]);

  // Group messages by author
  const messagesByAuthor = useMemo(() => {
    if (!groupByPerson) return null;
    const groups: { member: FamilyMember; messages: FamilyMessage[] }[] = [];
    const memberMap = new Map<string, FamilyMessage[]>();

    for (const msg of filteredMessages) {
      const key = msg.author.id;
      if (!memberMap.has(key)) memberMap.set(key, []);
      memberMap.get(key)!.push(msg);
    }

    // Use family member order
    for (const member of familyMembers) {
      const msgs = memberMap.get(member.id);
      if (msgs && msgs.length > 0) {
        groups.push({ member, messages: msgs });
      }
    }

    // Any authors not in family members (shouldn't happen but be safe)
    for (const [authorId, msgs] of memberMap) {
      if (!familyMembers.some((m) => m.id === authorId)) {
        const author = msgs[0]!.author;
        groups.push({
          member: { id: author.id, name: author.name, color: author.color },
          messages: msgs,
        });
      }
    }

    return groups;
  }, [groupByPerson, filteredMessages, familyMembers]);

  // Handle add - requires auth. Shared by the toolbar button and the
  // empty-state CTA so both gate on "who's posting?" the same way.
  const handleAddWithAuth = async () => {
    const user = await requireAuth("Who's posting?");
    if (user) setShowAddModal(true);
  };

  // Handle delete - requires auth and ownership check
  const handleDelete = async (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;

    const user = await requireAuth("Who's deleting this message?");
    if (!user) return;

    // Check ownership - parents can delete any message, others can only delete their own
    const isParent = user.role === 'parent';
    const isOwnMessage = message.author.id === user.id;

    if (!isParent && !isOwnMessage) {
      toast({
        title: `This message was posted by ${message.author.name}. Only they or a parent can delete it.`,
        variant: 'warning',
      });
      return;
    }

    if (await confirmDelete('Delete this message?', 'This action cannot be undone.')) {
      await deleteMessage(messageId);
    }
  };

  // Handle edit - requires auth and ownership check
  const handleEdit = async (messageId: string, newText: string): Promise<boolean> => {
    const message = messages.find((m) => m.id === messageId);
    if (!message) return false;

    const user = await requireAuth("Who's editing this message?");
    if (!user) return false;

    const isParent = user.role === 'parent';
    const isOwnMessage = message.author.id === user.id;

    if (!isParent && !isOwnMessage) {
      toast({
        title: `This message was posted by ${message.author.name}. Only they or a parent can edit it.`,
        variant: 'warning',
      });
      return false;
    }

    try {
      await updateMessage(messageId, { message: newText });
      return true;
    } catch {
      toast({ title: 'Failed to update message', variant: 'destructive' });
      return false;
    }
  };

  // Message counts
  const pinnedCount = messages.filter((m) => m.pinned).length;
  const importantCount = messages.filter((m) => m.important).length;

  return (
    <PageWrapper>
      <div className="flex h-screen flex-col">
        <SubpageHeader
          icon={<MessageSquare className="h-5 w-5 text-primary" />}
          title="Messages"
          badge={
            <>
              <Badge variant="secondary">{messages.length}</Badge>
              {pinnedCount > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Pin className="h-3 w-3" />
                  {pinnedCount}
                </Badge>
              )}
            </>
          }
          actions={
            <Button onClick={handleAddWithAuth} size="sm">
              <Plus className="mr-1 h-4 w-4" />
              Add Message
            </Button>
          }
        />

        {(authors.length > 1 || messages.length > 0) && (
          <FilterBar>
            <PersonFilter members={authors} selected={filterAuthor} onSelect={setFilterAuthor} />
            <div className="h-5 w-px shrink-0 bg-border" />
            <Button
              variant={groupByPerson ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setGroupByPerson(!groupByPerson)}
              className="h-8 shrink-0 gap-1"
            >
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Group by Person</span>
            </Button>
          </FilterBar>
        )}

        {/* ================================================================== */}
        {/* MESSAGE LIST */}
        {/* ================================================================== */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <PageLoader label="Loading messages..." />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-destructive">
              <div className="text-center">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p>{error}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={refresh}>
                  Try Again
                </Button>
              </div>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<MessageSquare />}
                title="No messages found"
                action={
                  <Button variant="outline" size="sm" onClick={handleAddWithAuth}>
                    Add your first message
                  </Button>
                }
              />
            </div>
          ) : groupByPerson && messagesByAuthor ? (
            <div
              className="mx-auto grid max-w-6xl gap-3"
              style={{
                gridTemplateColumns:
                  messagesByAuthor.length <= 2
                    ? 'repeat(auto-fit, minmax(300px, 1fr))'
                    : 'repeat(auto-fit, minmax(280px, 1fr))',
              }}
            >
              {messagesByAuthor.map(({ member, messages: msgs }) => (
                <div
                  key={member.id}
                  className="flex flex-col overflow-hidden rounded-lg border-2 bg-card/90 backdrop-blur-sm"
                  style={{ borderColor: member.color }}
                >
                  <div
                    className="flex shrink-0 items-center gap-2 px-3 py-2"
                    style={{ backgroundColor: member.color + '20' }}
                  >
                    <UserAvatar
                      name={member.name}
                      color={member.color}
                      size="sm"
                      className="h-7 w-7"
                    />
                    <h3 className="text-lg font-bold" style={{ color: member.color }}>
                      {member.name}
                    </h3>
                    <Badge variant="outline" className="ml-auto">
                      {msgs.length}
                    </Badge>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto p-2">
                    {msgs.map((message) => (
                      <MessageCard
                        key={message.id}
                        message={message}
                        onDelete={() => handleDelete(message.id)}
                        onEdit={(newText) => handleEdit(message.id, newText)}
                        compact
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-3">
              {filteredMessages.map((message) => (
                <MessageCard
                  key={message.id}
                  message={message}
                  onDelete={() => handleDelete(message.id)}
                  onEdit={(newText) => handleEdit(message.id, newText)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Add Message Modal */}
        <AddMessageModal
          open={showAddModal}
          onOpenChange={setShowAddModal}
          currentUser={
            activeUser
              ? {
                  id: activeUser.id,
                  name: activeUser.name,
                  color: activeUser.color,
                  avatarUrl: activeUser.avatarUrl,
                }
              : undefined
          }
          onMessageCreated={() => {
            refresh();
            setShowAddModal(false);
          }}
        />
      </div>
      <ConfirmDialog {...confirmDialogProps} />
    </PageWrapper>
  );
}

/**
 * MESSAGE CARD COMPONENT
 */
function MessageCard({
  message,
  onDelete,
  onEdit,
  compact,
}: {
  message: FamilyMessage;
  onDelete: () => void;
  onEdit: (newText: string) => Promise<boolean>;
  compact?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(message.message);
  const [saving, setSaving] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const startEdit = () => {
    setEditText(message.message);
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditText(message.message);
  };

  const saveEdit = async () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === message.message) {
      cancelEdit();
      return;
    }
    setSaving(true);
    const ok = await onEdit(trimmed);
    setSaving(false);
    if (ok) setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') cancelEdit();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit();
    }
  };

  const timeAgo = formatDistanceToNow(message.createdAt, { addSuffix: true });
  const fullDate = format(message.createdAt, 'PPp');

  if (compact) {
    return (
      <div
        className={cn(
          'rounded-md border border-border bg-card/50 p-2',
          'group transition-colors hover:bg-muted/50',
          message.important && 'border-destructive/20 bg-red-100/50 dark:bg-red-950/50'
        )}
      >
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-1.5">
                <textarea
                  ref={textareaRef}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full resize-none rounded-md border border-border bg-background p-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  rows={2}
                  maxLength={500}
                  disabled={saving}
                />
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={saveEdit}
                    disabled={saving || !editText.trim()}
                  >
                    <Check className="mr-0.5 h-3 w-3" />
                    {saving ? '...' : 'Save'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+Enter</span>
                </div>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap text-sm">{message.message}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground" title={fullDate}>
                    {timeAgo}
                  </span>
                  {message.pinned && (
                    <Badge variant="outline" className="h-4 gap-0.5 px-1 text-[10px]">
                      <Pin className="h-2.5 w-2.5" />
                      Pinned
                    </Badge>
                  )}
                  {message.important && (
                    <Badge variant="destructive" className="h-4 gap-0.5 px-1 text-[10px]">
                      <AlertTriangle className="h-2.5 w-2.5" />
                    </Badge>
                  )}
                </div>
              </>
            )}
          </div>
          {!editing && (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={startEdit}
                className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                title="Edit message"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
                className="h-6 w-6 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                title="Delete message"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card/85 p-4 backdrop-blur-sm',
        'transition-all hover:border-seasonal-accent hover:ring-2 hover:ring-seasonal-accent/50',
        'group',
        message.important && 'border-destructive/20 bg-red-100/85 dark:bg-red-950/85'
      )}
    >
      {/* Header: Author and badges */}
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <UserAvatar
            name={message.author.name}
            color={message.author.color}
            imageUrl={message.author.avatarUrl}
            size="md"
            className="h-8 w-8 text-sm"
          />
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-medium" style={{ color: message.author.color }}>
                {message.author.name}
              </span>
              {message.pinned && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Pin className="h-3 w-3" />
                  Pinned
                </Badge>
              )}
            </div>
            {(message.important || message.expiresAt) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {message.important && (
                  <Badge variant="destructive" className="gap-1 text-xs">
                    <AlertTriangle className="h-3 w-3" />
                    Important
                  </Badge>
                )}
                {message.expiresAt && (
                  <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Expires {formatDistanceToNow(message.expiresAt, { addSuffix: true })}
                  </Badge>
                )}
              </div>
            )}
            <span className="text-xs text-muted-foreground" title={fullDate}>
              {timeAgo}
            </span>
          </div>
        </div>

        {/* Edit + Delete buttons */}
        {!editing && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={startEdit}
              className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-60"
              title="Edit message"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="h-8 w-8 text-destructive opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-60"
              title="Delete message"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Message content */}
      {editing ? (
        <div className="space-y-2 pl-10">
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            rows={3}
            maxLength={500}
            disabled={saving}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveEdit} disabled={saving || !editText.trim()}>
              <Check className="mr-1 h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
              <XIcon className="mr-1 h-3.5 w-3.5" />
              Cancel
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+Enter to save</span>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap pl-10 text-sm text-foreground">{message.message}</p>
      )}
    </div>
  );
}
