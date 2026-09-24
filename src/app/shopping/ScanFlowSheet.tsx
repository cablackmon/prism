'use client';

import { Button } from '@/components/ui/button';
import { Emoji } from '@/components/ui/Emoji';
import { Spinner } from '@/components/ui/spinner';
import type { ScanState } from './useShoppingScanFlow';
import type { ShoppingList } from '@/types';

interface DynamicCategory {
  id: string;
  name: string;
}

interface ScanFlowSheetProps {
  scan: ScanState | null;
  lists: ShoppingList[];
  activeListId: string;
  dynamicCategories: DynamicCategory[];
  getCategoryEmoji: (cat: string) => string;
  onClear: () => void;
  onListChosen: (listId: string, listName: string) => void;
  onDoAdd: (category: string | null) => void;
}

export function ScanFlowSheet({
  scan,
  lists,
  activeListId,
  dynamicCategories,
  getCategoryEmoji,
  onClear,
  onListChosen,
  onDoAdd,
}: ScanFlowSheetProps) {
  if (!scan?.step) return null;

  if (scan.step === 'loading') {
    return (
      <div className="fixed inset-0 z-[9100] flex items-center justify-center bg-black/40">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-6 shadow-xl">
          <Spinner size="sm" />
          <p className="text-sm text-muted-foreground">Looking up product…</p>
        </div>
      </div>
    );
  }

  const product = scan.product;
  if (!product) return null;

  return (
    <div
      className="fixed inset-0 z-[9100] flex items-end justify-center bg-black/60"
      onClick={onClear}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl bg-card p-4 pb-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <p className="mb-1 text-center font-semibold">{product.name}</p>
        {product.brand && (
          <p className="mb-3 text-center text-sm text-muted-foreground">{product.brand}</p>
        )}

        {scan.step === 'list' && (
          <>
            <p className="mb-3 text-center text-sm text-muted-foreground">Which list?</p>
            <div className="flex flex-col gap-2">
              {lists.map((list) => (
                <Button
                  key={list.id}
                  variant={list.id === activeListId ? 'default' : 'outline'}
                  className="w-full justify-start py-3 text-base"
                  onClick={() => onListChosen(list.id, list.name)}
                >
                  {list.name}
                </Button>
              ))}
            </div>
          </>
        )}

        {scan.step === 'duplicate' &&
          (() => {
            const others = scan.existingInLists.filter((e) => e.listId !== scan.targetListId);
            return (
              <>
                <p className="mb-3 text-center text-sm text-muted-foreground">
                  Already on <strong>{others.map((e) => e.listName).join(', ')}</strong>. Add to{' '}
                  <strong>{scan.targetListName}</strong> anyway?
                </p>
                <div className="flex flex-col gap-2">
                  <Button className="w-full py-3" onClick={() => onDoAdd(null)}>
                    Yes, add to {scan.targetListName}
                  </Button>
                  <Button variant="outline" className="w-full py-3" onClick={onClear}>
                    Cancel
                  </Button>
                </div>
              </>
            );
          })()}

        {scan.step === 'category' && (
          <>
            <p className="mb-3 text-center text-sm text-muted-foreground">Which category?</p>
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {dynamicCategories.map((cat) => (
                <Button
                  key={cat.id}
                  variant={cat.id === product.suggestedCategory ? 'default' : 'outline'}
                  className="w-full justify-start gap-2 py-3 text-base"
                  onClick={() => onDoAdd(cat.id)}
                >
                  <span>
                    <Emoji e={getCategoryEmoji(cat.id)} />
                  </span>
                  <span>{cat.name}</span>
                  {cat.id === product.suggestedCategory && (
                    <span className="ml-auto text-xs opacity-60">suggested</span>
                  )}
                </Button>
              ))}
              <Button
                variant="ghost"
                className="w-full py-3 text-muted-foreground"
                onClick={() => onDoAdd(null)}
              >
                No category
              </Button>
            </div>
          </>
        )}

        <Button variant="ghost" className="mt-2 w-full text-muted-foreground" onClick={onClear}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
