import {
  appendVisit, isVisitDate, sameVisitContent, selectVisitHistory, validateVisitCatalog,
  validateVisitDraft, validateVisitJournal, VISIT_LIMITS,
  type Visit, type VisitJournal,
} from '../../lib/burn4-weekend-visit-history';

const catalog = { places: [{ id: 'a', label: 'Park' }, { id: 'b', label: 'Park' }], participants: [{ id: 'p', label: 'Alex' }, { id: 'q', label: 'Alex' }] };
const empty: VisitJournal = { revision: 0, entries: [] };
function visit(changes: Partial<Visit> = {}): Visit {
  return { id: 'v', placeId: 'a', visitedOn: '2024-02-29', attendeeIds: ['p'], rating: null, notes: '', ...changes };
}
function validJournal(value: unknown): VisitJournal {
  const result = validateVisitJournal(value);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

describe('strict civil dates', () => {
  test.each(['0001-01-01', '0099-12-31', '2000-02-29', '2024-02-29', '2400-02-29', '9999-12-31'])('accepts %s without a timezone', (date) => {
    expect(isVisitDate(date)).toBe(true);
  });
  test.each(['0000-01-01', '1900-02-29', '2100-02-29', '2023-02-29', '2026-04-31', '2026-02-30', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-1-01', ' 2026-01-01', '2026-01-01T00:00:00Z', '+2026-01-01', '10000-01-01'])('rejects %s', (date) => {
    expect(isVisitDate(date)).toBe(false);
  });
});

test('append records explicit fields immutably and increases revision once', () => {
  const frozen = Object.freeze({ revision: 4, entries: Object.freeze([Object.freeze(visit({ id: 'old', placeId: 'b' }))]) });
  const before = JSON.stringify(frozen);
  const result = appendVisit(frozen, visit({ notes: '  exact text  ', rating: 5, attendeeIds: ['q', 'p', 'q'] }), catalog);
  expect(result.status).toBe('added');
  if (result.status !== 'added') throw new Error('append failed');
  expect(result.journal.revision).toBe(5);
  expect(result.visit.attendeeIds).toEqual(['p', 'q']);
  expect(result.visit.notes).toBe('  exact text  ');
  expect(result.journal.entries[0]).toEqual(frozen.entries[0]);
  expect(JSON.stringify(frozen)).toBe(before);
  expect(Object.isFrozen(result.journal)).toBe(true);
  expect(Object.isFrozen(result.visit.attendeeIds)).toBe(true);
});

test('exact replay remains unchanged with removed historic participant and place catalogs', () => {
  const journal = validJournal({ revision: 7, entries: [visit({ attendeeIds: ['removed', 'p'] })] });
  const result = appendVisit(journal, visit({ attendeeIds: ['p', 'removed', 'p'] }), { places: [], participants: [] });
  expect(result.status).toBe('replayed');
  expect(result.journal).toEqual(journal);
  expect(result.journal?.revision).toBe(7);
});

test.each([
  { placeId: 'b' }, { visitedOn: '2024-03-01' }, { attendeeIds: ['q'] }, { rating: 1 }, { notes: 'changed' },
])('global identity conflicts on changed semantic field %j', (change) => {
  const journal = { revision: 7, entries: [visit()] };
  const result = appendVisit(journal, visit(change), catalog);
  expect(result.status).toBe('conflict');
  expect(result.journal).toEqual(journal);
});

test('different explicit IDs for identical visits remain distinct intentional entries', () => {
  const result = appendVisit({ revision: 1, entries: [visit()] }, visit({ id: 'other' }), catalog);
  expect(result.status).toBe('added');
  expect(result.journal?.entries).toHaveLength(2);
});

test('equal duplicate global IDs in an existing snapshot are invalid', () => {
  const result = appendVisit({ revision: 1, entries: [visit(), visit()] }, visit({ id: 'next' }), catalog);
  expect(result.status).toBe('invalid');
  expect(result.journal).toBeNull();
  expect(result.issues[0]?.code).toBe('duplicate-id');
});

test.each([{ placeId: 'missing' }, { attendeeIds: ['missing'] }, { rating: 0 }, { rating: 2.5 }, { rating: Number.NaN }, { visitedOn: '2023-02-29' }])('invalid candidate preserves validated journal %j', (changes) => {
  const result = appendVisit(empty, visit(changes), catalog);
  expect(result.status).toBe('invalid');
  expect(result.journal).toEqual(empty);
});

test('draft validation occurs without inventing an identity; optional fields normalize explicitly', () => {
  const result = validateVisitDraft({ placeId: 'a', visitedOn: '0001-01-01' }, catalog);
  expect(result).toEqual({ ok: true, value: { placeId: 'a', visitedOn: '0001-01-01', attendeeIds: [], rating: null, notes: '' } });
});

test('catalog labels are bounded presentation data with ID fallback for blank or missing labels', () => {
  const result = validateVisitCatalog({ places: [{ id: 'a', label: ' ' }], participants: [{ id: 'p', label: '' }, { id: 'q' }] });
  expect(result).toEqual({ ok: true, value: { places: [{ id: 'a', label: 'a' }], participants: [{ id: 'p', label: 'p' }, { id: 'q', label: 'q' }] } });
});

test('duplicate catalog identities and oversized catalogs are rejected', () => {
  expect(validateVisitCatalog({ ...catalog, participants: [{ id: 'p' }, { id: 'p' }] }).ok).toBe(false);
  expect(validateVisitCatalog({ ...catalog, participants: Array.from({ length: 257 }, (_, index) => ({ id: `p${index}` })) }).ok).toBe(false);
  expect(validateVisitCatalog({ ...catalog, places: [{ id: 'a', label: 'x'.repeat(257) }] }).ok).toBe(false);
});

test('known facts are place-isolated, arrival-order independent, and paged to twenty rows', () => {
  const entries = Array.from({ length: 21 }, (_, index) => visit({ id: `a${String(index).padStart(2, '0')}`, visitedOn: '2024-02-29' }));
  const journal = validJournal({ revision: 1, entries: [visit({ id: 'newer-b', placeId: 'b', visitedOn: '2025-01-01' }), ...entries.reverse()] });
  const first = selectVisitHistory(journal, 'a');
  expect(first.count).toBe(21);
  expect(first.latestDate).toBe('2024-02-29');
  expect(first.entries).toHaveLength(20);
  expect(first.entries[0]?.id).toBe('a00');
  expect(selectVisitHistory(journal, 'a', 2).entries.map((row) => row.id)).toEqual(['a20']);
  expect(selectVisitHistory(journal, 'a', 999).page).toBe(2);
  expect(selectVisitHistory(journal, 'a', Number.NaN).page).toBe(1);
  expect(selectVisitHistory(journal, 'unknown').latestDate).toBeNull();
  expect(selectVisitHistory(journal, 'b').count).toBe(1);
});

test('backfilling an older date does not move latest known date backwards', () => {
  const result = appendVisit({ revision: 1, entries: [visit({ id: 'new', visitedOn: '2025-01-01' })] }, visit(), catalog);
  expect(result.journal && selectVisitHistory(result.journal, 'a').latestDate).toBe('2025-01-01');
});

test('same-content comparison treats attendees as a set but preserves notes whitespace', () => {
  expect(sameVisitContent(visit({ attendeeIds: ['q', 'p', 'q'] }), visit({ attendeeIds: ['p', 'q'] }))).toBe(true);
  expect(sameVisitContent(visit({ notes: ' note' }), visit({ notes: 'note' }))).toBe(false);
});

test('two requests from one revision both survive host reapplication against latest state', () => {
  const first = appendVisit(empty, visit({ id: 'first' }), catalog);
  const secondPreview = appendVisit(empty, visit({ id: 'second', placeId: 'b' }), catalog);
  expect(first.status).toBe('added');
  expect(secondPreview.status).toBe('added');
  const committed = appendVisit(first.journal, visit({ id: 'second', placeId: 'b' }), catalog);
  expect(committed.journal?.revision).toBe(2);
  expect(committed.journal?.entries.map((row) => row.id)).toEqual(['first', 'second']);
});

test('revision exhaustion rejects an append while exact replay remains valid', () => {
  const journal = { revision: Number.MAX_SAFE_INTEGER, entries: [visit()] };
  expect(appendVisit(journal, visit({ id: 'new' }), catalog).status).toBe('invalid');
  expect(appendVisit(journal, visit(), catalog).status).toBe('replayed');
});

test.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'])('invalid revision %s never returns a typed valid snapshot', (value) => {
  expect(validateVisitJournal({ revision: value, entries: [] }).ok).toBe(false);
});

