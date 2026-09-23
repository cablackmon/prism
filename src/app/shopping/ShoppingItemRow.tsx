'use client';

import { Edit2, Trash2, ScanBarcode } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ShoppingItem } from '@/types';

export function ShoppingItemRow({
  item,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: ShoppingItem;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const quantityDisplay = item.quantity
    ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`
    : null;

  return (
    <div
      id={`shopping-item-${item.id}`}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1',
        'group transition-all hover:bg-muted/50',
        item.checked && 'opacity-60'
      )}
      onClick={onToggle}
    >
      {/* Content - tap to toggle */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('text-base', item.checked && 'text-muted-foreground line-through')}>
            {item.name}
          </span>

          {item.source === 'scan' && (
            <ScanBarcode
              className="h-3 w-3 flex-shrink-0 text-muted-foreground/60"
              aria-label="Added by scanner"
            />
          )}
          {quantityDisplay && (
            <Badge variant="secondary" className="text-xs">
              {quantityDisplay}
            </Badge>
          )}
        </div>

        {item.notes && <p className="mt-0.5 text-sm text-muted-foreground">{item.notes}</p>}
      </div>

      {/* Actions - always visible for touch support */}
      <div className="flex items-center gap-1 opacity-60 transition-opacity hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onEdit();
          }}
          className="h-8 w-8"
          aria-label="Edit item"
        >
          <Edit2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete();
          }}
          className="h-8 w-8 text-destructive"
          aria-label="Delete item"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
