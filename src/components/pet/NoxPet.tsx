'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useNoxPetSetting } from '@/lib/hooks/useNoxPetSetting';
import {
  PET_STAGE,
  isPetWalkMeta,
  petBounds,
  petFeetDrop,
  petScale,
  petSizeFor,
  petSpeed,
  startWalk,
  stepPet,
  type PetState,
  type PetWalkMeta,
} from '@/lib/pet/petMotion';

// Family v9 only. Street/default and Business clips are never referenced here.
const PET_ROOT = '/pet/family/';
const SET_DIR = 'small/';
const IDLE_FRAME_S = 28 / 24;
const ACTION_MS = { wave: 1800, dance: 3600 } as const;
// Real clip lengths (126 and 145 frames at 24 fps); the ended event drives the normal exit, this is the stall guard.
const CLIP_MS = { wave: 5250, dance: 6042 } as const;
type ActionName = keyof typeof ACTION_MS;

type PetAssets = {
  walk: PetWalkMeta;
  clips: string[];
}

function supportsVp9Alpha(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return false;
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox|Android/.test(ua)) return false;
  const probe = document.createElement('video');
  return Boolean(probe.canPlayType('video/webm; codecs="vp9"'));
}

async function loadAssets(): Promise<PetAssets | null> {
  try {
    const [manifestRes, walkRes] = await Promise.all([
      fetch(`${PET_ROOT}manifest.json`),
      fetch(`${PET_ROOT}${SET_DIR}walk.json`),
    ]);
    if (!manifestRes.ok || !walkRes.ok) return null;
    const manifest = (await manifestRes.json()) as { lineage?: unknown; audience?: unknown; clips?: unknown };
    const walk = (await walkRes.json()) as unknown;
    if (manifest.lineage !== 'family_v9' || manifest.audience !== 'family') return null;
    if (!isPetWalkMeta(walk)) return null;
    const clips = Array.isArray(manifest.clips) ? manifest.clips.filter((c): c is string => typeof c === 'string') : [];
    return { walk, clips };
  } catch {
    return null;
  }
}

const PAUSE_ATTRS = ['data-kyst-screensaver', 'data-kyst-away', 'data-kyst-babysitter'];
const FIXED_CHROME = 'nav.fixed, aside.fixed';

function navInsets(): { bottom: number; left: number } {
  let bottom = 0;
  let left = 0;
  document.querySelectorAll(FIXED_CHROME).forEach((nav) => {
    const rect = nav.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) return;
    const onScreen = rect.right > 1 && rect.left < window.innerWidth - 1 && rect.bottom > 1 && rect.top < window.innerHeight - 1;
    if (!onScreen) return;
    if (rect.width >= window.innerWidth * 0.8 && rect.bottom >= window.innerHeight - 1) {
      bottom = Math.max(bottom, window.innerHeight - rect.top);
    } else if (rect.height >= window.innerHeight * 0.8 && rect.left <= 1) {
      left = Math.max(left, rect.right);
    }
  });
  return { bottom, left };
}

