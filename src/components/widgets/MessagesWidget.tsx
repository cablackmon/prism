/**
 *
 * Displays the family message board - a place for quick notes and updates.
 * Think of it as a digital sticky note board for the family.
 *
 * FEATURES:
 * - Quick text messages from family members
 * - Color-coded by author
 * - Pinned important messages
 * - Timestamps showing when posted
 * - Quick add new message
 *
 * EXAMPLES:
 * - "Dad at gym, back at 9am"
 * - "Swim practice canceled today"
 * - "Dinner is in the fridge"
 *
 * USAGE:
 *   <MessagesWidget />
 *   <MessagesWidget maxMessages={5} />
 *   <MessagesWidget onAddClick={() => openAddMessageDialog()} />
 *
 */

'use client';
import { useBoardTheme } from '@/components/theme/KystTheme';

import * as React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Pin, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WidgetContainer, WidgetEmpty } from './WidgetContainer';
import { Button, UserAvatar } from '@/components/ui';

/**
 * FAMILY MESSAGE TYPE
 * Represents a single message on the board.
 */
export interface FamilyMessage {
  id: string;
  message: string;
  author: {
    id: string;
    name: string;
    color: string;
    avatarUrl?: string;
  };
  createdAt: Date;
  pinned: boolean;
  important: boolean;
  expiresAt?: Date | null;
}

/**
 * MESSAGES WIDGET PROPS
 */
export interface MessagesWidgetProps {
  /** Messages to display (if provided externally) */
  messages?: FamilyMessage[];
  /** Maximum messages to show */
  maxMessages?: number;
  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string | null;
  /** Callback when add button is clicked */
  onAddClick?: () => void;
  /** Callback when message is clicked */
  onMessageClick?: (message: FamilyMessage) => void;
  /** Callback when delete button is clicked */
  onDeleteClick?: (messageId: string) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * MESSAGES WIDGET COMPONENT
 * Displays the family message board.
 *
 * @example Basic usage
 * <MessagesWidget />
 *
 * @example With add callback
 * <MessagesWidget onAddClick={() => openMessageDialog()} />
 */
export const MessagesWidget = React.memo(function MessagesWidget({
  messages: externalMessages,
  maxMessages = 6,
  loading = false,
  error = null,
  onAddClick,
  onMessageClick,
  onDeleteClick,
  className,
}: MessagesWidgetProps) {
  const nox = useBoardTheme() === 'nox';
  // Use provided messages (no demo data fallback in production)
  const allMessages = externalMessages || [];

  // Sort: pinned first, then by date (newest first)
  const sortedMessages = [...allMessages].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  // Limit messages
  const displayMessages = nox ? sortedMessages : sortedMessages.slice(0, maxMessages);

  return (
    <WidgetContainer
      title="Family Messages"
      icon={<MessageSquare className="h-4 w-4" />}
      size="medium"
      loading={loading}
      error={error}
      actions={
        onAddClick && (
          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onAddClick();
            }}
            className="h-8 w-8"
            aria-label="Add message"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )
      }
      className={className}
    >
      {displayMessages.length === 0 ? (
        <WidgetEmpty
          icon={<MessageSquare className="h-8 w-8" />}
          message="No messages yet"
          action={
            onAddClick && (
              <Button size="sm" variant="outline" onClick={onAddClick}>
                Leave a Message
              </Button>
            )
          }
        />
      ) : (
        <div className="-mr-2 h-full overflow-auto pr-2">
          <div className="space-y-3">
            {displayMessages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                onClick={() => onMessageClick?.(message)}
                onDelete={onDeleteClick ? () => onDeleteClick(message.id) : undefined}
              />
            ))}
          </div>

          {/* Show remaining count */}
          {!nox && allMessages.length > maxMessages && (
            <div className="mt-3 text-center text-xs text-muted-foreground">
              +{allMessages.length - maxMessages} more messages
            </div>
          )}
        </div>
      )}
    </WidgetContainer>
  );
});

/**
 * MESSAGE ITEM
 * A single message with author info and timestamp.
 */
function MessageItem({
  message,
  onClick,
  onDelete,
}: {
  message: FamilyMessage;
  onClick?: () => void;
  onDelete?: () => void;
}) {
  const timeAgo = formatDistanceToNow(message.createdAt, { addSuffix: true });

  return (
    <div
      className={cn(
        'group w-full rounded-lg p-2 text-left',
        'transition-colors hover:bg-accent/50',
        'touch-action-manipulation',
        message.important && 'border border-destructive/20 bg-destructive/10'
      )}
    >
      {/* Header: Author and time */}
      <div className="mb-1 flex items-center justify-between">
        <button onClick={onClick} className="flex flex-1 items-center gap-2">
          <UserAvatar
            name={message.author.name}
            color={message.author.color}
            imageUrl={message.author.avatarUrl}
            size="sm"
            className="h-5 w-5 text-[10px]"
          />
          <span className="text-xs font-medium" style={{ color: message.author.color }}>
            {message.author.name}
          </span>
          {message.pinned && <Pin className="h-3 w-3 text-muted-foreground" />}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{timeAgo}</span>
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="rounded p-1 opacity-0 transition-opacity hover:bg-destructive/20 group-hover:opacity-100"
              title="Delete message"
              aria-label="Delete message"
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </button>
          )}
        </div>
      </div>

      {/* Message content */}
      <button onClick={onClick} className="w-full text-left">
        <p className="text-sm text-foreground">{message.message}</p>
      </button>
    </div>
  );
}
