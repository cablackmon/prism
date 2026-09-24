'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { getWidgetRoute } from '@/components/widgets/widgetRegistry';

const DOUBLE_TAP_MS = 450;
const DOUBLE_TAP_DISTANCE_PX = 48;
const TAP_MOVE_TOLERANCE_PX = 12;
const MAX_TAP_DURATION_MS = 500;

type Point = {
  x: number;
  y: number;
};

type ActiveTouch = Point & {
  pointerId: number;
  startedAt: number;
  moved: boolean;
};

type CompletedTap = Point & {
  at: number;
};

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Dashboard overlays own all gestures while visible. */
export function isWidgetNavigationBlocked() {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.dataset.kystScreensaver === 'active') return true;
  return document.querySelector('[data-voice-assistant-active="true"]') !== null;
}

type DashboardWidgetNavigationProps = {
  widgetId: string;
  slug?: string;
  children: React.ReactNode;
};

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[role="button"]',
  '[role="link"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-widget-navigation-ignore]',
].join(',');

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}

/**
 * Adds mouse double-click and touch double-tap navigation without delaying or
 * cancelling a widget's own single-tap controls.
 */
export function DashboardWidgetNavigation({
  widgetId,
  slug,
  children,
}: DashboardWidgetNavigationProps) {
  const router = useRouter();
  const widgetRoute = getWidgetRoute(widgetId);
  const route = widgetRoute && slug ? `/d/${encodeURIComponent(slug)}${widgetRoute}` : widgetRoute;
  const activeTouch = React.useRef<ActiveTouch | null>(null);
  const lastTap = React.useRef<CompletedTap | null>(null);
  const touchNavigationAt = React.useRef(0);
  const navigationPending = React.useRef(false);

  const navigate = React.useCallback(() => {
    if (!route || navigationPending.current || isWidgetNavigationBlocked()) return;
    navigationPending.current = true;
    router.push(route);
  }, [route, router]);

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!route || event.pointerType !== 'touch' || !event.isPrimary) return;
      if (isWidgetNavigationBlocked() || isInteractiveTarget(event.target)) {
        activeTouch.current = null;
        lastTap.current = null;
        return;
      }
      activeTouch.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startedAt: Date.now(),
        moved: false,
      };
    },
    [route]
  );

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const active = activeTouch.current;
    if (!active || active.pointerId !== event.pointerId || active.moved) return;
    if (distance(active, { x: event.clientX, y: event.clientY }) > TAP_MOVE_TOLERANCE_PX) {
      active.moved = true;
      lastTap.current = null;
    }
  }, []);

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const active = activeTouch.current;
      activeTouch.current = null;
      const now = Date.now();
      if (
        !route ||
        event.pointerType !== 'touch' ||
        !event.isPrimary ||
        !active ||
        active.pointerId !== event.pointerId ||
        active.moved ||
        now - active.startedAt > MAX_TAP_DURATION_MS ||
        isWidgetNavigationBlocked() ||
        isInteractiveTarget(event.target)
      ) {
        lastTap.current = null;
        return;
      }

      const currentTap = { at: now, x: event.clientX, y: event.clientY };
      const previousTap = lastTap.current;
      lastTap.current = currentTap;

      if (
        previousTap &&
        now - previousTap.at <= DOUBLE_TAP_MS &&
        distance(previousTap, currentTap) <= DOUBLE_TAP_DISTANCE_PX
      ) {
        lastTap.current = null;
        touchNavigationAt.current = now;
        navigate();
      }
    },
    [navigate, route]
  );

  const handlePointerCancel = React.useCallback(() => {
    activeTouch.current = null;
    lastTap.current = null;
  }, []);

  const handleDoubleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(event.target)) return;
      // Edge may emit a synthetic dblclick after the touch pointer sequence.
      if (Date.now() - touchNavigationAt.current <= DOUBLE_TAP_MS) return;
      navigate();
    },
    [navigate]
  );

  return (
    <div
      className="h-full w-full touch-manipulation"
      data-widget-navigation={route ?? 'none'}
      onDoubleClick={route ? handleDoubleClick : undefined}
      onPointerDown={route ? handlePointerDown : undefined}
      onPointerMove={route ? handlePointerMove : undefined}
      onPointerUp={route ? handlePointerUp : undefined}
      onPointerCancel={route ? handlePointerCancel : undefined}
    >
      {children}
    </div>
  );
}
