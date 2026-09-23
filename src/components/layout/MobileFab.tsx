'use client';
import { Emoji } from '@/components/ui/Emoji';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Plus,
  Home,
  Sun,
  Moon,
  Monitor,
  User,
  LayoutGrid,
  ArrowUpDown,
  Eye,
  EyeOff,
  ScanLine,
  Rows3,
  LayoutDashboard,
  Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/providers/ThemeProvider';
import { loadHiddenCards, saveHiddenCards } from '@/components/dashboard/useMobileCardOrder';
import { useMobileLayout } from '@/lib/hooks/useMobileLayout';

export interface MobileFabProps {
  user?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    color?: string;
  } | null;
  onLogin?: () => void;
  onLogout?: () => void;
  uiHidden?: boolean;
}

const ALL_CARDS: { id: string; label: string }[] = [
  { id: 'weather', label: 'Weather' },
  { id: 'clock', label: 'Clock' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'busTracking', label: 'Bus Tracker' },
  { id: 'chores', label: 'Chores' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'meals', label: 'Meals' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'messages', label: 'Messages' },
  { id: 'birthdays', label: 'Birthdays' },
  { id: 'points', label: 'Goals' },
  { id: 'wishes', label: 'Wishes' },
  { id: 'photos', label: 'Photos' },
];

