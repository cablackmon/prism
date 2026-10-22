# Weekend visit journal

This standalone feature implements the written per-visit history backlog at `docs/features/WEEKEND.md:121-125`: dated entries with attendees, rating and notes. Existing `WeekendView` updates only aggregate place metadata, as described at lines 73-81. Existing visit types/table remain unchanged. The new component is usable by a React host; no existing Prism app module is imported or activated.

## Model API

`src/lib/burn4-weekend-visit-history.ts` exports readonly `VisitDraft`, `Visit`, `VisitJournal`, `VisitCatalog`, validation and append result types, and these functions:

- `isVisitDate(unknown)` recognizes exact Gregorian civil dates, years 0001-9999. It rejects impossible dates, abbreviated fields, whitespace, timestamps, offsets and year 0000. No Date parser, clock or timezone is used.
- `validateVisitJournal(unknown)` returns `{ok:true,value}` with a canonical owned journal, or `{ok:false,issues}`. An invalid snapshot is never returned as a typed valid journal. Current roster membership is not required for historical rows.
- `validateVisitCatalog(unknown)` validates bounded explicit places and participant choices. Options contain ID and optional label; blank/missing labels fall back to the ID. Duplicate IDs are invalid within each option group. Equal labels do not merge people.
- `validateVisitDraft(unknown,catalog)` validates a new draft before allocating an identity. Empty participants explicitly mean none recorded. Omitted rating becomes null, omitted notes become an empty string, and omitted attendees become an empty list. Null notes are invalid. Notes retain exact whitespace. A new candidate's place and attendee IDs must occur in the supplied catalogs.
- `sameVisitContent(left,right)` compares place/date, attendee set, nullable rating and exact notes. Labels and row order are irrelevant. Attendee inspection is bounded and indexed, including custom-iterator inputs.
- `appendVisit(journal,candidate,catalog)` returns `added`, `replayed`, `conflict` or `invalid`. It validates the whole existing journal, then the candidate's structural fields. An existing exact ID/content replay succeeds before checking the current catalog, capacity or revision increment. Removed people/places cannot invalidate an exact historical replay. A genuinely new entry must pass the current catalog and aggregate limits.
- `selectVisitHistory(journal,placeId,page)` validates before projecting known facts, returns known dated count/latest date and at most 20 rows for a clamped page. Invalid snapshots produce a static TypeError, not invented valid facts. Ordering is date descending, then exact ID ascending; no locale or arrival-order dependence.

Visit identity is global across the whole journal. Same ID plus changed place, date, attendees, rating or notes conflicts without replacing the original. Two distinct host IDs can intentionally represent identical visits. Any duplicate existing global ID is invalid, even for identical rows. Added rows increase the explicit safe-integer revision once. Replay leaves revision/content unchanged; validation returns normalized owned copies, so object-reference identity is not promised. Exhausted revision prevents a new append while replay still works.

The semantic model is append-only. It never mutates or freezes caller input. Canonical owned outputs and attendee arrays are frozen. Conflicting or invalid candidates retain a validated current journal; an invalid original snapshot returns `journal:null`.

## Limits

`VISIT_LIMITS` documents local API limits: 10,000 entries, 256 code units per ID, 32 attendee references per visit, 4,000 notes units, 10,000 total attendee references, and 1,000,000 aggregate journal text units. Aggregate text includes visit/place/attendee IDs, civil dates and notes. Raw references count toward inspection budgets before deduplication. Catalogs allow 1,000 places and 256 participants, with labels at most 256 units.

Validation checks source counts and budgets before bulk attendee cloning, uses bounded indexed source traversal rather than caller iterators, captures validated scalar values once, and rechecks actual copied budgets. Public projections do not iterate unbounded caller sets. These bounds are implementation policy, not an existing app configuration. Tests use modest boundary fixtures, not a large-memory stress process.

## React API and host responsibilities

`WeekendVisitHistory` in `src/components/weekend/burn4-visit-history.tsx` accepts:

```ts
type Props = {
  journal: unknown;
  catalog: unknown;
  placeId: string;
  initialDate?: string;
  legacy?: { visitCount: number; lastVisitedDate: string | null };
  createVisitId: () => string;
  onChange: (request: {
    visit: Visit;
    expectedRevision: number;
    nextJournal: VisitJournal;
  }) => { status: 'accepted' | 'rejected' }
    | Promise<{ status: 'accepted' | 'rejected' }>;
};
```

`initialDate` is an explicit optional valid civil date, otherwise the form starts empty. There is no default today. The component renders a native labeled form with participant choices, an explicit Not rated option, notes, record/cancel controls, focused accessible errors/status, and a semantic dated history list with 20-row paging. React renders notes/labels as text. Historical people absent from current choices retain their IDs and display an ID fallback. There is no edit/delete ledger.

