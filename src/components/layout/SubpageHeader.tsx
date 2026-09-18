'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MoreVertical } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface OverflowItem {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  checked?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export interface SubpageHeaderProps {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  overflow?: OverflowItem[];
}

export function SubpageHeader({ icon, title, badge, actions, overflow }: SubpageHeaderProps) {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const dashboardSlug = pathname.match(/^\/d\/([^/]+)(?:\/|$)/)?.[1];
  const boardHref = dashboardSlug ? `/d/${dashboardSlug}` : '/';

  return (
    <header className="flex-shrink-0 border-b border-border bg-card/85 backdrop-blur-sm px-4 safe-area-top">
      <div className={cn('flex items-center justify-between', isMobile ? 'h-11' : 'h-12 [@media(pointer:coarse)]:h-16')}>
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="hidden h-11 w-auto gap-2 px-3 md:inline-flex [@media(pointer:coarse)]:h-14 [@media(pointer:coarse)]:px-5"
          >
            <Link href={boardHref} aria-label="Back to board">
              <Home className="h-5 w-5" />
              <span>Back to board</span>
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            {!isMobile && icon}
            <h1 className={cn('font-bold', isMobile ? 'text-base' : 'text-xl')}>{title}</h1>
            {badge}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {overflow && overflow.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More options">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {overflow.map((item, i) => {
                  const IconComp = item.icon;
                  if (item.separator && i > 0) {
                    return (
                      <div key={i}>
                        <DropdownMenuSeparator />
                        {item.checked !== undefined ? (
                          <DropdownMenuCheckboxItem
                            checked={item.checked}
                            onCheckedChange={() => item.onClick()}
                            disabled={item.disabled}
                          >
                            {IconComp && <IconComp className="h-4 w-4 mr-2" />}
                            {item.label}
                          </DropdownMenuCheckboxItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={item.onClick}
                            disabled={item.disabled}
                            className={item.destructive ? 'text-destructive focus:text-destructive' : undefined}
                          >
                            {IconComp && <IconComp className="h-4 w-4 mr-2" />}
                            {item.label}
                          </DropdownMenuItem>
                        )}
                      </div>
                    );
                  }
                  if (item.checked !== undefined) {
                    return (
                      <DropdownMenuCheckboxItem
                        key={i}
                        checked={item.checked}
                        onCheckedChange={() => item.onClick()}
                        disabled={item.disabled}
                      >
                        {IconComp && <IconComp className="h-4 w-4 mr-2" />}
                        {item.label}
                      </DropdownMenuCheckboxItem>
                    );
                  }
                  return (
                    <DropdownMenuItem
                      key={i}
                      onClick={item.onClick}
                      disabled={item.disabled}
                      className={item.destructive ? 'text-destructive focus:text-destructive' : undefined}
                    >
                      {IconComp && <IconComp className="h-4 w-4 mr-2" />}
                      {item.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
