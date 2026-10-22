/** Standalone visit journal. Caller data, identities and civil dates are explicit. */
export type VisitDraft = Readonly<{
  placeId: string; visitedOn: string; attendeeIds: readonly string[];
  rating: number | null; notes: string;
}>;
export type Visit = VisitDraft & Readonly<{ id: string }>;
export type VisitJournal = Readonly<{ revision: number; entries: readonly Visit[] }>;
export type VisitOption = Readonly<{ id: string; label: string }>;
export type VisitCatalog = Readonly<{ places: readonly VisitOption[]; participants: readonly VisitOption[] }>;
export type VisitIssue = Readonly<{ code: string; path: string }>;
export type VisitValidation<T> = { ok: true; value: T } | { ok: false; issues: readonly VisitIssue[] };
export type VisitAppendResult =
  | { status: 'added' | 'replayed'; journal: VisitJournal; visit: Visit; issues: readonly VisitIssue[] }
  | { status: 'conflict' | 'invalid'; journal: VisitJournal | null; issues: readonly VisitIssue[] };

export const VISIT_LIMITS = Object.freeze({
  entries: 10_000, id: 256, attendeesPerVisit: 32, notes: 4_000,
  attendeeReferences: 10_000, textUnits: 1_000_000,
  participants: 256, places: 1_000, label: 256, pageSize: 20,
});

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= VISIT_LIMITS.id && value.trim().length > 0;
}
function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function invalid<T>(code: string, path: string): VisitValidation<T> {
  return { ok: false, issues: [{ code, path }] };
}
function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

/** Exact Gregorian civil dates, including early years, with no clock/timezone. */
export function isVisitDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

type Inspected = { draft: Omit<VisitDraft, 'attendeeIds'>; attendees: unknown[]; text: number; refs: number };
function inspectDraft(value: unknown, path: string): VisitValidation<Inspected> {
  if (!object(value)) return invalid('visit-invalid', path);
  const { placeId, visitedOn } = value;
  const rawRating = value.rating;
  const rawNotes = value.notes;
  const rawAttendees = value.attendeeIds;
  const rating = rawRating === undefined ? null : rawRating;
  const notes = rawNotes === undefined ? '' : rawNotes;
  const attendees: unknown = rawAttendees === undefined ? [] : rawAttendees;
  if (!id(placeId)) return invalid('id-invalid', `${path}.placeId`);
  if (!isVisitDate(visitedOn)) return invalid('date-invalid', `${path}.visitedOn`);
  if (!(rating === null || (typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5))) {
    return invalid('rating-invalid', `${path}.rating`);
  }
  if (typeof notes !== 'string' || notes.length > VISIT_LIMITS.notes) return invalid('notes-invalid', `${path}.notes`);
  if (!Array.isArray(attendees)) {
    return invalid('attendees-limit', `${path}.attendeeIds`);
  }
  const length = attendees.length;
  if (!revision(length) || length > VISIT_LIMITS.attendeesPerVisit) return invalid('attendees-limit', `${path}.attendeeIds`);
  let text = placeId.length + visitedOn.length + notes.length;
  for (let index = 0; index < length; index += 1) {
    const attendee: unknown = attendees[index];
    if (!id(attendee)) return invalid('id-invalid', `${path}.attendeeIds`);
    text += attendee.length;
  }
  return { ok: true, value: { draft: { placeId, visitedOn, rating, notes }, attendees, text, refs: length } };
}
function canonicalDraft(inspected: Inspected): VisitValidation<VisitDraft> {
  // Recheck the retained array before copying; caller accessors cannot yield an
  // invalid typed result or expand past the budget between inspection and copy.
  const attendees: string[] = [];
  for (let index = 0; index < inspected.refs; index += 1) {
    const value = inspected.attendees[index];
    if (!id(value)) return invalid('id-invalid', 'attendeeIds');
    attendees.push(value);
  }
  return { ok: true, value: Object.freeze({ ...inspected.draft, attendeeIds: Object.freeze([...new Set(attendees)].sort(compare)) }) };
}

