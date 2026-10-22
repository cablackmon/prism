'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { previewEvent, serializeCalendar, validateCalendarIdentity, validateEvent,
  type CalendarIdentity, type RecurrenceEvent, type RecurrencePreview } from '../../lib/burn4-all-day-recurrence';

export type RecurrenceDraft = Readonly<{
  title: string; description: string; startDate: string; durationDays: string;
  frequency: RecurrenceEvent['frequency']; interval: string;
  weekdays: readonly ('MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU')[];
  endingMode: 'never' | 'count' | 'until'; count: string; until: string;
}>;
type Anchor = { href: string; download: string; click(): void; remove(): void };
export type DownloadCapabilities = Readonly<{
  createBlob(parts: BlobPart[], options: BlobPropertyBag): Blob;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): Anchor;
  appendAnchor(anchor: Anchor): void;
  schedule(callback: () => void, delay: number): unknown;
  cancel(handle: unknown): void;
}>;
type Props = {
  createIdentity?: () => CalendarIdentity;
  downloadCapabilities?: DownloadCapabilities | null;
} & ({ value: RecurrenceDraft; onChange(value: RecurrenceDraft): void } |
  { value?: undefined; onChange?: undefined });
type Accepted = { event: RecurrenceEvent; key: string; preview: RecurrencePreview };
type Artifact = { key: string; identity: CalendarIdentity; text?: string };
type Lease = { release(): void };
const initial: RecurrenceDraft = { title: '', description: '', startDate: '', durationDays: '1',
  frequency: 'DAILY', interval: '1', weekdays: ['MO'], endingMode: 'never', count: '5', until: '' };
const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
function numeric(value: string) {
  return typeof value === 'string' && /^\d{1,8}$/.test(value) ? Number(value) : NaN;
}
function validateDraft(draft: RecurrenceDraft) {
  const result = validateEvent({ title: draft.title, ...(draft.description === '' ? {} : { description: draft.description }),
    startDate: draft.startDate, durationDays: numeric(draft.durationDays), frequency: draft.frequency,
    interval: numeric(draft.interval), ...(draft.frequency === 'WEEKLY' ? { weekdays: draft.weekdays } : {}),
    ending: draft.endingMode === 'count' ? { mode: 'count', count: numeric(draft.count) } :
      draft.endingMode === 'until' ? { mode: 'until', until: draft.until } : { mode: draft.endingMode } });
  if (result.ok) return result;
  const errors = { ...result.errors };
  if (errors.ending && (draft.endingMode === 'count' || draft.endingMode === 'until')) {
    errors[draft.endingMode] = errors.ending; delete errors.ending;
  }
  return { ok: false as const, errors };
}
const stopLabels: Record<RecurrencePreview['stop'], string> = {
  'count-ended': 'The occurrence count is complete.',
  'until-ended': 'The inclusive ending date is reached.',
  'preview-limit': 'First 20 occurrences only. More dates follow.',
  'date-limit': 'Preview stopped at the supported date range. The rule is not shortened.',
};

