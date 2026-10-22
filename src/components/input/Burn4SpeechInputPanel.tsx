'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clipSpeechInterim,
  isSpeechSessionId,
  isSpeechTarget,
  normalizeSpeechLanguages,
  positionSpeechPanel,
  type SpeechLanguage,
  type SpeechPanelPosition,
} from './burn4SpeechInputPanelModel';

export type Burn4SpeechFeedback = Readonly<{
  sessionId: string;
  target: Element;
  isListening: boolean;
  interimText: string;
}>;

export type Burn4SpeechInputPanelProps = Readonly<{
  visible: boolean;
  activeTarget: Element | null;
  activeSessionId: string | null;
  feedback: Burn4SpeechFeedback | null;
  language: string;
  languages: readonly SpeechLanguage[];
  onLanguageChange: (language: string) => void;
  onStop: (sessionId: string) => void;
}>;

/** Controlled interim feedback. The caller owns recognition, insertion and preferences. */
export function Burn4SpeechInputPanel({
  visible, activeTarget, activeSessionId, feedback, language, languages, onLanguageChange, onStop,
}: Burn4SpeechInputPanelProps): React.ReactPortal | null {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<SpeechPanelPosition | null>(null);
  const [, recheckTarget] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const stopped = useRef<{ target: Element; id: string } | null>(null);
  const labelId = useId();
  const eligible = visible && isSpeechTarget(activeTarget);
  const configuration = normalizeSpeechLanguages(language, languages);
  const validSession = activeSessionId === null || isSpeechSessionId(activeSessionId);
  const matching = eligible && validSession && activeSessionId !== null &&
    feedback?.sessionId === activeSessionId && feedback.target === activeTarget;
  const listening = matching && feedback.isListening && configuration.ok;
  const partial = listening ? clipSpeechInterim(feedback.interimText) : '';

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    stopped.current = null;
  }, [activeTarget, activeSessionId]);

  useEffect(() => {
    setPosition(null);
    if (!mounted || !eligible || !activeTarget) return;
    const target = activeTarget;
    const win = target.ownerDocument.defaultView;
    const panel = panelRef.current;
    if (!win || !panel) return;
    let cancelled = false;
    let frame: number | null = null;
    const measure = (): void => {
      if (cancelled) return;
      if (!isSpeechTarget(target)) {
        setPosition(null);
        recheckTarget((revision) => revision + 1);
        return;
      }
      const rect = target.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const next = positionSpeechPanel(
        rect,
        { width: panelRect.width || 360, height: panel.scrollHeight || panelRect.height || 120 },
        { width: win.innerWidth, height: win.innerHeight },
      );
      setPosition((current) => current?.left === next?.left && current?.top === next?.top &&
        current?.width === next?.width && current?.maxHeight === next?.maxHeight &&
        current?.placement === next?.placement ? current : next);
    };
    const schedule = (): void => {
      if (frame !== null || cancelled) return;
      if (typeof win.requestAnimationFrame !== 'function') { measure(); return; }
      frame = win.requestAnimationFrame(() => { frame = null; measure(); });
    };
    measure();
    win.addEventListener('resize', schedule);
    win.addEventListener('scroll', schedule, true);
    const Resize = win.ResizeObserver;
    const observer = typeof Resize === 'function' ? new Resize(schedule) : null;
    observer?.observe(target);
    observer?.observe(panel);
    const Mutation = win.MutationObserver;
    const mutation = typeof Mutation === 'function' ? new Mutation(schedule) : null;
    mutation?.observe(target.ownerDocument.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['disabled', 'readonly', 'type', 'contenteditable', 'aria-disabled', 'aria-readonly', 'hidden', 'inert'],
    });
    return () => {
      cancelled = true;
      win.removeEventListener('resize', schedule);
      win.removeEventListener('scroll', schedule, true);
      observer?.disconnect();
      mutation?.disconnect();
      if (frame !== null) win.cancelAnimationFrame(frame);
    };
  }, [mounted, eligible, activeTarget, activeSessionId, partial, listening, configuration.ok, language, languages]);

  const requestStop = (): void => {
    if (!listening || !activeTarget || !isSpeechTarget(activeTarget) || !activeSessionId || !position) return;
    if (stopped.current?.target === activeTarget && stopped.current.id === activeSessionId) return;
    stopped.current = { target: activeTarget, id: activeSessionId };
    onStop(activeSessionId);
  };

  useEffect(() => {
    if (!mounted || !listening || !activeTarget || !position) return;
    const doc = activeTarget.ownerDocument;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const focused = doc.activeElement;
      if (focused !== activeTarget && !activeTarget.contains(focused) && !panelRef.current?.contains(focused)) return;
      event.preventDefault();
      requestStop();
    };
    doc.addEventListener('keydown', handleKey);
    return () => doc.removeEventListener('keydown', handleKey);
  });

  if (!mounted || !eligible || !activeTarget?.ownerDocument.body) return null;
  const error = !configuration.ok ? configuration.message : !validSession ? 'Speech session is not configured correctly.' : null;
  return createPortal(
    <div
      ref={panelRef}
      data-burn4-speech-panel=""
      data-placement={position?.placement}
      role="region"
      aria-label="Voice input"
      style={{
        position: 'fixed', zIndex: 9100, left: position?.left ?? 0, top: position?.top ?? 0,
        width: position?.width ?? 360, maxWidth: 'calc(100vw - 16px)',
        maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden',
        boxSizing: 'border-box', overflowY: 'auto', padding: 12, borderRadius: 10,
        border: '1px solid currentColor', background: 'Canvas', color: 'CanvasText',
        fontFamily: 'system-ui, sans-serif', boxShadow: '0 2px 8px #0003',
      }}
    >
      {error ? <p role="alert">{error}</p> : configuration.ok && <>
        <label htmlFor={labelId}>Speech language</label>
        <select
          id={labelId}
          value={configuration.language}
          disabled={activeSessionId !== null}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (activeSessionId === null && isSpeechTarget(activeTarget) && next !== configuration.language &&
                configuration.languages.some((option) => option.tag === next)) onLanguageChange(next);
          }}
          style={{ display: 'block', width: '100%', minHeight: 44, marginTop: 4 }}
        >
          {configuration.languages.map((option) => <option key={option.tag} value={option.tag}>{option.label}</option>)}
        </select>
        {listening && <>
          <p role="status" aria-live="polite" aria-atomic="true" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            <strong>Interim speech: </strong>{partial.trim() ? partial : 'Listening…'}
          </p>
          <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={requestStop} style={{ minHeight: 44 }}>
            Stop listening
          </button>
        </>}
      </>}
    </div>,
    activeTarget.ownerDocument.body,
  );
}