/** Validate all rows and aggregate budgets before cloning attendee arrays. */
export function validateVisitJournal(input: unknown): VisitValidation<VisitJournal> {
  try {
    if (!object(input)) return invalid('journal-invalid', 'journal');
    const inputRevision = input.revision;
    const rawEntries: unknown = input.entries;
    if (!revision(inputRevision) || !Array.isArray(rawEntries)) return invalid('journal-invalid', 'journal');
    const length = rawEntries.length;
    if (!revision(length) || length > VISIT_LIMITS.entries) return invalid('entries-limit', 'journal.entries');
    const inspected: { id: string; value: Inspected }[] = [];
    const ids = new Set<string>();
    let text = 0;
    let refs = 0;
    for (let index = 0; index < length; index += 1) {
      const row: unknown = rawEntries[index];
      if (!object(row)) return invalid('id-invalid', 'journal.entries');
      const rowId = row.id;
      if (!id(rowId)) return invalid('id-invalid', 'journal.entries');
      if (ids.has(rowId)) return invalid('duplicate-id', 'journal.entries');
      ids.add(rowId);
      const result = inspectDraft(row, 'journal.entries');
      if (!result.ok) return result;
      text += rowId.length + result.value.text;
      refs += result.value.refs;
      if (text > VISIT_LIMITS.textUnits) return invalid('text-budget', 'journal.entries');
      if (refs > VISIT_LIMITS.attendeeReferences) return invalid('attendee-budget', 'journal.entries');
      inspected.push({ id: rowId, value: result.value });
    }
    const entries: Visit[] = [];
    let actualText = 0;
    let actualRefs = 0;
    for (const row of inspected) {
      const result = canonicalDraft(row.value);
      if (!result.ok) return result;
      actualText += row.id.length + result.value.placeId.length + result.value.visitedOn.length + result.value.notes.length +
        result.value.attendeeIds.reduce((sum, item) => sum + item.length, 0);
      actualRefs += result.value.attendeeIds.length;
      if (actualText > VISIT_LIMITS.textUnits || actualRefs > VISIT_LIMITS.attendeeReferences) {
        return invalid('aggregate-budget', 'journal.entries');
      }
      entries.push(Object.freeze({ id: row.id, ...result.value }));
    }
    return { ok: true, value: Object.freeze({ revision: inputRevision, entries: Object.freeze(entries) }) };
  } catch { return invalid('input-unreadable', 'journal'); }
}

/** Explicit bounded catalogs; labels are presentation, never identity. */
export function validateVisitCatalog(input: unknown): VisitValidation<VisitCatalog> {
  try {
    if (!object(input)) return invalid('catalog-invalid', 'catalog');
    const groups: VisitOption[][] = [];
    for (const [key, limit] of [['places', VISIT_LIMITS.places], ['participants', VISIT_LIMITS.participants]] as const) {
      const values: unknown = input[key];
      if (!Array.isArray(values)) return invalid('catalog-limit', key);
      const length = values.length;
      if (!revision(length) || length > limit) return invalid('catalog-limit', key);
      const options: VisitOption[] = [];
      const ids = new Set<string>();
      for (let index = 0; index < length; index += 1) {
        const item: unknown = values[index];
        if (!object(item)) return invalid('catalog-id-invalid', key);
        const optionId = item.id;
        const rawLabel = item.label;
        if (!id(optionId) || ids.has(optionId)) return invalid('catalog-id-invalid', key);
        const label = rawLabel === undefined || (typeof rawLabel === 'string' && rawLabel.trim() === '') ? optionId : rawLabel;
        if (typeof label !== 'string' || label.length > VISIT_LIMITS.label) return invalid('label-invalid', key);
        ids.add(optionId);
        options.push(Object.freeze({ id: optionId, label }));
      }
      groups.push(options);
    }
    return { ok: true, value: Object.freeze({ places: Object.freeze(groups[0] ?? []), participants: Object.freeze(groups[1] ?? []) }) };
  } catch { return invalid('input-unreadable', 'catalog'); }
}

/** Validate a new form draft before allocating any host identity. */
export function validateVisitDraft(input: unknown, catalogInput: unknown): VisitValidation<VisitDraft> {
  try {
    const inspected = inspectDraft(input, 'draft');
    if (!inspected.ok) return inspected;
    const draft = canonicalDraft(inspected.value);
    if (!draft.ok) return draft;
    const catalog = validateVisitCatalog(catalogInput);
    if (!catalog.ok) return catalog;
    if (!catalog.value.places.some((place) => place.id === draft.value.placeId)) return invalid('place-unknown', 'draft.placeId');
    const people = new Set(catalog.value.participants.map((person) => person.id));
    if (draft.value.attendeeIds.some((attendee) => !people.has(attendee))) return invalid('attendee-unknown', 'draft.attendeeIds');
    return draft;
  } catch { return invalid('input-unreadable', 'draft'); }
}

