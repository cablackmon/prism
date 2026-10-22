'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  completeWeeklyTask, isWeeklyTaskAcknowledged, nextWeeklyTaskDate, parseWeeklyTaskSnapshot,
  type WeeklyCompletionCommand, type WeeklyTaskSnapshot,
} from '../../lib/burn4-recurring-task';

export interface WeeklyTaskCommitRequest {
  readonly command: WeeklyCompletionCommand;
  readonly snapshot: WeeklyTaskSnapshot;
}

export interface WeeklyTaskCompletionProps {
  readonly snapshot: WeeklyTaskSnapshot;
  readonly taskId: string;
  readonly actorId: string;
  readonly completedAt: string;
  readonly commandId: string;
  readonly successorId: string;
  readonly onCommit: (request: WeeklyTaskCommitRequest) => void | Promise<void>;
}

type Phase = 'idle' | 'confirm' | 'sending' | 'waiting' | 'retry' | 'saved' | 'conflict';
interface Pending {
  readonly request: WeeklyTaskCommitRequest;
  readonly base: WeeklyTaskSnapshot;
}

/** One controlled weekly completion session. Task/profile changes discard local UI only. */
export function WeeklyTaskCompletion(props: WeeklyTaskCompletionProps): React.ReactElement {
  return <CompletionSession key={`${props.taskId}/${props.actorId}`} {...props} />;
}

function CompletionSession(props: WeeklyTaskCompletionProps): React.ReactElement {
  const labelId = useId();
  const [phase, setPhase] = useState<Phase>('idle');
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  const live = useRef(true);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const terminal = useRef<'none' | 'saved' | 'conflict'>('none');
  const completeButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const previousPhase = useRef<Phase>('idle');

  let current: WeeklyTaskSnapshot | null = null;
  let nextDate: string | null = null;
  try {
    current = parseWeeklyTaskSnapshot(props.snapshot);
    const task = current.tasks.find(row => row.id === props.taskId);
    if (task && !task.completed) nextDate = nextWeeklyTaskDate(task.anchorDate, task.occurrence + 1);
  } catch { /* Invalid or exhausted input has no completion control. */ }
  const task = current?.tasks.find(row => row.id === props.taskId);
  const acknowledged = !!pending && isWeeklyTaskAcknowledged(current, pending.request.snapshot, pending.request.command);
  const conflict = !!pending && !acknowledged && (phase === 'saved' || phase === 'conflict' || !current || JSON.stringify(current) !== JSON.stringify(pending.base));

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; generation.current++; };
  }, []);

  useEffect(() => {
    // Only a committed render may fence host settlement. Suspended or abandoned
    // candidate renders must not publish acknowledgement into the visible UI.
    terminal.current = acknowledged ? 'saved' : conflict ? 'conflict' : 'none';
    if (acknowledged) { setPhase('saved'); setError(false); }
    else if (conflict) { setPhase('conflict'); setError(false); }
  }, [acknowledged, conflict]);

  useEffect(() => {
    if (phase === 'idle' && previousPhase.current === 'confirm') completeButton.current?.focus();
    if (phase === 'confirm') confirmButton.current?.focus();
    if (phase === 'saved' || phase === 'conflict') status.current?.focus();
    previousPhase.current = phase;
  }, [phase]);

  function send(request: Pending): void {
    if (inFlight.current) return;
    inFlight.current = true;
    const attempt = ++generation.current;
    pendingRef.current = request;
    setPending(request);
    setPhase('sending');
    setError(false);
    const settle = (failed: boolean): void => {
      if (!live.current || generation.current !== attempt || pendingRef.current !== request) return;
      inFlight.current = false;
      if (terminal.current !== 'none') return;
      setPhase(failed ? 'retry' : 'waiting');
      setError(failed);
    };
    try {
      Promise.resolve(props.onCommit(request.request)).then(() => settle(false), () => settle(true));
    } catch { settle(true); }
  }

  function confirm(): void {
    if (pendingRef.current || !current) return;
    try {
      const result = completeWeeklyTask(current, {
        id: props.commandId, expectedRevision: current.revision, taskId: props.taskId,
        successorId: props.successorId, actorId: props.actorId, completedAt: props.completedAt,
      });
      const request = Object.freeze({ request: Object.freeze({ command: result.command, snapshot: result.snapshot }), base: current });
      send(request);
    } catch { setError(true); }
  }

  function cancel(): void {
    setPhase('idle');
    setError(false);
    completeButton.current?.focus();
  }

  function reload(): void {
    generation.current++;
    pendingRef.current = null;
    inFlight.current = false;
    terminal.current = 'none';
    setPending(null);
    setPhase('idle');
    setError(false);
  }

  const displayedPhase: Phase = acknowledged ? 'saved' : conflict ? 'conflict' : phase;
  const message = displayedPhase === 'sending' ? 'Sending completion to the host.'
    : displayedPhase === 'waiting' ? 'Waiting for the host to confirm the saved task state.'
    : displayedPhase === 'retry' ? 'Saving is uncertain. Retry uses the same operation and next task.'
    : displayedPhase === 'saved' ? 'Task completed and next weekly task saved.'
    : displayedPhase === 'conflict' ? 'The host task state changed. Reload before another operation.' : '';

  return <section aria-labelledby={labelId} aria-busy={displayedPhase === 'sending'}>
    <h2 id={labelId}>Complete weekly task</h2>
    {task && <p>{task.title}</p>}
    {message && <p role="status" aria-live="polite" tabIndex={-1} ref={status}>{message}</p>}
    {error && !acknowledged && !conflict && <p role="alert">The operation could not be confirmed. Check the supplied task state or retry the same operation.</p>}
    {!pending && (!current || !task || (!task.completed && !nextDate)) && <p role="alert">A valid local task with a supported next weekly date is required.</p>}
    {!pending && task?.completed && <p>This task is already complete.</p>}
    {!pending && nextDate && <>
      <p>Next task due: <time dateTime={nextDate}>{nextDate}</time></p>
      {phase === 'confirm' ? <>
        <p>Complete this occurrence and create the next weekly task?</p>
        <button type="button" ref={confirmButton} onClick={confirm}>Confirm completion</button>
        <button type="button" onClick={cancel}>Cancel</button>
      </> : <button type="button" ref={completeButton} onClick={() => { setPhase('confirm'); setError(false); }}>Complete and create next task</button>}
    </>}
    {pending && (displayedPhase === 'retry' || displayedPhase === 'waiting') && <button type="button" onClick={() => {
      if (pendingRef.current === pending) send(pending);
    }}>Retry same operation</button>}
    {pending && displayedPhase === 'sending' && <button type="button" disabled>Saving completion</button>}
    {pending && displayedPhase === 'conflict' && <button type="button" onClick={reload}>Reload current task</button>}
  </section>;
}
