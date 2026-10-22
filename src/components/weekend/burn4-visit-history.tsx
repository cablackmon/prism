'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  appendVisit, isVisitDate, sameVisitContent, selectVisitHistory, validateVisitCatalog,
  validateVisitDraft, validateVisitJournal, VISIT_LIMITS,
  type Visit, type VisitCatalog, type VisitJournal, type VisitIssue,
} from '../../lib/burn4-weekend-visit-history';

export type VisitCommitRequest = Readonly<{ visit: Visit; expectedRevision: number; nextJournal: VisitJournal }>;
export type VisitCommitResponse = Readonly<{ status: 'accepted' | 'rejected' }>;
export type WeekendVisitHistoryProps = {
  journal: unknown; catalog: unknown; placeId: string; initialDate?: string;
  legacy?: Readonly<{ visitCount: number; lastVisitedDate: string | null }>;
  createVisitId: () => string;
  onChange: (request: VisitCommitRequest) => VisitCommitResponse | Promise<VisitCommitResponse>;
};
type FormDraft = { placeId: string; visitedOn: string; attendeeIds: string[]; rating: string; notes: string };
type Attempt = { visit: Visit; token: number; phase: 'saving' | 'awaiting' | 'uncertain' };
type HostState = { journal: VisitJournal | null; key: string; problem: string | null };
type FormError = { message: string; field?: string };