export function NoxPet() {
  const pathname = usePathname();
  const { enabled, authorized } = useNoxPetSetting();
  const onWallPage = !pathname.startsWith('/auth/') && !pathname.startsWith('/setup');
  const wanted = enabled && authorized && onWallPage;

  const [assets, setAssets] = useState<PetAssets | null>(null);
  const [size, setSize] = useState(() => petSizeFor(typeof window === 'undefined' ? 1080 : window.innerHeight));
  const [reduced, setReduced] = useState(false);
  const [supported, setSupported] = useState(true);
  const [insets, setInsets] = useState({ bottom: 0, left: 0 });
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const layerRef = useRef<HTMLDivElement>(null);
  const moverRef = useRef<HTMLDivElement>(null);
  const bobRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const triggerRef = useRef<() => void>(() => {});
  const relayoutRef = useRef<() => void>(() => {});

  useEffect(() => {
    setSupported(supportsVp9Alpha());
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    const refreshInsets = () => {
      const next = navInsets();
      setInsets((cur) => (cur.bottom === next.bottom && cur.left === next.left ? cur : next));
    };
    const onResize = () => {
      setSize(petSizeFor(window.innerHeight));
      refreshInsets();
      relayoutRef.current();
    };
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target instanceof Element && e.target.closest(FIXED_CHROME)) refreshInsets();
    };
    onResize();
    window.addEventListener('resize', onResize);
    document.addEventListener('transitionend', onTransitionEnd, true);
    // The nav mounts after the pet and swaps with orientation without a resize event.
    const insetTimer = setInterval(() => {
      if (!document.hidden) refreshInsets();
    }, 1000);
    return () => {
      clearInterval(insetTimer);
      mq.removeEventListener('change', sync);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('transitionend', onTransitionEnd, true);
    };
  }, []);

  useEffect(() => {
    if (!wanted || !supported || assets) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    void loadAssets().then((a) => {
      if (cancelled) return;
      if (a) setAssets(a);
      else retryTimer = setTimeout(() => setLoadAttempt((n) => n + 1), Math.min(60_000, 5_000 * 2 ** loadAttempt));
    });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [wanted, supported, assets, loadAttempt]);

  const geometry = useMemo(() => {
    if (!assets) return null;
    const s = petScale(size);
    const [bx, by, bw, bh] = assets.walk.box;
    return {
      width: PET_STAGE.videoWidth * s,
      height: PET_STAGE.videoHeight * s,
      drop: petFeetDrop(assets.walk, size),
      hit: { left: bx * s, top: Math.max(0, (by - PET_STAGE.cropY) * s), width: bw * s, height: bh * s },
    };
  }, [assets, size]);

  const active = Boolean(wanted && supported && assets && geometry && !failed);

  const geometryRef = useRef({ size, meta: assets?.walk ?? null });
  geometryRef.current = { size, meta: assets?.walk ?? null };

  useEffect(() => {
    if (!active || !assets) return;
    const layer = layerRef.current;
    const mover = moverRef.current;
    const bob = bobRef.current;
    const video = videoRef.current;
    if (!layer || !mover || !bob || !video) return;

    const meta = assets.walk;
    const walkUrl = `${PET_ROOT}${SET_DIR}walk.webm`;
    const clipUrl = (name: string) => `${PET_ROOT}${SET_DIR}${name}.webm`;
    const hasClip = (name: string) => assets.clips.includes(name);
    const rand = Math.random;

    const bounds0 = petBounds(meta, geometryRef.current.size, layer.clientWidth);
    const state: PetState = {
      mode: 'walk',
      x: bounds0.min + rand() * Math.max(0, bounds0.max - bounds0.min),
      direction: rand() < 0.5 ? 1 : -1,
      modeUntil: 0,
    };
    startWalk(state, performance.now(), bounds0, rand);

    let raf = 0;
    let wakeTimer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    let running = false;
    let actionTimer: ReturnType<typeof setTimeout> | null = null;
    let nextAction: ActionName = 'wave';
    let heldFrame = false;

    const bounds = () => petBounds(meta, geometryRef.current.size, layer.clientWidth);
    const paint = () => {
      mover.style.transform = `translate3d(${state.x.toFixed(2)}px,0,0) scaleX(${state.direction})`;
    };
    const relayout = () => {
      const b = bounds();
      state.x = Math.max(b.min, Math.min(b.max, state.x));
      paint();
    };
    relayoutRef.current = relayout;

    const setSrc = (url: string, loop: boolean) => {
      if (!video.src.endsWith(url)) video.src = url;
      video.loop = loop;
    };
    const play = () => {
      void video.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotSupportedError') setFailed(true);
      });
    };
    const holdStanding = () => {
      heldFrame = true;
      setSrc(walkUrl, true);
      video.pause();
      if (video.readyState >= 1) video.currentTime = IDLE_FRAME_S;
    };
    const playWalk = () => {
      heldFrame = false;
      setSrc(walkUrl, true);
      play();
    };
    const showIdle = () => {
      if (hasClip('idle')) {
        heldFrame = false;
        setSrc(clipUrl('idle'), true);
        play();
      } else {
        holdStanding();
      }
    };
    const stopFrames = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (wakeTimer) clearTimeout(wakeTimer);
      wakeTimer = null;
    };
    const loop = (now: number) => {
      raf = 0;
      if (!running) return;
      const b = bounds();
      if (state.x > b.max) state.x = b.max;
      if (state.x < b.min) state.x = b.min;
      const result = stepPet(state, now, last, petSpeed(meta, geometryRef.current.size), b, rand);
      last = now;
      if (result.modeChanged) applyMode();
      paint();
      if (state.mode === 'walk') raf = requestAnimationFrame(loop);
      else scheduleWake();
    };
    // Only a walking pet needs per-frame work; idle sleeps until its timer ends, actions are timer-driven.
    const scheduleWake = () => {
      if (!running || state.mode !== 'idle') return;
      if (wakeTimer) clearTimeout(wakeTimer);
      wakeTimer = setTimeout(() => {
        wakeTimer = null;
        if (!running) return;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }, Math.max(0, state.modeUntil - performance.now()));
    };
    const resumeFrames = () => {
      stopFrames();
      if (state.mode === 'walk') {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      } else {
        scheduleWake();
      }
    };
    const applyMode = () => {
      if (state.mode === 'walk') playWalk();
      else if (state.mode === 'idle') showIdle();
    };

    const endAction = () => {
      actionTimer = null;
      bob.removeAttribute('data-nox-pet-action');
      state.mode = 'idle';
      state.modeUntil = performance.now() + 1500;
      if (running) {
        showIdle();
        resumeFrames();
      }
    };
    const runAction = (name: ActionName): boolean => {
      if (state.mode === 'action' || !running || reduced) return false;
      stopFrames();
      state.mode = 'action';
      if (hasClip(name)) {
        heldFrame = false;
        setSrc(clipUrl(name), false);
        play();
        actionTimer = setTimeout(endAction, CLIP_MS[name] + 2000);
        video.onended = () => {
          video.onended = null;
          if (actionTimer) clearTimeout(actionTimer);
          endAction();
        };
      } else {
        bob.setAttribute('data-nox-pet-action', name);
        if (name === 'dance') playWalk();
        else holdStanding();
        actionTimer = setTimeout(endAction, ACTION_MS[name]);
      }
      return true;
    };
    triggerRef.current = () => {
      if (runAction(nextAction)) nextAction = nextAction === 'wave' ? 'dance' : 'wave';
    };

    const shouldRun = () => {
      if (document.hidden) return false;
      const d = document.documentElement.dataset;
      return d.kystScreensaver !== 'active' && d.kystAway === undefined && d.kystBabysitter === undefined;
    };
    const sync = () => {
      const want = shouldRun();
      if (want && !running) {
        running = true;
        if (reduced) {
          holdStanding();
          state.x = bounds().max - 24;
          paint();
          return;
        }
        if (state.mode === 'action') playWalk();
        else applyMode();
        resumeFrames();
      } else if (!want && running) {
        running = false;
        stopFrames();
        if (actionTimer) clearTimeout(actionTimer);
        actionTimer = null;
        video.onended = null;
        bob.removeAttribute('data-nox-pet-action');
        if (state.mode === 'action') {
          state.mode = 'idle';
          state.modeUntil = performance.now() + 500;
        }
        video.pause();
      }
    };

    const onLoaded = () => {
      video.style.opacity = '1';
      setReady(true);
      if (heldFrame) video.currentTime = IDLE_FRAME_S;
    };
    const onError = () => {
      if (video.src.endsWith(walkUrl)) {
        setFailed(true);
      } else if (state.mode === 'action') {
        if (actionTimer) clearTimeout(actionTimer);
        endAction();
      }
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
    document.addEventListener('visibilitychange', sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: PAUSE_ATTRS });
    paint();
    sync();

    return () => {
      running = false;
      stopFrames();
      if (actionTimer) clearTimeout(actionTimer);
      video.onended = null;
      triggerRef.current = () => {};
      relayoutRef.current = () => {};
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', sync);
      observer.disconnect();
      video.pause();
      video.removeAttribute('src');
      video.load();
      setReady(false);
    };
  }, [active, assets, reduced]);

  useEffect(() => {
    relayoutRef.current();
  }, [size, insets.left]);

  const onTap = useCallback(() => triggerRef.current(), []);

  if (!active || !geometry) return null;

  return (
    <div
      ref={layerRef}
      data-testid="nox-pet-layer"
      className="pointer-events-none fixed z-[45]"
      style={{
        left: `calc(env(safe-area-inset-left, 0px) + ${insets.left}px)`,
        right: 'env(safe-area-inset-right, 0px)',
        bottom: `calc(max(env(safe-area-inset-bottom, 0px), ${insets.bottom}px) - ${geometry.drop}px)`,
        height: geometry.height,
        transition: 'bottom 300ms ease-out',
      }}
    >
      <div
        ref={moverRef}
        style={{ position: 'absolute', left: 0, top: 0, width: geometry.width, height: geometry.height, willChange: 'transform' }}
      >
        <div ref={bobRef} style={{ width: '100%', height: '100%', transformOrigin: '50% 100%' }}>
          <video
            ref={videoRef}
            data-testid="nox-pet-video"
            muted
            playsInline
            loop
            preload="auto"
            tabIndex={-1}
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden="true"
            style={{ width: '100%', height: '100%', display: 'block', opacity: 0, pointerEvents: 'none' }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Nox, the family pet. Tap to wave or dance."
            data-testid="nox-pet-figure"
            disabled={reduced || !ready}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onTap}
            style={{
              position: 'absolute',
              left: geometry.hit.left,
              top: geometry.hit.top,
              width: geometry.hit.width,
              height: geometry.hit.height,
              pointerEvents: reduced || !ready ? 'none' : 'auto',
              background: 'transparent',
              border: 0,
              padding: 0,
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              cursor: 'pointer',
            }}
          />
        </div>
      </div>
    </div>
  );
}
