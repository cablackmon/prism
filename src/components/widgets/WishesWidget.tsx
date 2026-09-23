'use client';

import * as React from 'react';
import { Gift, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WidgetContainer, WidgetEmpty } from './WidgetContainer';
import type { WishItem } from '@/types';

export interface WishesWidgetProps {
  items?: WishItem[];
  loading?: boolean;
  error?: string | null;
  titleHref?: string;
  maxItems?: number;
  className?: string;
}

export const WishesWidget = React.memo(function WishesWidget({
  items: externalItems,
  loading = false,
  error = null,
  titleHref,
  maxItems = 8,
  className,
}: WishesWidgetProps) {
  const allItems = externalItems || [];
  const displayItems = allItems.slice(0, maxItems);

  return (
    <WidgetContainer
      title="Wishes"
      titleHref={titleHref}
      icon={<Gift className="h-4 w-4" />}
      size="medium"
      loading={loading}
      error={error}
      className={className}
    >
      {displayItems.length === 0 ? (
        <WidgetEmpty icon={<Gift className="h-8 w-8" />} message="No wishes yet" />
      ) : (
        <div className="-mr-2 h-full overflow-auto pr-2">
          <div className="space-y-2">
            {displayItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg p-2 transition-colors hover:bg-accent/50"
              >
                <Gift className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium">{item.name}</span>
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
          {allItems.length > maxItems && (
            <div className="mt-3 text-center text-xs text-muted-foreground">
              +{allItems.length - maxItems} more
            </div>
          )}
        </div>
      )}
    </WidgetContainer>
  );
});
