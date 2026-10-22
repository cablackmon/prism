'use client';

import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { acknowledgesPixelSave, changePixelRect, pixelPointerDelta, pixelSaveCommand, readPixelLayout,
  samePixelLayout, setPixelRect, type PixelItem, type PixelLayout, type PixelSaveCommand } from '../../lib/burn4-freeform-layout';

export interface Burn4FreeformLayoutEditorProps {
  snapshot: unknown;
  onCommit: (command: PixelSaveCommand) => void | Promise<void>;
}
type Phase = 'idle' | 'submitting' | 'awaiting' | 'error' | 'conflict';
interface State { base: PixelLayout; draft: PixelLayout; command?: PixelSaveCommand; phase: Phase; message: string }
interface Gesture {
  pointerId: number; element: HTMLButtonElement; origin: PixelLayout; id: string;
  mode: 'move' | 'resize'; startX: number; startY: number; width: number; height: number;
}
/** Standalone experimental editor. The host owns authorization, persistence and CAS. */
export function Burn4FreeformLayoutEditor(props: Burn4FreeformLayoutEditorProps) {
  let host: PixelLayout;
  try { host = readPixelLayout(props.snapshot); }
  catch { return <p role="alert">The supplied pixel layout is invalid.</p>; }
  return <Editor key={host.layoutId} host={host} onCommit={props.onCommit} />;
}
function Editor({ host, onCommit }: { host: PixelLayout; onCommit: Burn4FreeformLayoutEditorProps['onCommit'] }) {
  const prefix = useId();
  const [state, setState] = useState<State>({ base: host, draft: host, phase: 'idle', message: '' });
  const current = useRef(state);
  const [selected, setSelected] = useState(host.items[0]?.id ?? '');
  const [fields, setFields] = useState({ x: '', y: '', width: '', height: '' });
  const [fieldError, setFieldError] = useState('');
  const canvas = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const epoch = useRef(0);
  const hostRef = useRef(host);
  const update = (next: State) => { current.current = next; setState(next); };
  const release = () => {
    const active = gesture.current;
    gesture.current = null;
    if (active) {
      try { active.element.releasePointerCapture(active.pointerId); } catch { /* Capture may already be lost. */ }
    }
  };
  useLayoutEffect(() => () => { epoch.current++; release(); }, []);
  const hostKey = JSON.stringify(host);
  useLayoutEffect(() => {
    // Publish only committed props. Suspended renders must not affect visible controls.
    hostRef.current = host;
    const s = current.current;
    const editing = s.draft.items.find(entry => entry.id === selected);
    const unapplied = Boolean(editing && (['x', 'y', 'width', 'height'] as const).some(name => fields[name] !== String(editing[name])));
    if (samePixelLayout(host, s.base) || s.phase === 'conflict') return;
    epoch.current++;
    release();
    if (s.command && acknowledgesPixelSave(s.command, host)) {
      update({ base: host, draft: host, phase: 'idle', message: 'Layout saved.' });
    } else if (host.revision > s.base.revision && samePixelLayout(s.base, s.draft) && !s.command && !unapplied) {
      update({ base: host, draft: host, phase: 'idle', message: 'Layout updated.' });
    } else {
      update({ ...s, phase: 'conflict', message: 'The layout changed. Reload the latest snapshot before editing or saving.' });
    }
    setFieldError('');
  // The normalized content key prevents equal host objects from resetting local edits.
  }, [hostKey]);
  const item = state.draft.items.find(entry => entry.id === selected);
  const itemKey = item ? JSON.stringify(item) : '';
  useLayoutEffect(() => {
    if (!item) {
      setSelected(state.draft.items[0]?.id ?? '');
      selection.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    setFields({ x: String(item.x), y: String(item.y), width: String(item.width), height: String(item.height) });
    setFieldError('');
  }, [itemKey]);
  const locked = state.phase !== 'idle';
  const dirty = !samePixelLayout(state.base, state.draft);
  const coordinateDirty = Boolean(item && (['x', 'y', 'width', 'height'] as const).some(name => fields[name] !== String(item[name])));
  const restoreFields = (layout: PixelLayout) => {
    const entry = layout.items.find(candidate => candidate.id === selected) ?? layout.items[0];
    if (entry) setFields({ x: String(entry.x), y: String(entry.y), width: String(entry.width), height: String(entry.height) });
    setFieldError('');
  };
  const change = (draft: PixelLayout) => { setFieldError(''); update({ ...current.current, draft, message: '' }); };
  const cancelGesture = () => {
    const active = gesture.current;
    if (!active) return;
    release();
    change(active.origin);
  };
  const begin = (event: React.PointerEvent<HTMLButtonElement>, entry: PixelItem, mode: 'move' | 'resize') => {
    if (current.current.phase !== 'idle' || gesture.current || event.button !== 0 || event.isPrimary === false) return;
    const bounds = canvas.current?.getBoundingClientRect();
    try {
      pixelPointerDelta(current.current.draft.canvas, bounds ?? { width: 0, height: 0 }, 0, 0);
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) throw new Error('Invalid pointer.');
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      update({ ...current.current, message: 'Pointer editing is unavailable. Use the arrow keys or coordinate fields.' });
      return;
    }
    setSelected(entry.id);
    event.currentTarget.focus();
    gesture.current = { pointerId: event.pointerId, element: event.currentTarget, origin: current.current.draft,
      id: entry.id, mode, startX: event.clientX, startY: event.clientY, width: bounds!.width, height: bounds!.height };
    event.preventDefault();
  };
  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    try {
      const delta = pixelPointerDelta(active.origin.canvas, active, event.clientX - active.startX, event.clientY - active.startY);
      change(changePixelRect(active.origin, active.id, active.mode, delta.dx, delta.dy));
    } catch { cancelGesture(); }
  };
  const finish = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    move(event);
    release();
  };
  const keys = (event: React.KeyboardEvent<HTMLButtonElement>, entry: PixelItem, mode: 'move' | 'resize') => {
    if (event.key === 'Escape') { event.preventDefault(); cancelGesture(); return; }
    if (current.current.phase !== 'idle' || gesture.current || event.ctrlKey || event.metaKey || event.altKey) return;
    const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    change(changePixelRect(current.current.draft, entry.id, mode, offset[0] * step, offset[1] * step));
  };
  const submit = (command: PixelSaveCommand) => {
    const token = ++epoch.current;
    update({ ...current.current, command, phase: 'submitting', message: 'Submitting layout.' });
    const settle = (failed: boolean) => {
      if (token !== epoch.current || current.current.command !== command) return;
      update({ ...current.current, phase: failed ? 'error' : 'awaiting', message: failed
        ? 'Save failed or could not be confirmed. Retry the same layout or reload the latest snapshot.'
        : 'Waiting for the host to confirm this exact layout. Retry or reload if needed.' });
    };
    try { Promise.resolve(onCommit(command)).then(() => settle(false), () => settle(true)); }
    catch { settle(true); }
  };
  const save = () => {
    const s = current.current;
    if (s.phase === 'submitting' || s.phase === 'conflict' || gesture.current || coordinateDirty) return;
    if (s.command) { submit(s.command); return; }
    if (samePixelLayout(s.base, s.draft)) return;
    try { submit(pixelSaveCommand(s.base, s.draft)); }
    catch { update({ ...s, message: 'This layout cannot be saved because its revision limit was reached.' }); }
  };
  const reload = () => {
    epoch.current++;
    release();
    const latest = hostRef.current;
    update({ base: latest, draft: latest, phase: 'idle', message: 'Loaded the latest supplied snapshot.' });
    restoreFields(latest);
  };
  const applyFields = (event: React.FormEvent) => {
    event.preventDefault();
    if (!item || current.current.phase !== 'idle' || gesture.current) return;
    try {
      if (Object.values(fields).some(value => !/^\d+$/.test(value))) throw new Error('Invalid coordinates.');
      change(setPixelRect(current.current.draft, item.id, { x: Number(fields.x), y: Number(fields.y), width: Number(fields.width), height: Number(fields.height) }));
    } catch { setFieldError('Enter whole pixels that fit the canvas and the widget minimum size.'); }
  };
  const cancelPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.pointerId === event.pointerId) cancelGesture();
  };
  return <section aria-label="Freeform pixel layout editor">
    <h2>Freeform pixel layout</h2>
    <p>Experimental pixel canvas: {state.draft.canvas.width} by {state.draft.canvas.height}. Overlap is allowed.</p>
    <p id={`${prefix}-help`}>Select a widget. Use the move or resize handle with arrow keys, or enter exact pixels. Shift changes ten pixels. Escape cancels a pointer gesture.</p>
    <div aria-label="Pixel canvas" ref={canvas} style={{ position: 'relative', width: '100%', aspectRatio: `${state.draft.canvas.width} / ${state.draft.canvas.height}`, border: '1px solid currentColor' }}>
      {state.draft.items.map(entry => <div key={entry.id} data-widget-id={entry.id} style={{ position: 'absolute',
        left: `${entry.x / state.draft.canvas.width * 100}%`, top: `${entry.y / state.draft.canvas.height * 100}%`,
        width: `${entry.width / state.draft.canvas.width * 100}%`, height: `${entry.height / state.draft.canvas.height * 100}%`,
        outline: selected === entry.id ? '2px solid currentColor' : '1px dotted currentColor', background: 'Canvas', color: 'CanvasText' }}>
        <span>{entry.label}</span>
        {(['move', 'resize'] as const).map(mode => <button key={mode} type="button" disabled={locked}
          aria-label={`${mode === 'move' ? 'Move' : 'Resize'} ${entry.label}`} aria-describedby={`${prefix}-help`}
          style={{ touchAction: 'none' }} onFocus={() => setSelected(entry.id)}
          onKeyDown={event => keys(event, entry, mode)} onPointerDown={event => begin(event, entry, mode)}
          onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}>
          {mode === 'move' ? 'Move' : 'Resize'}
        </button>)}
      </div>)}
    </div>
    {!state.draft.items.length && <p>No widgets in this layout.</p>}
    <div ref={selection} role="group" aria-label="Select widget">{state.draft.items.map(entry => <button key={entry.id} type="button" disabled={locked}
      aria-pressed={entry.id === selected} onClick={() => setSelected(entry.id)}>{entry.label}</button>)}</div>
    {item && <form onSubmit={applyFields} noValidate aria-label={`Coordinates for ${item.label}`}>
      <fieldset disabled={locked}><legend>{item.label} coordinates</legend>
        {(['x', 'y', 'width', 'height'] as const).map(name => <label key={name} htmlFor={`${prefix}-${name}`}>{name}
          <input id={`${prefix}-${name}`} type="number" step="1" min={name === 'width' ? item.minWidth : name === 'height' ? item.minHeight : 0}
            max={name === 'x' ? state.draft.canvas.width - item.width : name === 'y' ? state.draft.canvas.height - item.height : name === 'width' ? state.draft.canvas.width - item.x : state.draft.canvas.height - item.y}
            value={fields[name]} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? `${prefix}-error` : undefined}
            onChange={event => setFields({ ...fields, [name]: event.target.value })} />
        </label>)}
        <button type="submit">Apply coordinates</button>
      </fieldset>
      {fieldError && <p id={`${prefix}-error`} role="alert">{fieldError}</p>}
    </form>}
    <button type="button" disabled={locked || (!dirty && !coordinateDirty)} onClick={() => { release(); change(current.current.base); restoreFields(current.current.base); }}>Reset draft</button>
    <button type="button" disabled={state.phase === 'submitting' || state.phase === 'conflict' || coordinateDirty || (!dirty && !state.command)} onClick={save}>
      {state.command ? 'Retry save' : 'Save layout'}
    </button>
    <button type="button" onClick={reload}>Reload latest</button>
    <p role="status" aria-live="polite">{state.message || (dirty ? 'Unsaved changes.' : 'No unsaved changes.')}</p>
  </section>;
}