/** Full semantic equality; attendee selection is a set and labels are ignored. */
export function sameVisitContent(left: VisitDraft, right: VisitDraft): boolean {
  try {
    const people = (values: readonly string[]): string[] | null => {
      if (!Array.isArray(values)) return null;
      const length = values.length;
      if (!revision(length) || length > VISIT_LIMITS.attendeesPerVisit) return null;
      const safe: string[] = [];
      for (let index = 0; index < length; index += 1) {
        const value: unknown = values[index];
        if (!id(value)) return null;
        safe.push(value);
      }
      return [...new Set(safe)].sort(compare);
    };
    const leftPeople = people(left.attendeeIds);
    const rightPeople = people(right.attendeeIds);
    return leftPeople !== null && rightPeople !== null && left.placeId === right.placeId &&
      left.visitedOn === right.visitedOn && left.rating === right.rating && left.notes === right.notes &&
      JSON.stringify(leftPeople) === JSON.stringify(rightPeople);
  } catch { return false; }
}

/** Replay/conflict precede current catalog membership, preserving historic IDs. */
export function appendVisit(journalInput: unknown, candidateInput: unknown, catalogInput: unknown): VisitAppendResult {
  const validated = validateVisitJournal(journalInput);
  if (!validated.ok) return { status: 'invalid', journal: null, issues: validated.issues };
  const journal = validated.value;
  try {
    if (!object(candidateInput)) {
      return { status: 'invalid', journal, issues: [{ code: 'id-invalid', path: 'visit.id' }] };
    }
    const candidateId = candidateInput.id;
    if (!id(candidateId)) return { status: 'invalid', journal, issues: [{ code: 'id-invalid', path: 'visit.id' }] };
    const inspected = inspectDraft(candidateInput, 'visit');
    if (!inspected.ok) return { status: 'invalid', journal, issues: inspected.issues };
    const draft = canonicalDraft(inspected.value);
    if (!draft.ok) return { status: 'invalid', journal, issues: draft.issues };
    const visit: Visit = Object.freeze({ id: candidateId, ...draft.value });
    const existing = journal.entries.find((row) => row.id === visit.id);
    if (existing) {
      return sameVisitContent(existing, visit)
        ? { status: 'replayed', journal, visit: existing, issues: [] }
        : { status: 'conflict', journal, issues: [{ code: 'identity-conflict', path: 'visit.id' }] };
    }
    const newDraft = validateVisitDraft(draft.value, catalogInput);
    if (!newDraft.ok) return { status: 'invalid', journal, issues: newDraft.issues };
    if (journal.revision === Number.MAX_SAFE_INTEGER) return { status: 'invalid', journal, issues: [{ code: 'revision-exhausted', path: 'journal.revision' }] };
    const next = validateVisitJournal({ revision: journal.revision + 1, entries: [...journal.entries, visit] });
    return next.ok
      ? { status: 'added', journal: next.value, visit, issues: [] }
      : { status: 'invalid', journal, issues: next.issues };
  } catch { return { status: 'invalid', journal, issues: [{ code: 'input-unreadable', path: 'visit' }] }; }
}

/** Select known dated facts only; no legacy count enters this projection. */
export function selectVisitHistory(journal: VisitJournal, placeId: string, page = 1) {
  const validated = validateVisitJournal(journal);
  if (!validated.ok) throw new TypeError('History selection requires a valid journal');
  const rows = validated.value.entries.filter((visit) => visit.placeId === placeId)
    .sort((a, b) => compare(b.visitedOn, a.visitedOn) || compare(a.id, b.id));
  const pages = Math.max(1, Math.ceil(rows.length / VISIT_LIMITS.pageSize));
  const currentPage = Number.isSafeInteger(page) ? Math.max(1, Math.min(page, pages)) : 1;
  return Object.freeze({
    count: rows.length, latestDate: rows[0]?.visitedOn ?? null, page: currentPage, pages,
    entries: Object.freeze(rows.slice((currentPage - 1) * VISIT_LIMITS.pageSize, currentPage * VISIT_LIMITS.pageSize)),
  });
}
