'use client';

import * as React from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useIdleDetection } from '@/lib/hooks/useIdleDetection';
import type { WidgetConfig } from '@/lib/hooks/useLayouts';
import { WIDGET_REGISTRY } from '@/components/widgets/widgetRegistry';
import { useDashboardData } from '@/components/dashboard/useDashboardData';
import { buildWidgetProps } from '@/components/dashboard/useWidgetProps';
import { GRID_COLS } from '@/lib/constants/grid';
import { CssGridDisplay } from '@/components/layout/grid/CssGridDisplay';
import { CalendarPrefsScopeContext } from '@/lib/hooks/useCalendarWidgetPrefs';
import { loadScreensaverLayout } from './screensaverStorage';
import { NightSky } from './NightSky';
import { isExpectedNightSkyResponse, NIGHT_SKY_IDLE_SECONDS } from './nightSkyUtils';

/**
 * Wrapper classes that make any dashboard widget legible as a screensaver
 * overlay: transparent backgrounds (wallpaper shows through), a faint frosted
 * card, light borders, and — the important part — forced white text with a soft
 * shadow so nothing goes dark-on-dark (or washes out over a bright photo).
 * Shared by the live screensaver and the editor's screensaver preview.
 */
export const SCREENSAVER_WIDGET_CLASS =
  'h-full w-full ' +
  '[&_*]:!bg-transparent [&_.bg-card]:!bg-white/10 [&_.border-border]:!border-white/20 ' +
  // Force white text for legibility over the photo — EXCEPT elements marked
  // data-keep-color (e.g. the birthdays "days until" urgency coloring), which
  // keep their own color but still get the shadow.
  '[&_*:not([data-keep-color])]:!text-white [&_*]:[text-shadow:0_1px_4px_rgba(0,0,0,0.75)]';

// Re-export storage utilities for consumers
export {
  DEFAULT_SCREENSAVER_LAYOUT,
  loadScreensaverLayout,
  saveScreensaverLayout,
  getScreensaverPresets,
  saveScreensaverPreset,
  deleteScreensaverPreset,
} from './screensaverStorage';

export function Screensaver() {
  const { isIdle } = useIdleDetection(NIGHT_SKY_IDLE_SECONDS);
  const [visible, setVisible] = useState(false);
  const [staticNightSkyAvailable, setStaticNightSkyAvailable] = useState<boolean | null>(null);
  const frameLoadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staticNightSkyLoaded = useRef(false);

  useEffect(() => {
    if (isIdle) {
      const timer = setTimeout(() => setVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [isIdle]);

  useEffect(() => {
    if (!isIdle) {
      // Reset between activations, while the iframe cannot be rendered. Doing
      // this after a new idle activation can erase an onLoad from a cached
      // iframe before the fallback timeout effect observes it.
      staticNightSkyLoaded.current = false;
      setStaticNightSkyAvailable(null);
      return;
    }

    const controller = new AbortController();
    const nightSkyUrl = new URL('/screensaver/nightsky.html', window.location.href).href;
    fetch('/screensaver/nightsky.html', { cache: 'no-store', signal: controller.signal })
      .then((response) => setStaticNightSkyAvailable(isExpectedNightSkyResponse(response, nightSkyUrl)))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setStaticNightSkyAvailable(false);
        }
      });

    return () => controller.abort();
  }, [isIdle]);

  useEffect(() => {
    if (!isIdle || !staticNightSkyAvailable) return;

    const nightSkyUrl = new URL('/screensaver/nightsky.html', window.location.href).href;
    const handleSecurityPolicyViolation = (event: SecurityPolicyViolationEvent) => {
      if (event.effectiveDirective === 'frame-src' && event.blockedURI === nightSkyUrl) {
        setStaticNightSkyAvailable(false);
      }
    };

    // Chromium does not dispatch iframe `error` for a CSP-blocked document.
    // Fall back if the frame never confirms a real load for any reason.
    // A cached frame can load before this passive effect runs, so do not arm a
    // timeout after onLoad has already confirmed the document.
    if (!staticNightSkyLoaded.current) {
      frameLoadTimeout.current = setTimeout(() => setStaticNightSkyAvailable(false), 5_000);
    }
    window.addEventListener('securitypolicyviolation', handleSecurityPolicyViolation);

    return () => {
      window.removeEventListener('securitypolicyviolation', handleSecurityPolicyViolation);
      if (frameLoadTimeout.current) clearTimeout(frameLoadTimeout.current);
      frameLoadTimeout.current = null;
    };
  }, [isIdle, staticNightSkyAvailable]);

  const confirmStaticNightSkyLoaded = () => {
    staticNightSkyLoaded.current = true;
    if (frameLoadTimeout.current) clearTimeout(frameLoadTimeout.current);
    frameLoadTimeout.current = null;
  };

  const nightSkyDomains = useMemo(() => new Set(['calendar']), []);
  const nightSkyData = useDashboardData(nightSkyDomains);

  // Intentional: idle activates the screensaver at any hour. Night/day only
  // selects the palette inside NightSky; it is not an activation gate.
  if (!isIdle) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-black transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {staticNightSkyAvailable ? (
        <iframe
          src="/screensaver/nightsky.html"
          title="KYST Night Sky screensaver"
          className="pointer-events-none h-full w-full border-0"
          onLoad={confirmStaticNightSkyLoaded}
          onError={() => setStaticNightSkyAvailable(false)}
        />
      ) : (
        <NightSky events={nightSkyData.calendar.events} loading={nightSkyData.calendar.loading} />
      )}
    </div>
  );
}

