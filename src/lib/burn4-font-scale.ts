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
  let operation = 0;
  type Measurement = { before: InlineSize; temporary: InlineSize };
  let measurement: Measurement | null = null;

  // A deliberate nested command starts from stable state, never a reader's
  // temporary baseline. An unrecognized outside write is left in place.
  const settleTemporary = (): void => {
    if (measurement && same(readInline(), measurement.temporary)) writeInline(measurement.before);
  };

  const observeOutsideWrite = (): void => {
    const current = readInline();
    if (ownsStyle && !same(current, expected)) {
      ownsStyle = false;
      yielded = true;
      baseline = current;
    }
  };
  const apply = (nextScale: number): FontScaleOutcome => {
    const attempt = operation;
    const before = readInline();
    const frame = { before, temporary: baseline };
    const parentMeasurement = measurement;
    let pixels = 0;
    let failed = false;
    let outsideWrite = false;
    const isCurrent = (): boolean =>
      !disposed && owners.get(target) === owner && operation === attempt;
    measurement = frame;
    try {
      writeInline(frame.temporary);
      const computed = readComputedFontSize();
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(computed)) failed = true;
      else {
        pixels = Number(computed.slice(0, -2));
        if (!Number.isFinite(pixels) || pixels <= 0 || pixels > 1024) failed = true;
      }
    } catch {
      failed = true;
    } finally {
      if (measurement === frame) measurement = parentMeasurement;
      // A host reader may dispose, issue a newer command, acquire a replacement
      // owner or write its own style. None grants this old frame a later write.
      if (isCurrent()) {
        const current = readInline();
        if (same(current, frame.temporary)) writeInline(before);
        else {
          baseline = current;
          ownsStyle = false;
          yielded = true;
          outsideWrite = true;
        }
      }
    }
    if (!isCurrent()) return { ok: false, error: 'The font-size operation was superseded.' };
    if (outsideWrite) return { ok: false, error: 'The font-size target changed during measurement.' };
    if (failed) return { ok: false, error: 'The device font size could not be measured.' };
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
    if (measurement) return { ok: false, error: 'A font-size measurement is already running.' };
    operation++;
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
      settleTemporary();
      operation++;
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
      settleTemporary();
      disposed = true;
      operation++;
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
        let firstFailure: unknown;
        let failed = false;
        for (const cleanup of cleanups.splice(0).reverse()) {
          try { cleanup(); } catch (error) {
            if (!failed) firstFailure = error;
            failed = true;
          }
        }
        if (failed) throw firstFailure;
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
        try { stop(); } catch { /* Every removal was attempted; preserve the setup failure. */ }
        throw error;
      }
      return stop;
    },
  });
}
