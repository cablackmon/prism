// Wander logic ported from the desktop pet (projects/nox-face/pet/main.js wanderStep/scheduleWander),
// minus the Electron window. Pure so it can be unit-tested.

export const PET_STAGE = {
  videoWidth: 1080,
  videoHeight: 1766,
  figureHeight: 1736.2,
  cropY: 86,
} as const;

export const PET_WALK_MS = { min: 8000, spread: 12000 } as const;
export const PET_IDLE_MS = { min: 2000, spread: 4000 } as const;
export const PET_MAX_FRAME_S = 0.1;

export type PetWalkMeta = {
  frames: number;
  fps: number;
  duration: number;
  facing: 'right' | 'left';
  box: [number, number, number, number];
  groundY: number;
  strideStagePx: number;
}

export function isPetWalkMeta(v: unknown): v is PetWalkMeta {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.duration === 'number' && m.duration > 0 &&
    typeof m.strideStagePx === 'number' && m.strideStagePx > 0 &&
    typeof m.groundY === 'number' &&
    Array.isArray(m.box) && m.box.length === 4 && m.box.every((n) => typeof n === 'number')
  );
}

/** Figure height ~12% of the viewport height, clamped for phones and very tall displays. */
export function petSizeFor(viewportHeight: number): number {
  return Math.round(Math.min(200, Math.max(88, viewportHeight * 0.12)));
}

/** CSS px per stage unit. `size` is the figure height in CSS px. */
export function petScale(size: number): number {
  return size / PET_STAGE.figureHeight;
}

/** CSS px per second; feet do not slide because speed is stride over loop duration at this scale. */
export function petSpeed(meta: PetWalkMeta, size: number): number {
  return (meta.strideStagePx / meta.duration) * petScale(size);
}

/** Left-offset range of the video element so the whole figure box stays on screen in either facing. */
export function petBounds(meta: PetWalkMeta, size: number, viewportWidth: number): { min: number; max: number } {
  const s = petScale(size);
  const [bx, , bw] = meta.box;
  const mirroredLeft = PET_STAGE.videoWidth - (bx + bw);
  const min = -Math.min(bx, mirroredLeft) * s;
  const max = viewportWidth - Math.max(bx + bw, PET_STAGE.videoWidth - bx) * s;
  return { min, max: Math.max(min, max) };
}

/** The video's bottom edge sits below the feet by this many CSS px. */
export function petFeetDrop(meta: PetWalkMeta, size: number): number {
  return (PET_STAGE.videoHeight - (meta.groundY - PET_STAGE.cropY)) * petScale(size);
}

export type PetMode = 'walk' | 'idle' | 'action';

export type PetState = {
  mode: PetMode;
  x: number;
  direction: 1 | -1;
  modeUntil: number;
}

export function startWalk(s: PetState, now: number, bounds: { min: number; max: number }, rand: () => number): void {
  s.mode = 'walk';
  s.modeUntil = now + PET_WALK_MS.min + rand() * PET_WALK_MS.spread;
  if (s.x >= bounds.max - 1) s.direction = -1;
  else if (s.x <= bounds.min + 1) s.direction = 1;
}

export function startIdle(s: PetState, now: number, rand: () => number): void {
  s.mode = 'idle';
  s.modeUntil = now + PET_IDLE_MS.min + rand() * PET_IDLE_MS.spread;
}

/**
 * Advances one animation frame. Returns true when the walk just reversed at an edge.
 * Delta time is clamped so a throttled or resumed tab cannot teleport the pet.
 */
export function stepPet(
  s: PetState,
  now: number,
  lastNow: number,
  speed: number,
  bounds: { min: number; max: number },
  rand: () => number,
): { turned: boolean; modeChanged: boolean } {
  if (s.mode === 'action') return { turned: false, modeChanged: false };
  if (s.mode === 'idle') {
    if (now >= s.modeUntil) {
      startWalk(s, now, bounds, rand);
      return { turned: false, modeChanged: true };
    }
    return { turned: false, modeChanged: false };
  }
  let turned = false;
  const dt = Math.min(PET_MAX_FRAME_S, Math.max(0, (now - lastNow) / 1000));
  s.x += s.direction * speed * dt;
  if (s.x >= bounds.max || s.x <= bounds.min) {
    s.x = Math.max(bounds.min, Math.min(bounds.max, s.x));
    s.direction = s.direction === 1 ? -1 : 1;
    turned = true;
  }
  if (now >= s.modeUntil) {
    startIdle(s, now, rand);
    return { turned, modeChanged: true };
  }
  return { turned, modeChanged: false };
}