function ScreensaverGrid() {
  const layout = useMemo(() => loadScreensaverLayout(), []);
  const data = useDashboardData();
  const widgetProps = useMemo(() =>
    buildWidgetProps(
      data,
      async () => null, // no auth in screensaver
      { setShowAddTask: () => {}, setShowAddMessage: () => {}, setShowAddChore: () => {}, setShowAddShopping: () => {} },
      '',
    ),
  [data]);

  const renderWidget = (w: WidgetConfig) => {
    const reg = WIDGET_REGISTRY[w.i];
    if (!reg) return null;
    const Component = reg.component;
    const rawProps = { ...widgetProps[w.i] || {}, gridW: w.w, gridH: w.h };
    // Strip interactive callbacks — screensaver widgets are display-only
    const {
      onAddClick, onAddMeal, onListChange, onItemToggle, onTaskToggle,
      onChoreComplete, onEventClick, onMessageClick, onDeleteClick,
      onMarkCooked, onUnmarkCooked,
      ...props
    } = rawProps as Record<string, unknown>;
    return (
      <React.Suspense fallback={<div className="flex items-center justify-center h-full opacity-50 text-sm">Loading...</div>}>
        <div className="h-full w-full [&_*:not([data-keep-bg])]:!bg-transparent [&_.bg-card]:!bg-white/10 [&_.border-border]:!border-white/20">
          <Component {...props} />
        </div>
      </React.Suspense>
    );
  };

  // Screensavers float over the wallpaper/photos, so widgets need transparent
  // backgrounds and LIGHT text — otherwise dark widget text/borders vanish on a
  // dark background (the CssGridDisplay text-color override alone doesn't reach
  // widget content that uses its own Tailwind text classes). Force it here, with
  // a soft shadow so it stays legible over bright photos too.
  const renderScreensaverWidget = (w: WidgetConfig) => (
    <div className={SCREENSAVER_WIDGET_CLASS}>
      {renderWidget(w)}
    </div>
  );

  return (
    // Scope calendar prefs to 'screensaver' so the screensaver's calendar keeps
    // its own view/display settings, independent of the dashboard calendar.
    <CalendarPrefsScopeContext.Provider value="screensaver">
      <CssGridDisplay
        layout={layout}
        renderWidget={renderScreensaverWidget}
        margin={4}
        containerPadding={12}
        cols={GRID_COLS}
        containMode
        headerOffset={0}
        className="w-full h-full"
      />
    </CalendarPrefsScopeContext.Provider>
  );
}

export { ScreensaverGrid };