test('per-field entry and resource limits reject without truncation', () => {
  expect(appendVisit(empty, visit({ id: 'x'.repeat(257) }), catalog).status).toBe('invalid');
  expect(validateVisitDraft({ ...visit(), notes: 'x'.repeat(4_001) }, catalog).ok).toBe(false);
  expect(validateVisitJournal({ revision: 0, entries: Array(10_001).fill(visit()) }).ok).toBe(false);
  expect(validateVisitJournal({ revision: 0, entries: [visit({ attendeeIds: Array(33).fill('p') })] }).ok).toBe(false);
});

test('aggregate text budget rejects a modest number of individually valid notes', () => {
  const entries = Array.from({ length: 250 }, (_, index) => visit({ id: `v${index}`, notes: 'n'.repeat(3_900), attendeeIds: [] }));
  expect(validateVisitJournal({ revision: 1, entries }).ok).toBe(true);
  entries.push(...Array.from({ length: 10 }, (_, index) => visit({ id: `more${index}`, notes: 'n'.repeat(3_900), attendeeIds: [] })));
  const result = validateVisitJournal({ revision: 1, entries });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0]?.code).toBe('text-budget');
});

test('aggregate attendee references are bounded before duplicate canonicalization', () => {
  const entries = Array.from({ length: 312 }, (_, index) => visit({ id: `v${index}`, attendeeIds: Array(32).fill('p') }));
  expect(validateVisitJournal({ revision: 1, entries }).ok).toBe(true);
  entries.push(visit({ id: 'overflow', attendeeIds: Array(32).fill('p') }));
  const result = validateVisitJournal({ revision: 1, entries });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0]?.code).toBe('attendee-budget');
});