export function MobileFab({ user, onLogin, onLogout, uiHidden }: MobileFabProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const [hiddenCards, setHiddenCards] = useState<string[]>([]);
  const [reorderMode, setReorderMode] = useState(false);
  const { theme, setTheme } = useTheme();
  const { layout, setLayout } = useMobileLayout();

  useEffect(() => {
    setHiddenCards(loadHiddenCards());
  }, []);

  const toggleReorderMode = useCallback(() => {
    const next = !reorderMode;
    setReorderMode(next);
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent('prism:mobile-reorder', { detail: { active: next } }));
  }, [reorderMode]);

  const toggleCard = useCallback((cardId: string) => {
    setHiddenCards((prev) => {
      const next = prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId];
      saveHiddenCards(next);
      return next;
    });
  }, []);

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const themeLabel = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'Auto';

  const isDashboard = pathname === '/' || pathname?.startsWith('/d/');
  const isShopping = pathname === '/shopping';

  const actions = [
    {
      key: 'home',
      icon: <Home className="h-5 w-5" />,
      label: 'Home',
      onClick: () => setIsOpen(false),
      href: '/',
    },
    {
      // Always present so the Settings page is reachable on mobile.
      // (Pre-#52 phase 1, there was no path to /settings from mobile PWA
      // because MobileFab had no Settings action and MobileNav isn't
      // mounted.)
      key: 'settings',
      icon: <SettingsIcon className="h-5 w-5" />,
      label: 'Settings',
      onClick: () => setIsOpen(false),
      href: '/settings',
    },
    ...(isShopping
      ? [
          {
            key: 'scan',
            icon: <ScanLine className="h-5 w-5" />,
            label: 'Scan Barcode',
            onClick: () => {
              setIsOpen(false);
              window.dispatchEvent(new CustomEvent('prism:open-barcode-scanner'));
            },
          },
        ]
      : []),
    ...(isDashboard
      ? [
          {
            key: 'reorder',
            icon: <ArrowUpDown className="h-5 w-5" />,
            label: reorderMode ? 'Done' : 'Reorder',
            onClick: toggleReorderMode,
          },
          {
            // Dashboard-card visibility / theme / layout toggles — context-
            // specific to the dashboard, not the same as /settings. Renamed
            // from "Settings" to "Cards" so the two are distinguishable.
            key: 'cards',
            icon: <LayoutGrid className="h-5 w-5" />,
            label: 'Cards',
            onClick: () => {
              setIsOpen(false);
              setShowCards(true);
            },
          },
        ]
      : []),
    {
      key: 'auth',
      icon: user ? (
        <div
          className="relative flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: user.color || '#6B7280' }}
        >
          {user.avatarUrl?.startsWith('emoji:') ? (
            <span className="text-sm">
              <Emoji e={user.avatarUrl.slice(6)} />
            </span>
          ) : user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt={user.name}
              fill
              unoptimized
              className="rounded-full object-cover"
            />
          ) : (
            user.name.charAt(0).toUpperCase()
          )}
        </div>
      ) : (
        <User className="h-5 w-5 text-red-500" />
      ),
      label: user ? 'Logout' : 'Login',
      onClick: () => {
        setIsOpen(false);
        if (user) onLogout?.();
        else onLogin?.();
      },
    },
  ];

  return (
    <>
      {/* Backdrop */}
      {(isOpen || showCards) && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => {
            setIsOpen(false);
            setShowCards(false);
          }}
        />
      )}

      {/* Cards settings panel */}
      {showCards && (
        <div className="safe-area-bottom fixed inset-x-4 bottom-24 z-50 max-h-[60vh] overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">Dashboard Cards</h3>
            <button
              onClick={() => {
                setShowCards(false);
                window.location.reload();
              }}
              className="text-sm font-medium text-primary"
            >
              Done
            </button>
          </div>
          {/* Theme toggle */}
          <div className="mb-2 flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm font-medium">Theme</span>
            <button
              onClick={cycleTheme}
              className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ThemeIcon className="h-4 w-4" />
              <span>{themeLabel}</span>
            </button>
          </div>
          {/* Layout toggle */}
          <div className="mb-3 flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm font-medium">Layout</span>
            <div className="flex items-center overflow-hidden rounded-md border text-xs">
              <button
                onClick={() => setLayout('rows')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 transition-colors',
                  layout === 'rows'
                    ? 'bg-secondary font-medium text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                )}
              >
                <Rows3 className="h-3.5 w-3.5" />
                Rows
              </button>
              <button
                onClick={() => setLayout('tiles')}
                className={cn(
                  'flex items-center gap-1.5 border-l px-3 py-1.5 transition-colors',
                  layout === 'tiles'
                    ? 'bg-secondary font-medium text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                )}
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Tiles
              </button>
            </div>
          </div>

          <p className="mb-3 text-xs text-muted-foreground">
            Toggle which cards appear on your mobile dashboard.
          </p>
          <div className="space-y-1">
            {ALL_CARDS.map((card) => {
              const isHidden = hiddenCards.includes(card.id);
              return (
                <button
                  key={card.id}
                  onClick={() => toggleCard(card.id)}
                  className="flex w-full items-center justify-between rounded-lg p-3 transition-colors hover:bg-accent"
                >
                  <span className={cn('text-sm font-medium', isHidden && 'text-muted-foreground')}>
                    {card.label}
                  </span>
                  {isHidden ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Action items */}
      {isOpen && (
        <div className="safe-area-bottom fixed bottom-24 right-6 z-50 flex flex-col-reverse items-end gap-3">
          {actions.map((action, i) => {
            const content = (
              <div
                className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2"
                style={{ animationDelay: `${i * 50}ms`, animationFillMode: 'both' }}
              >
                <span className="rounded-full border border-border bg-card/95 px-3 py-1.5 text-sm font-medium text-foreground shadow-md backdrop-blur-sm">
                  {action.label}
                </span>
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg">
                  {action.icon}
                </div>
              </div>
            );

            if ('href' in action && action.href) {
              return (
                <Link key={action.key} href={action.href} onClick={action.onClick}>
                  {content}
                </Link>
              );
            }
            return (
              <button key={action.key} onClick={action.onClick}>
                {content}
              </button>
            );
          })}
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={() => {
          if (showCards) {
            setShowCards(false);
          } else {
            setIsOpen(!isOpen);
          }
        }}
        aria-label={isOpen || showCards ? 'Close menu' : 'Open menu'}
        className={cn(
          'fixed right-6 z-50 h-14 w-14 rounded-full',
          'bg-primary text-primary-foreground shadow-lg',
          'flex items-center justify-center',
          'transition-all duration-300 ease-in-out',
          'active:scale-95',
          (isOpen || showCards) && 'rotate-45 bg-muted text-muted-foreground',
          reorderMode && !isOpen && 'bg-amber-500 text-white',
          uiHidden && !isOpen && !showCards && 'translate-y-24 opacity-0'
        )}
        style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Plus className="h-6 w-6" />
      </button>
    </>
  );
}
