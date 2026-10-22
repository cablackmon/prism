'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  createDocumentFontScaleSession,
  parseFontScale,
  type FontScaleSession,
  type FontScaleValue,
  type FontScaleView,
} from '../../lib/burn4-font-scale';

export interface Burn4FontScaleControlsProps {
  value: FontScaleValue;
  onChange: (value: FontScaleValue) => void;
  disabled?: boolean;
}

/** A controlled setting. The host value remains authoritative after every proposal. */
export function Burn4FontScaleControls({
  value, onChange, disabled = false,
}: Burn4FontScaleControlsProps) {
  const id = useId();
  const [editError, setEditError] = useState<string | null>(null);
  const parsed = parseFontScale(value);
  const error = parsed.ok ? editError : parsed.error;
  const usable = parsed.ok;
  const current = parsed.ok ? parsed.value : null;
  const propose = (next: FontScaleValue): void => {
    if (disabled) return;
    setEditError(null);
    onChange(next);
  };
  useEffect(() => { setEditError(null); }, [value]);

  return (
    <fieldset disabled={disabled} aria-describedby={`${id}-help`}>
      <legend>Font size</legend>
      <p id={`${id}-help`}>
        Choose a percentage of this device&apos;s responsive text size. Auto follows the device.
      </p>
      <label style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, minWidth: 44 }}>
        <input type="radio" name={`${id}-mode`} checked={usable && current === null}
          onChange={() => propose(null)} />
        Auto
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, minWidth: 44 }}>
        <input type="radio" name={`${id}-mode`} checked={usable && current !== null}
          onChange={() => propose(100)} />
        Custom
      </label>
      <div>
        <label htmlFor={`${id}-percent`}>Text size percentage</label>
        <input id={`${id}-percent`} type="text" inputMode="numeric" pattern="[0-9]*"
          value={usable ? String(current ?? 100) : ''}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
          style={{ minHeight: 44, minWidth: 44 }}
          onChange={(event) => {
            if (disabled) return;
            const text = event.currentTarget.value;
            const next = /^\d{2,3}$/.test(text) ? parseFontScale(Number(text)) : parseFontScale(undefined);
            if (next.ok) propose(next.value);
            else setEditError(next.error);
          }} />
        <span aria-hidden="true">%</span>
      </div>
      {error && <p id={`${id}-error`} role="alert">{error}</p>}
      <p><output aria-live="polite">{!usable ? 'Invalid font size' : current === null
        ? 'Auto (device default)' : `${current}% of device default`}</output></p>
      <button type="button" style={{ minHeight: 44, minWidth: 44 }}
        disabled={disabled || (usable && current === null)} onClick={() => propose(null)}>
        Reset to Auto
      </button>
      <p>Sample: Today&apos;s family plans are ready to read.</p>
    </fieldset>
  );
}

export interface Burn4FontScaleBoundaryProps {
  target: HTMLElement | null;
  view: FontScaleView | null;
  scale: FontScaleValue;
  onError?: (message: string) => void;
  children?: ReactNode;
}

/** Mount around host content and explicitly supply the root element and its view. */
export function Burn4FontScaleBoundary({
  target, view, scale, onError, children,
}: Burn4FontScaleBoundaryProps) {
  const session = useRef<FontScaleSession | null>(null);
  const reportError = useRef(onError);
  reportError.current = onError;
  useEffect(() => {
    if (!target || !view) return;
    let owned: FontScaleSession;
    try {
      owned = createDocumentFontScaleSession(target, view);
      session.current = owned;
    } catch {
      reportError.current?.('The font-size target could not be attached.');
      return;
    }
    return () => {
      if (session.current === owned) session.current = null;
      owned.dispose();
    };
  }, [target, view]);
  useEffect(() => {
    const result = session.current?.setScale(scale);
    if (result && !result.ok) reportError.current?.(result.error);
  }, [scale, target, view]);
  return <>{children}</>;
}