/** An editable local draft. Only its current accepted preview can be exported. */
export default function AllDayRecurrenceBuilder(props: Props) {
  const [internal, setInternal] = useState<RecurrenceDraft>(initial);
  const draft = props.value ?? internal;
  const [accepted, setAccepted] = useState<Accepted | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [engineError, setEngineError] = useState('');
  const [output, setOutput] = useState({ key: '', text: '', status: '' });
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const controls = useRef<Record<string, HTMLElement | null>>({});
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const artifact = useRef<Artifact | null>(null);
  const activeLease = useRef<Lease | null>(null);
  const mounted = useRef(true);
  const prefix = useId();
  // These pure derived values belong to this render's event closures. Do not
  // publish speculative props through shared refs while React is rendering.
  const current = validateDraft(draft);
  const matches = !!accepted && current.ok && current.key === accepted.key && !engineError;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeLease.current?.release(); };
  }, []);
  useLayoutEffect(() => {
    if (focusRequest === 'results') resultHeading.current?.focus();
    else if (focusRequest) (controls.current[focusRequest] ?? controls.current.title)?.focus();
  }, [focusRequest, accepted, errors]);

  function change(patch: Partial<RecurrenceDraft>) {
    const next = { ...draft, ...patch };
    if (props.onChange) props.onChange(next); else setInternal(next);
    setErrors({}); setEngineError(''); setFocusRequest(null);
  }
  function acceptPreview() {
    if (!mounted.current) return;
    if (!current.ok) { setErrors(current.errors); setFocusRequest(Object.keys(current.errors)[0] ?? 'title'); return; }
    try {
      const preview = previewEvent(current.event);
      if (accepted?.key !== current.key) {
        artifact.current = null;
        activeLease.current?.release();
        setOutput({ key: '', text: '', status: '' });
      }
      setErrors({}); setEngineError('');
      setAccepted({ event: current.event, key: current.key, preview });
      setFocusRequest('results');
    } catch {
      setEngineError('Unable to preview this supported rule. Check the event and try again.');
      setErrors({ event: 'Unable to preview this supported rule.' }); setFocusRequest('title');
    }
  }
  function download() {
    if (!mounted.current || !matches || !accepted) return;
    let saved = artifact.current;
    try {
      if (!saved || saved.key !== accepted.key) {
        if (!props.createIdentity) throw new Error('Identity capability unavailable');
        saved = { key: accepted.key, identity: validateCalendarIdentity(props.createIdentity()) };
        artifact.current = saved;
      }
      if (saved.text === undefined) saved.text = serializeCalendar(accepted.event, saved.identity);
      const text = saved.text;
      setOutput({ key: accepted.key, text, status: 'Preparing calendar download.' });
      const caps = props.downloadCapabilities;
      if (!caps) throw new Error('Download unavailable');
      activeLease.current?.release();
      const blob = caps.createBlob([text], { type: 'text/calendar;charset=utf-8' });
      const url = caps.createObjectURL(blob);
      let released = false;
      let scheduled = false;
      let timer: unknown;
      const lease: Lease = { release() {
        if (released) return;
        released = true;
        if (scheduled) { try { caps.cancel(timer); } catch { /* URL still needs cleanup. */ } }
        try { caps.revokeObjectURL(url); } catch { /* Cleanup is best effort. */ }
        if (activeLease.current === lease) activeLease.current = null;
      } };
      activeLease.current = lease;
      let anchor: Anchor | undefined;
      try {
        anchor = caps.createAnchor(); anchor.href = url; anchor.download = 'prism-recurrence.ics';
        caps.appendAnchor(anchor); anchor.click();
        timer = caps.schedule(() => lease.release(), 1000); scheduled = true;
      } catch (error) { lease.release(); throw error; }
      finally { anchor?.remove(); }
      setOutput({ key: accepted.key, text, status: 'Download started. Import the file in your calendar.' });
    } catch {
      activeLease.current?.release();
      setOutput({ key: accepted.key, text: saved?.text ?? '',
        status: saved?.text ? 'Download unavailable. Select and copy the calendar text below.' :
          'Unable to generate calendar text. Try export again.' });
    }
  }
  function reset() {
    if (props.onChange) props.onChange(initial); else setInternal(initial);
    activeLease.current?.release(); artifact.current = null;
    setAccepted(null); setErrors({}); setEngineError(''); setOutput({ key: '', text: '', status: '' });
    setFocusRequest('title');
  }
  function field(name: string) {
    return { id: `${prefix}-${name}`, 'aria-invalid': !!errors[name],
      'aria-describedby': errors[name] ? `${prefix}-${name}-error` : undefined,
      ref: (element: HTMLElement | null) => { controls.current[name] = element; } };
  }
  function error(name: string) {
    return errors[name] ? <p id={`${prefix}-${name}-error`} role="alert">{errors[name]}</p> : null;
  }
  const fieldClass = 'block w-full rounded border border-gray-400 bg-transparent p-2';
  return <section className="mx-auto max-w-3xl space-y-5 p-4" aria-label="All-day recurrence builder">
    <p>Create a portable all-day calendar file. This page does not save events in Prism.
      Accepting a changed event creates a separate calendar identity at its next export.</p>
    <form noValidate onSubmit={event => { event.preventDefault(); acceptPreview(); }} className="space-y-4">
      <label className="block" htmlFor={`${prefix}-title`}>Title
        <input {...field('title')} required className={fieldClass} value={draft.title} maxLength={255}
          onChange={event => change({ title: event.target.value })} />
      </label>{error('title')}
      <label className="block" htmlFor={`${prefix}-description`}>Description (optional)
        <textarea {...field('description')} className={fieldClass} value={draft.description} maxLength={4000}
          onChange={event => change({ description: event.target.value })} />
      </label>{error('description')}
      <label className="block" htmlFor={`${prefix}-startDate`}>Start date
        <input {...field('startDate')} required className={fieldClass} type="date" min="1900-01-01" max="9999-12-31"
          value={draft.startDate} onChange={event => change({ startDate: event.target.value })} />
      </label>{error('startDate')}
      <label className="block" htmlFor={`${prefix}-durationDays`}>Duration in calendar days
        <input {...field('durationDays')} className={fieldClass} inputMode="numeric" maxLength={8} value={draft.durationDays}
          onChange={event => change({ durationDays: event.target.value })} />
      </label>{error('durationDays')}
      <label className="block" htmlFor={`${prefix}-frequency`}>Cadence
        <select {...field('frequency')} className={fieldClass} value={draft.frequency}
          onChange={event => change({ frequency: event.target.value as RecurrenceDraft['frequency'] })}>
          <option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly on the start day</option><option value="YEARLY">Yearly on the start month and day</option>
        </select>
      </label>{error('frequency')}
      <label className="block" htmlFor={`${prefix}-interval`}>Repeat every (cadence periods)
        <input {...field('interval')} className={fieldClass} inputMode="numeric" maxLength={8} value={draft.interval}
          onChange={event => change({ interval: event.target.value })} />
      </label>{error('interval')}
      {draft.frequency === 'WEEKLY' && <fieldset aria-describedby={errors.weekdays ? `${prefix}-weekdays-error` : undefined}>
        <legend>Selected weekdays (include the start weekday)</legend>
        {weekdays.map((day, index) => <label key={day} className="mr-3 inline-flex gap-1">
          <input type="checkbox" aria-label={day} checked={draft.weekdays.includes(day)}
            ref={index === 0 ? element => { controls.current.weekdays = element; } : undefined}
            onChange={event => change({ weekdays: event.target.checked ? [...draft.weekdays, day] : draft.weekdays.filter(value => value !== day) })} />{day}
        </label>)}{error('weekdays')}
      </fieldset>}
      <fieldset>
        <legend>Series ending</legend>
        <label htmlFor={`${prefix}-ending`}>End mode
          <select {...field('ending')} className={fieldClass} value={draft.endingMode}
            onChange={event => change({ endingMode: event.target.value as RecurrenceDraft['endingMode'] })}>
            <option value="never">Never</option><option value="count">After an occurrence count</option><option value="until">Through an inclusive date</option>
          </select>
        </label>
        {draft.endingMode === 'count' && <><label>Occurrence count
          <input {...field('count')} required className={fieldClass} inputMode="numeric" maxLength={8} value={draft.count}
            onChange={event => change({ count: event.target.value })} />
        </label>{error('count')}</>}
        {draft.endingMode === 'until' && <><label>Inclusive ending date
          <input {...field('until')} required className={fieldClass} type="date" min="1900-01-01" max="9999-12-31" value={draft.until}
            onChange={event => change({ until: event.target.value })} />
        </label>{error('until')}</>}{error('ending')}
      </fieldset>
      {error('event')}
      <div className="flex flex-wrap gap-3">
        <button className="rounded border px-4 py-2" type="submit">Preview</button>
        <button className="rounded border px-4 py-2" type="button" disabled={!matches} onClick={download}>Download calendar</button>
        <button className="rounded border px-4 py-2" type="button" onClick={reset}>New event / reset</button>
      </div>
    </form>
    {accepted && <section aria-label={matches ? 'Current preview' : 'Previous preview'}>
      <h2 className="text-xl font-semibold" ref={resultHeading} tabIndex={-1}>First occurrences{matches ? '' : ' (previous event)'}</h2>
      <p>Start dates are inclusive. End dates are exclusive, after the final occupied day.</p>
      <ol className="list-inside list-decimal">{accepted.preview.rows.map(row => <li key={row.startDate}>
        <time dateTime={row.startDate}>{row.startDate}</time> to <time dateTime={row.endExclusive}>{row.endExclusive}</time> (exclusive end)
      </li>)}</ol><p>{stopLabels[accepted.preview.stop]}</p>
    </section>}
    {engineError && <p role="alert">{engineError}</p>}
    <p role="status" aria-live="polite">{matches && output.key === accepted?.key ? output.status : ''}</p>
    {matches && output.key === accepted?.key && output.text && <label className="block">Calendar text for manual copy
      <textarea className={fieldClass} readOnly rows={8} value={output.text} onFocus={event => event.target.select()}
        onCopy={event => {
          // Textarea value normalizes CRLF to LF. A user copy keeps the artifact's
          // exact original bytes through the synchronous native copy event.
          try { event.clipboardData.setData('text/plain', output.text); event.preventDefault(); }
          catch { setOutput(previous => ({ ...previous, status: 'Copy unavailable. Download the file or select the text manually.' })); }
        }} />
    </label>}
  </section>;
}
