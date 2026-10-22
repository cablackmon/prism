/** Standalone responsive font scaling. The host supplies the target and all DOM capabilities. */
export type FontScaleValue = number | null;
export type FontScaleValidation =
  | { ok: true; value: FontScaleValue }
  | { ok: false; error: string };
export type FontScaleOutcome =
  | { ok: true; status: 'applied' | 'auto' | 'yielded'; scale: FontScaleValue }
  | { ok: false; error: string };

export function parseFontScale(value: unknown): FontScaleValidation {
  if (value === null) return { ok: true, value: null };
  if (typeof value === 'number' && Number.isInteger(value) && value >= 50 && value <= 200) {
    return { ok: true, value };
  }
  return { ok: false, error: 'Choose Auto or a whole percentage from 50 to 200.' };
}

export interface FontScaleSession {
  setScale(value: unknown): FontScaleOutcome;
  refresh(): FontScaleOutcome;
  dispose(): void;
}
export interface FontScaleSessionOptions {
  target: HTMLElement;
  readComputedFontSize: () => string;
  subscribeBaselineChanges?: (listener: () => void) => () => void;
}

type InlineSize = { value: string; priority: string };
const owners = new WeakMap<HTMLElement, object>();

/**
 * One live session may reserve a target. Passive refresh yields to an outside
 * inline write. A deliberate setScale may reclaim using that write as baseline.
 */
export function createFontScaleSession(options: FontScaleSessionOptions): FontScaleSession {
  const { target, readComputedFontSize, subscribeBaselineChanges } = options;
  if (owners.has(target)) throw new Error('This font-size target already has an active session.');
  const owner = {};
  owners.set(target, owner);
  const readInline = (): InlineSize => ({
    value: target.style.getPropertyValue('font-size'),
    priority: target.style.getPropertyPriority('font-size'),
  });
  const writeInline = (inline: InlineSize): void => {
    if (inline.value === '') target.style.removeProperty('font-size');
    else target.style.setProperty('font-size', inline.value, inline.priority);
  };
  const same = (left: InlineSize, right: InlineSize): boolean =>
    left.value === right.value && left.priority === right.priority;
  let baseline = readInline();
  let expected = baseline;
  let ownsStyle = false;
  let yielded = false;
  let disposed = false;
  let scale: FontScaleValue = null;
  let unsubscribe: (() => void) | undefined;

  const observeOutsideWrite = (): void => {
    const current = readInline();
    if (ownsStyle && !same(current, expected)) {
      ownsStyle = false;
      yielded = true;
      baseline = current;
    }
  };
  const apply = (nextScale: number): FontScaleOutcome => {
    const before = readInline();
    let pixels: number;
    try {
      writeInline(baseline);
      const computed = readComputedFontSize();
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(computed)) {
        return { ok: false, error: 'The device font size could not be measured.' };
      }
      pixels = Number(computed.slice(0, -2));
      if (!Number.isFinite(pixels) || pixels <= 0 || pixels > 1024) {
        return { ok: false, error: 'The device font size could not be measured.' };
      }
    } catch {
      return { ok: false, error: 'The device font size could not be measured.' };
    } finally {
      // Measurement must not strand the temporary baseline, including on errors.
      writeInline(before);
    }
    const scaled = Math.round(pixels * nextScale / 100 * 1e6) / 1e6;
    if (scaled <= 0) return { ok: false, error: 'The device font size could not be measured.' };
    writeInline({ value: `${scaled}px`, priority: 'important' });
    expected = readInline();
    ownsStyle = true;
    yielded = false;
    scale = nextScale;
    return { ok: true, status: 'applied', scale };
  };
  const refresh = (): FontScaleOutcome => {
    if (disposed) return { ok: false, error: 'The font-size session is disposed.' };
    observeOutsideWrite();
    if (yielded) return { ok: true, status: 'yielded', scale };
    if (scale === null) return { ok: true, status: 'auto', scale };
    return apply(scale);
  };
  const session: FontScaleSession = {
    setScale(value) {
      if (disposed) return { ok: false, error: 'The font-size session is disposed.' };
      const parsed = parseFontScale(value);
      if (!parsed.ok) return parsed;
      observeOutsideWrite();
      if (!ownsStyle) baseline = readInline();
      if (parsed.value === null) {
        if (ownsStyle) writeInline(baseline);
        ownsStyle = false;
        yielded = false;
        scale = null;
        return { ok: true, status: 'auto', scale };
      }
      return apply(parsed.value);
    },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        if (ownsStyle && same(readInline(), expected)) writeInline(baseline);
      } finally {
        if (owners.get(target) === owner) owners.delete(target);
        const stop = unsubscribe;
        unsubscribe = undefined;
        stop?.();
      }
    },
  };
  try {
    unsubscribe = subscribeBaselineChanges?.(() => { session.refresh(); });
  } catch (error) {
    session.dispose();
    throw error;
  }
  return session;
}

export interface FontScaleView {
  getComputedStyle: Window['getComputedStyle'];
  addEventListener: Window['addEventListener'];
  removeEventListener: Window['removeEventListener'];
  matchMedia?: Window['matchMedia'];
}

/** Explicit browser adapter. No window or document is read at module evaluation. */
export function createDocumentFontScaleSession(
  target: HTMLElement,
  view: FontScaleView,
): FontScaleSession {
  return createFontScaleSession({
    target,
    readComputedFontSize: () => view.getComputedStyle(target).fontSize,
    subscribeBaselineChanges(listener) {
      const cleanups: Array<() => void> = [];
      const stop = (): void => {
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      };
      try {
        view.addEventListener('resize', listener);
        cleanups.push(() => view.removeEventListener('resize', listener));
        for (const query of ['(pointer: fine)', '(pointer: coarse)']) {
          const media = view.matchMedia?.(query);
          if (!media) continue;
          if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', listener);
            cleanups.push(() => media.removeEventListener('change', listener));
          } else if (typeof media.addListener === 'function') {
            media.addListener(listener);
            cleanups.push(() => media.removeListener(listener));
          }
        }
      } catch (error) {
        stop();
        throw error;
      }
      return stop;
    },
  });
}