test('capacity permits exact replay but not a new entry', () => {
  const entries = Array.from({ length: VISIT_LIMITS.entries }, (_, index) => visit({ id: `v${index}`, attendeeIds: [] }));
  const journal = { revision: 1, entries };
  expect(appendVisit(journal, visit({ id: 'v0', attendeeIds: [] }), catalog).status).toBe('replayed');
  expect(appendVisit(journal, visit({ id: 'overflow' }), catalog).status).toBe('invalid');
});

test('raw array iterators cannot inject attendees, rows or catalog choices', () => {
  const attendees = ['p'];
  attendees[Symbol.iterator] = function* () { for (let i = 0; i < 33; i += 1) yield 'injected'; return undefined; };
  const entries = [visit({ attendeeIds: attendees })];
  entries[Symbol.iterator] = function* () { yield visit({ id: 'injected' }); return undefined; };
  const result = validateVisitJournal({ revision: 1, entries });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.entries[0]).toEqual(visit());
  const places = [{ id: 'a' }];
  places[Symbol.iterator] = function* () { yield { id: 'injected' }; return undefined; };
  expect(validateVisitCatalog({ places, participants: [] })).toEqual({ ok: true, value: { places: [{ id: 'a', label: 'a' }], participants: [] } });
  expect(sameVisitContent(visit({ attendeeIds: attendees }), visit())).toBe(true);
  expect(selectVisitHistory({ revision: 1, entries }, 'a').count).toBe(1);
});

test('public projections do not turn invalid snapshots or oversized sets into valid facts', () => {
  expect(() => selectVisitHistory({ revision: -1, entries: [] }, 'a')).toThrow('valid journal');
  expect(sameVisitContent(visit({ attendeeIds: Array(33).fill('p') }), visit())).toBe(false);
});

test('validated primitive getter values are captured once and unreadable input is controlled', () => {
  let revisions = 0;
  let ids = 0;
  const candidate = { ...visit(), get id() { ids += 1; return ids === 1 ? 'captured' : ''; } };
  const journal = { get revision() { revisions += 1; return revisions === 1 ? 1 : Number.NaN; }, entries: [] };
  const result = appendVisit(journal, candidate, catalog);
  expect(result.status).toBe('added');
  expect(result.journal?.revision).toBe(2);
  expect(result.journal?.entries[0]?.id).toBe('captured');
  expect(revisions).toBe(1);
  expect(ids).toBe(1);
  const throwing = Object.defineProperty({}, 'revision', { get() { throw new Error('private value'); } });
  const bad = validateVisitJournal(throwing);
  expect(bad).toEqual({ ok: false, issues: [{ code: 'input-unreadable', path: 'journal' }] });
});