function fingerprint(journal: VisitJournal) {
  return JSON.stringify([...journal.entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function fresh(placeId: string, date?: string): FormDraft {
  return { placeId, visitedOn: isVisitDate(date) ? date : '', attendeeIds: [], rating: '', notes: '' };
}
function displayId(value: string) {
  return typeof value === 'string' && value.length > 0 && value.length <= VISIT_LIMITS.id ? value : 'Unavailable place';
}
function issueError(issues: readonly VisitIssue[]): FormError {
  const first = issues[0];
  const field = first?.path.split('.').at(-1);
  const messages: Record<string, string> = {
    'date-invalid': 'Choose a real visit date in YYYY-MM-DD format.',
    'rating-invalid': 'Choose a rating from 1 to 5, or Not rated.',
    'notes-invalid': 'Keep notes within 4,000 characters.',
    'attendee-unknown': 'Choose participants from the available list.',
    'attendees-limit': 'Choose no more than 32 participants.',
    'place-unknown': 'The original place is no longer available. Your draft is unchanged.',
    'identity-conflict': 'A different visit already uses this identity. Your draft is unchanged.',
  };
  return { message: messages[first?.code ?? ''] ?? 'This visit cannot be recorded with the supplied data. Your draft is unchanged.', field };
}

/** Controlled committed history; one captured candidate remains host-owned until exact acknowledgement. */
export function WeekendVisitHistory(props: WeekendVisitHistoryProps) {
  const ids = useId();
  const dateId = `${ids}-date`;
  const errorId = `${ids}-error`;
  const catalogResult = useMemo(() => validateVisitCatalog(props.catalog), [props.catalog]);
  const journalResult = useMemo(() => validateVisitJournal(props.journal), [props.journal]);
  const [host, setHost] = useState<HostState>(() => journalResult.ok
    ? { journal: journalResult.value, key: fingerprint(journalResult.value), problem: null }
    : { journal: null, key: '', problem: 'The supplied history is invalid.' });
  const [draft, setDraft] = useState(() => fresh(props.placeId, props.initialDate));
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<FormError | null>(null);
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);
  const active = useRef<Attempt | null>(null);
  const allocating = useRef(false);
  const reserved = useRef<Visit | null>(null);
  const token = useRef(0);
  const mounted = useRef(true);
  const dateRef = useRef<HTMLInputElement>(null);
  const ratingRef = useRef<HTMLSelectElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const participantsRef = useRef<HTMLFieldSetElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const accepted = useRef(host);
  accepted.current = host;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; token.current += 1; active.current = null; };
  }, []);
  useEffect(() => {
    setHost((previous) => {
      if (!journalResult.ok) return { ...previous, problem: 'The supplied history is invalid.' };
      const incoming = journalResult.value;
      const key = fingerprint(incoming);
      if (previous.journal && (incoming.revision < previous.journal.revision ||
          (incoming.revision === previous.journal.revision && key !== previous.key))) {
        return { ...previous, problem: 'The host supplied stale or conflicting history. Your draft is unchanged.' };
      }
      if (previous.key === key && previous.journal?.revision === incoming.revision && !previous.problem) return previous;
      return { journal: incoming, key, problem: null };
    });
  }, [journalResult]);
  useEffect(() => { setPage(1); }, [props.placeId]);
  useEffect(() => {
    if (!error) return;
    if (error.field === 'visitedOn') dateRef.current?.focus();
    else if (error.field === 'rating') ratingRef.current?.focus();
    else if (error.field === 'notes') notesRef.current?.focus();
    else if (error.field === 'attendeeIds') participantsRef.current?.focus();
    else errorRef.current?.focus();
  }, [error]);

  function saved() {
    active.current = null;
    reserved.current = null;
    token.current += 1;
    setAttempt(null);
    setDraft(fresh(latest.current.placeId, latest.current.initialDate));
    setError(null);
    setNotice('Visit recorded.');
  }
  useEffect(() => {
    // A definitive refusal may settle in the same React batch as committed
    // props. Retain the unchanged reservation until an edit/cancel/new attempt,
    // so actual committed truth wins without erasing a newer draft.
    const candidate = active.current?.visit ?? reserved.current;
    if (!candidate || host.problem || !host.journal) return;
    const row = host.journal.entries.find((visit) => visit.id === candidate.id);
    if (!row) return;
    if (sameVisitContent(row, candidate)) saved();
    else {
      active.current = null;
      reserved.current = null;
      token.current += 1;
      setAttempt(null);
      setError(issueError([{ code: 'identity-conflict', path: 'visit.id' }]));
    }
  }, [host, attempt]);

  const catalog: VisitCatalog | null = catalogResult.ok ? catalogResult.value : null;
  const people = new Map(catalog?.participants.map((person) => [person.id, person.label]) ?? []);
  const places = new Map(catalog?.places.map((place) => [place.id, place.label]) ?? []);
  const target = attempt?.visit.placeId ?? draft.placeId;
  const targetMismatch = target !== props.placeId;
  const history = useMemo(() => host.journal ? selectVisitHistory(host.journal, props.placeId, page) : null,
    [host.journal, props.placeId, page]);
  const locked = attempt !== null;
  const unavailable = host.problem !== null || !host.journal || !catalog;

  function changed(change: Partial<FormDraft>) {
    if (active.current || allocating.current) return;
    reserved.current = null;
    setDraft((current) => ({ ...current, ...change }));
    setError(null);
    setNotice('');
  }
  function acknowledgeLatest(visit: Visit) {
    const observed = validateVisitJournal(latest.current.journal);
    const baseline = accepted.current.journal;
    if (!observed.ok || !baseline || observed.value.revision < baseline.revision ||
        (observed.value.revision === baseline.revision && fingerprint(observed.value) !== accepted.current.key)) return false;
    const row = observed.value.entries.find((item) => item.id === visit.id);
    if (!row || !sameVisitContent(row, visit)) return false;
    saved();
    return true;
  }
  function send(visit: Visit) {
    if (!host.journal || !catalog || host.problem) return;
    const next = appendVisit(host.journal, visit, catalog);
    if (next.status === 'replayed') { saved(); return; }
    if (next.status !== 'added') {
      // A missing target/conflict is a definitive inability to append, not a retarget.
      active.current = null;
      setAttempt(null);
      setError(issueError(next.issues));
      return;
    }
    const current: Attempt = { visit: next.visit, token: ++token.current, phase: 'saving' };
    active.current = current;
    reserved.current = current.visit;
    setAttempt(current);
    setNotice('');
    setError(null);
    const request = Object.freeze({ visit: current.visit, expectedRevision: host.journal.revision, nextJournal: next.journal });
    const stillCurrent = () => mounted.current && active.current?.token === current.token;
    const uncertain = () => {
      if (!stillCurrent()) return;
      if (acknowledgeLatest(current.visit)) return;
      const waiting: Attempt = { ...current, phase: 'uncertain' };
      active.current = waiting;
      setAttempt(waiting);
      setError({ message: 'Saving is not confirmed. Your draft is retained; Retry save uses the same visit.' });
    };
    const resolved = (response: VisitCommitResponse) => {
      if (!stillCurrent()) return;
      if (acknowledgeLatest(current.visit)) return;
      let responseStatus: unknown;
      try { responseStatus = response?.status; }
      catch { uncertain(); return; }
      if (responseStatus === 'accepted') {
        const waiting: Attempt = { ...current, phase: 'awaiting' };
        active.current = waiting;
        setAttempt(waiting);
      } else if (responseStatus === 'rejected') {
        active.current = null;
        token.current += 1;
        setAttempt(null);
        setError({ message: 'Saving was declined. Your draft is unchanged.' });
      } else uncertain();
    };
    try { Promise.resolve(props.onChange(request)).then(resolved, uncertain); }
    catch { uncertain(); }
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (allocating.current) return;
    const pending = active.current;
    if (pending) {
      if (pending.phase === 'uncertain' && !unavailable) send(pending.visit);
      return;
    }
    if (unavailable || targetMismatch) return;
    // Reserve synchronously before invoking caller code, including the ID factory.
    const guardToken = ++token.current;
    const prepared = validateVisitDraft({
      placeId: draft.placeId, visitedOn: draft.visitedOn, attendeeIds: draft.attendeeIds,
      rating: draft.rating === '' ? null : Number(draft.rating), notes: draft.notes,
    }, catalog);
    if (!prepared.ok) { setError(issueError(prepared.issues)); return; }
    const held = reserved.current;
    let candidate: Visit;
    if (held && sameVisitContent(held, prepared.value)) candidate = held;
    else {
      // Install a temporary guard so a reentrant factory cannot allocate twice.
      allocating.current = true;
      try { candidate = Object.freeze({ id: props.createVisitId(), ...prepared.value }); }
      catch {
        allocating.current = false;
        setError({ message: 'A visit identity could not be created. Your draft is unchanged.' });
        return;
      }
      allocating.current = false;
      if (!mounted.current || token.current !== guardToken) return;
    }
    send(candidate);
  }
  function cancel() {
    if (active.current || allocating.current) return;
    token.current += 1;
    reserved.current = null;
    setDraft(fresh(props.placeId, props.initialDate));
    setError(null);
    setNotice('Draft cleared.');
    dateRef.current?.focus();
  }

  const legacyValid = props.legacy && Number.isSafeInteger(props.legacy.visitCount) && props.legacy.visitCount >= 0 &&
    (props.legacy.lastVisitedDate === null || isVisitDate(props.legacy.lastVisitedDate));
  const described = error ? errorId : undefined;
  return <section aria-label="Weekend visit history">
    <h2>Visits to {places.get(props.placeId) ?? displayId(props.placeId)}</h2>
    {host.problem && <p role="alert">{host.problem}</p>}
    {!catalog && <p role="alert">The supplied places or participants are invalid.</p>}
    <p>Known dated visits: {history?.count ?? 'Unavailable'}</p>
    <p>Latest known dated visit: {history?.latestDate ?? 'Not recorded'}</p>
    {props.legacy && <aside aria-label="Legacy aggregate summary">
      {legacyValid ? <><p>Legacy aggregate count: {props.legacy.visitCount}</p>
        <p>Legacy latest date: {props.legacy.lastVisitedDate ?? 'Not recorded'}</p>
        <p>Legacy and dated records may overlap; these counts are separate.</p></>
        : <p>Legacy summary unavailable.</p>}
    </aside>}
    <form onSubmit={submit} noValidate aria-label="Record a visit">
      <h3>Record a visit</h3>
      {targetMismatch && <p>{locked ? 'Pending visit' : 'Draft'} for {places.get(target) ?? displayId(target)}. {locked
        ? 'Resolve this visit before starting another place.' : 'Return to that place or Cancel to start for the selected place.'}</p>}
      <label htmlFor={dateId}>Visit date</label>
      <input ref={dateRef} id={dateId} type="date" required min="0001-01-01" max="9999-12-31"
        value={draft.visitedOn} disabled={locked} aria-describedby={described}
        onChange={(event) => changed({ visitedOn: event.target.value })} />
      <fieldset ref={participantsRef} disabled={locked} tabIndex={-1} aria-describedby={described}>
        <legend>Participants</legend>
        {catalog?.participants.map((person) => <label key={person.id}>
          <input type="checkbox" checked={draft.attendeeIds.includes(person.id)} onChange={(event) => changed({
            attendeeIds: event.target.checked ? [...draft.attendeeIds, person.id] : draft.attendeeIds.filter((item) => item !== person.id),
          })} />{person.label}
        </label>)}
        {draft.attendeeIds.filter((person) => !people.has(person)).map((person) => <p key={person}>Selected earlier: {person}</p>)}
      </fieldset>
      <label htmlFor={`${ids}-rating`}>Visit rating</label>
      <select ref={ratingRef} id={`${ids}-rating`} value={draft.rating} disabled={locked} aria-describedby={described}
        onChange={(event) => changed({ rating: event.target.value })}>
        <option value="">Not rated</option>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}
      </select>
      <label htmlFor={`${ids}-notes`}>Visit notes</label>
      <textarea ref={notesRef} id={`${ids}-notes`} value={draft.notes} maxLength={VISIT_LIMITS.notes} disabled={locked}
        aria-describedby={described} onChange={(event) => changed({ notes: event.target.value })} />
      {error && <p id={errorId} ref={errorRef} role="alert" tabIndex={-1}>{error.message}</p>}
      <p role="status">{attempt?.phase === 'saving' ? 'Saving request in progress.' : attempt?.phase === 'awaiting'
        ? 'Awaiting host confirmation. Your draft is retained.' : notice}</p>
      <button type="submit" disabled={unavailable || (locked && attempt?.phase !== 'uncertain') || (!locked && targetMismatch)}>
        {attempt?.phase === 'uncertain' ? 'Retry save' : 'Record visit'}
      </button>
      <button type="button" onClick={cancel} disabled={locked}>Cancel</button>
    </form>
    <h3>Dated history</h3>
    {!history?.count ? <p>No dated visits recorded.</p> : <>
      <ol aria-label="Dated visits">{history.entries.map((visit) => <li key={visit.id}>
        <time dateTime={visit.visitedOn}>{visit.visitedOn}</time>
        <p>Participants: {visit.attendeeIds.length ? visit.attendeeIds.map((person) => people.get(person) ?? person).join(', ') : 'No participants recorded'}</p>
        <p>Rating: {visit.rating ?? 'Not rated'}</p><p>{visit.notes}</p>
      </li>)}</ol>
      <nav aria-label="History pages">
        <button type="button" disabled={history.page <= 1} onClick={() => setPage(history.page - 1)}>Previous visits</button>
        <span>Page {history.page} of {history.pages}</span>
        <button type="button" disabled={history.page >= history.pages} onClick={() => setPage(history.page + 1)}>Next visits</button>
      </nav>
    </>}
  </section>;
}
