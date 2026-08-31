'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useIsPWA } from './useIsPWA';

const STORAGE_KEY = 'prism-screensaver-timeout';
const AWAY_MODE_STORAGE_KEY = 'prism-away-mode-timeout';
const LAST_ACTIVITY_KEY = 'prism-last-activity';
const DEFAULT_TIMEOUT = 0;

function getStoredTimeout(): number {
  if (typeof window === 'undefined') return DEFAULT_TIMEOUT;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored !== null ? Number(stored) : DEFAULT_TIMEOUT;
}

function getAwayModeTimeout(): number {
  if (typeof window === 'undefined') return 0;
  const stored = localStorage.getItem(AWAY_MODE_STORAGE_KEY);
  return stored !== null ? Number(stored) : 0;
}

function updateLastActivity() {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  }
}

function getLastActivity(): number {
  if (typeof window === 'undefined') return Date.now();
  const stored = localStorage.getItem(LAST_ACTIVITY_KEY);
  const timestamp = stored !== null ? Number(stored) : NaN;
  const now = Date.now();
  if (Number.isFinite(timestamp) && timestamp <= now) return timestamp;

  localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  return now;
}

export function useIdleDetection(initialTimeout?: number) {
  const isPWA = useIsPWA();
  const [timeout, setTimeoutValue] = useState(() => initialTimeout ?? getStoredTimeout());
  const [awayModeTimeout, setAwayModeTimeout] = useState(() => getAwayModeTimeout());
  const [isIdle, setIsIdle] = useState(false);
  const forcedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awayModeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Listen for timeout changes from settings
  useEffect(() => {
    const handler = (e: CustomEvent<number>) => {
      setTimeoutValue(e.detail);
    };
    window.addEventListener('prism:screensaver-timeout-change', handler as EventListener);
    return () => window.removeEventListener('prism:screensaver-timeout-change', handler as EventListener);
  }, []);

  // Listen for away mode timeout changes from settings
  useEffect(() => {
    const handler = (e: CustomEvent<number>) => {
      setAwayModeTimeout(e.detail);
    };
    window.addEventListener('prism:away-mode-timeout-change', handler as EventListener);
    return () => window.removeEventListener('prism:away-mode-timeout-change', handler as EventListener);
  }, []);

  // Reset idle timer on user activity (restarts countdown)
  const resetTimer = useCallback((recordActivity = true) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (recordActivity) updateLastActivity();
    else if (localStorage.getItem(LAST_ACTIVITY_KEY) === null) updateLastActivity();
    if (timeout > 0) {
      const elapsed = recordActivity ? 0 : Math.max(0, Date.now() - getLastActivity());
      const remaining = Math.max(0, timeout * 1000 - elapsed);
      timerRef.current = setTimeout(() => setIsIdle(true), remaining);
    }
  }, [timeout]);

  // Dismiss idle state on deliberate interaction (click, keydown, touch)
  const dismissIdle = useCallback(() => {
    if (!forcedRef.current) {
      setIsIdle(false);
    }
    // After forceIdle, first deliberate interaction clears the flag,
    // second one actually dismisses. This prevents the mouseup from
    // the screensaver button from immediately dismissing.
    if (forcedRef.current) {
      forcedRef.current = false;
      return;
    }
    setIsIdle(false);
    resetTimer();
  }, [resetTimer]);

  const forceIdle = useCallback(() => {
    forcedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsIdle(true);
  }, []);

  useEffect(() => {
    if (timeout <= 0 || isPWA) return;

    // Mousemove/scroll only reset the idle timer, they don't dismiss the screensaver
    const moveEvents = ['mousemove', 'scroll'] as const;
    // Edge kiosk mode reports display-mode: fullscreen and can emit passive
    // mousemove noise with untouched glass. Check the media query per event so
    // runtime fullscreen transitions cannot leave stale listener behavior.
    // Scroll remains activity in every display mode.
    const onPassiveMovement = (event: Event) => {
      if (event.type === 'mousemove' && window.matchMedia('(display-mode: fullscreen)').matches) return;
      resetTimer();
    };
    moveEvents.forEach((e) => window.addEventListener(e, onPassiveMovement));

    // Click/key/touch dismiss the screensaver AND reset the timer — EXCEPT when
    // the interaction targets an opt-in "keep-alive" control (e.g. the calendar
    // view switcher), so those can be operated in place without exiting the
    // screensaver. Checking the native event target covers portaled controls
    // (like the view popover, which renders under <body>) that stopPropagation
    // on the React tree would miss.
    const maybeDismiss = (e: Event) => {
      const target = e.target as Element | null;
      if (target && typeof target.closest === 'function' && target.closest('[data-screensaver-keep]')) {
        return;
      }
      dismissIdle();
    };
    const dismissEvents = ['pointerdown', 'mousedown', 'keydown', 'touchstart'] as const;
    dismissEvents.forEach((e) => window.addEventListener(e, maybeDismiss));

    // The wall wrapper reloads its iframe every ten minutes. In fullscreen,
    // preserve the persisted human-activity deadline across that remount so a
    // fifteen-minute screensaver can still expire.
    resetTimer(!window.matchMedia('(display-mode: fullscreen)').matches);

    return () => {
      moveEvents.forEach((e) => window.removeEventListener(e, onPassiveMovement));
      dismissEvents.forEach((e) => window.removeEventListener(e, maybeDismiss));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer, dismissIdle, timeout, isPWA]);

  // Controls rendered by the kiosk wrapper sit outside this iframe, so their
  // pointer events cannot reach the listeners above. The wrapper forwards a
  // narrow activity message after its own mic/chat/fullscreen interactions.
  useEffect(() => {
    const onWrapperActivity = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'kyst-user-activity') return;
      dismissIdle();
    };
    window.addEventListener('message', onWrapperActivity);
    return () => window.removeEventListener('message', onWrapperActivity);
  }, [dismissIdle]);

  // Kiosk announcements commonly navigate/refresh the page or bring a hidden
  // page back to the foreground. Exit immediately so their UI is never covered.
  useEffect(() => {
    const wake = (recordActivity: boolean) => {
      forcedRef.current = false;
      setIsIdle(false);
      resetTimer(recordActivity || !window.matchMedia('(display-mode: fullscreen)').matches);
    };
    // Edge fullscreen kiosk can emit lifecycle events without human input, so
    // those preserve the existing deadline. Navigation and announcements are
    // deliberate activity and get a fresh interval so their UI stays visible.
    const onLifecycleWake = () => wake(false);
    const onDeliberateWake = () => wake(true);
    window.addEventListener('pageshow', onLifecycleWake);
    window.addEventListener('popstate', onDeliberateWake);
    window.addEventListener('hashchange', onDeliberateWake);
    window.addEventListener('prism:announce', onDeliberateWake);
    document.addEventListener('visibilitychange', onLifecycleWake);
    return () => {
      window.removeEventListener('pageshow', onLifecycleWake);
      window.removeEventListener('popstate', onDeliberateWake);
      window.removeEventListener('hashchange', onDeliberateWake);
      window.removeEventListener('prism:announce', onDeliberateWake);
      document.removeEventListener('visibilitychange', onLifecycleWake);
    };
  }, [resetTimer]);

  // Listen for custom screensaver activation event
  useEffect(() => {
    const handler = () => forceIdle();
    window.addEventListener('prism:screensaver', handler);
    return () => window.removeEventListener('prism:screensaver', handler);
  }, [forceIdle]);

  // Away mode auto-activation based on extended inactivity
  useEffect(() => {
    if (awayModeTimeout <= 0 || isPWA) {
      // Clear timer if disabled
      if (awayModeTimerRef.current) {
        clearInterval(awayModeTimerRef.current);
        awayModeTimerRef.current = null;
      }
      return;
    }

    const checkAwayMode = async () => {
      const lastActivity = getLastActivity();
      const hoursSinceActivity = (Date.now() - lastActivity) / (1000 * 60 * 60);

      if (hoursSinceActivity >= awayModeTimeout) {
        try {
          // Check if already in away mode
          const stateRes = await fetch('/api/away-mode');
          if (stateRes.ok) {
            const state = await stateRes.json();
            if (!state.enabled) {
              // Activate away mode
              await fetch('/api/away-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: true, autoActivated: true }),
              });
              // Notify components
              window.dispatchEvent(new Event('prism:away-mode-change'));
            }
          }
        } catch {
          // Ignore errors - away mode is optional
        }
      }
    };

    // Check every minute
    awayModeTimerRef.current = setInterval(checkAwayMode, 60 * 1000);
    // Also check immediately
    checkAwayMode();

    return () => {
      if (awayModeTimerRef.current) {
        clearInterval(awayModeTimerRef.current);
        awayModeTimerRef.current = null;
      }
    };
  }, [awayModeTimeout, isPWA]);

  return { isIdle, forceIdle };
}