The host owns committed snapshots and the only ID factory. IDs are opaque implementation data, not user-entered form fields. Validation precedes factory allocation. One candidate is captured/frozen with its original place; a synchronous guard prevents duplicate submissions and reentrant factory calls. Throws, invalid IDs, and conflicts preserve the draft without guessing another ID.

`nextJournal` is a prospective append to the observed revision, not permission to overwrite newer host data. The host must compare `expectedRevision` before replacing a snapshot or reapply the candidate against its latest journal. For example, a functional host state update can append into the newest local state:

```tsx
const onChange = (request: VisitCommitRequest) => {
  setJournal((latest) => {
    const result = appendVisit(latest, request.visit, catalog);
    return result.journal ?? latest;
  });
  return { status: 'accepted' } as const;
};
```

The host must expose conflicts/refusal appropriately in its own integration. The component does not prove storage, atomicity, authorization or distributed exactly-once behavior. Two stale previews must not replace each other and lose unrelated rows.

## Commit, retry and draft lifecycle

- A fulfilled callback or `accepted` result alone never clears the draft. The component waits for a valid controlled journal containing exactly the candidate ID and full canonical content. Exact already-present replay can acknowledge at the same revision without another callback.
- While saving/awaiting confirmation, fields, duplicate recording and Cancel are disabled. The entered values remain visible. No optimistic history row is invented.
- Thrown/rejected callbacks or malformed response accessors are uncertain failures. Fields/candidate stay retained; explicit Retry save reuses the same ID/content against the latest controlled snapshot. There is no automatic retry, timeout, new-ID fallback or abort guarantee.
- `rejected` is a definitive host statement that this attempt did not commit and cannot later commit. It unlocks the preserved draft. An unchanged retry retains its ID; editing retires that candidate and a new submit asks the factory once again.
- Matching committed content takes precedence over stale callback failure. Old attempt tokens and unmounted callbacks cannot clear a later draft or publish an obsolete error. Same-ID/different-content props show conflict and retain the draft; they never acknowledge success.
- An unrelated newer host snapshot preserves draft and pending identity. Lower revisions, invalid journals and same-revision changed content show a host-contract error and cannot acknowledge. The last validated accepted history remains displayed until valid input returns.
- Selection changes never retarget a draft. A pending visit remains visibly attached to its original place; no second visit or cancellation starts while unresolved. An uncertain retry keeps that original place. If it is no longer available, the model reports conflict/validation failure rather than moving it. In an ordinary editable state, explicit Cancel clears only draft and starts it for the selected place.
- Unmount invalidates local attempts; it cannot cancel a host commit already started. Host-owned draft persistence across remounts is outside scope. An accepted request with no later controlled commit intentionally remains awaiting confirmation.

Known dated count/latest date and optional legacy aggregate count/latest date are separately labeled. They are never summed, subtracted, used to synthesize old rows, or merged into an asserted history total. Backfilled rows may already be included in the aggregate. A place's legacy rating is never copied to new visit ratings.

## Focused verification

Both new runtime files and both owned tests are included in strict no-extends TS config. Own Jest/jsdom config loads no application setup or root configuration. Tests use synthetic controlled hosts, manually settled promises and small fixtures; they import no current app source, database, service, network, environment data, browser runner or previous offline CLI.

```text
timeout 60 node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r8-c01/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r8-c01/burn4-visit-history.test.ts src/__tests__/burn4-tg3r8-c01/burn4-visit-history-ui.test.tsx --no-cache
timeout 60 node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r8-c01/burn4-tsconfig.json --noEmit --incremental false
timeout 60 node node_modules/eslint/bin/eslint.js --no-config-lookup --no-ignore --config src/__tests__/burn4-tg3r8-c01/burn4-eslint.config.mjs --max-warnings 0 src/lib/burn4-weekend-visit-history.ts src/components/weekend/burn4-visit-history.tsx src/__tests__/burn4-tg3r8-c01/burn4-visit-history.test.ts src/__tests__/burn4-tg3r8-c01/burn4-visit-history-ui.test.tsx src/__tests__/burn4-tg3r8-c01/burn4-jest.config.cjs src/__tests__/burn4-tg3r8-c01/burn4-eslint.config.mjs
```

KNOWN GAP: none asserted in unchanged sources. Limits: no current Prism wiring, database/API migration, durable persistence, authentication, geocoding, sharing, host cancellation, cross-instance request coordination or real-browser compatibility verification. Future adoption is outside this package; needs decision is empty.
