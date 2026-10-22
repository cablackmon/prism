# All-day calendar recurrence tool

Open `/calendar/recurrence` to enter an all-day event, preview its first dates and
download a portable `.ics` file. It is a real local form and file generator. It
makes no application-data request and does not save an event in Prism.

The written basis is `docs/planning.md:18,34` (the intentionally deprioritized
RRULE builder), `docs/features/CALENDAR.md:247-257` (event and recurrence fields)
and `docs/decisions-log.md:36` (missing local-event recurrence). The director chose
this narrow portable feature; it does not complete the integrated roadmap item.

The interoperability reference is [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html),
especially sections 3.1 and 3.3.10. This package supports only the declared subset
and makes no general standards or browser-import certification claim.

## Supported data

`validateEvent(unknown)` returns a frozen canonical event and stable key, or
associated validation errors. `previewEvent(unknown)` returns frozen first-date
records and an explicit stop reason. `validateCalendarIdentity(unknown)` validates
and freezes public identity inputs. `serializeCalendar(event, identity)` returns
one deterministic calendar string. The model imports only installed `ical.js`.

Event fields are title, optional description, startDate, durationDays, frequency,
interval, ending and weekly-only weekdays. Unknown fields are rejected. Dates
are strict Gregorian `YYYY-MM-DD` from 1900 through 9999. Initial exclusive end
must fit this range. Duration is an integer 1-366 calendar days, interval 1-99,
and count 1-10000. Numeric model inputs must be numbers. Form controls retain
editable numeric text, accept digits and leading zeros, and canonicalize them.
Their raw input budget is eight digits; signs, decimals, exponents and surrounding
whitespace are rejected.

Title is nonblank, single-line, at most 255 UTF-16 units before edge trimming.
All original C0 controls, DEL and lone surrogates are rejected before trimming.
Description is at most 4000 UTF-16 units, normalizes CRLF/bare CR to LF, permits
LF/tab and rejects other C0 controls, DEL and lone surrogates. Valid Unicode and
other description content are retained.

Daily, weekly, monthly and yearly are supported. Weekly weekdays are unique,
nonempty, Monday-first and include the start weekday; Monday week start is
configured explicitly. Monthly sets BYMONTHDAY from the start day. Yearly sets
both BYMONTH and BYMONTHDAY. Missing days skip rather than drift. There is no
raw RRULE editor, timed event, timezone, ordinal weekday or exception-date input.

Ending is exactly never, occurrence count or inclusive until-date. COUNT includes
the start. Until limits starts, so an event can finish after its until date.
COUNT and UNTIL never coexist. Hidden form values do not leak into another mode.

## Preview and export

Preview runs only on the explicit Preview action. It begins at the selected
start, without reading today or an ambient timezone. It returns at most twenty
records and makes at most twenty-one public iterator calls including lookahead.
Mutable library results are immediately copied. Invalid/nonprogressing results,
extra COUNT entries, unexpected exhaustion and library exceptions are errors.

Stop labels distinguish count-ended, until-ended, preview-limit and date-limit.
The last two are preview restrictions, not the recurrence ending. Guard future
start and exclusive-end overflow before formatting. The library can internally
seek before returning; the caller budget is not hard CPU preemption. Sparse
leap-year and interval fixtures exercise this distinction without full expansion.

The file contains one VCALENDAR/VEVENT with fixed version/product metadata,
DATE-valued start/exclusive end, exact recurrence, plain summary/description and
explicit UID/UTC stamp. Public UID is 1-128 ASCII characters matching
`[A-Za-z0-9][A-Za-z0-9._@+-]*`. Stamp is a valid Gregorian UTC second in
`YYYY-MM-DDTHH:mm:ssZ`, years 1900-9999, without fractions, offsets or leap second.
Neither clock nor random identity is read in the pure model.

Typed library escaping is applied once. A bounded local wrapper unfolds and
refolds the generated file at code-point boundaries: CRLF physical lines are at
most 75 UTF-8 octets including continuation space, exactly one final CRLF and at
most 32 KiB. No global ICAL setting changes. There are no alarms, attendees,
attachments, invitations or external URLs.

The first explicit export obtains a public UID/stamp pair from an injected
synchronous factory. Unchanged accepted canonical data reuses that pair and the
exact bytes, including retries after serialization/download failure. Accepting
changed data retires it and obtains a fresh pair only at the next export. A
changed export is a separate event; there is no update or SEQUENCE promise.
Invalid/intermediate edits reverting to the same accepted data preserve identity.
Reset deliberately begins another event. No identity is generated on render,
validation or preview.

Only the current canonical draft matching an accepted preview can download.
Previous results are labeled and stale export text is hidden. Event handlers use
committed visible state; suspended speculative host renders cannot change the
visible action through render-written refs. Required fields, linked validation
errors, first-invalid-input focus, result focus and unique instance labels are
provided.

Download runs synchronously from the gesture through injected Blob/DOM/URL/timer
capabilities. It uses fixed filename `prism-recurrence.ics` and MIME type
`text/calendar;charset=utf-8`. Each URL and cleanup timer belongs to one operation;
replacement/disposal and stale callbacks cannot revoke another operation's URL.
Temporary anchors are removed on success and failure. A successful action says
Download started, not that a file was saved or imported.

Capability failure retains current generated text in a readonly textarea for
manual selection. Native textarea values normalize CRLF visually; a synchronous
user copy event supplies the original stored CRLF string without asynchronous
clipboard APIs. If that native copy capability fails, the tool reports the
failure and leaves manual selection available. Actual clipboard and calendar
import behavior depend on the browser and are not certified by these tests.

## Verification

Tests use real ICAL recurrence/component APIs, real React and local injected
capabilities. They load only the three new runtime files. No existing application
module, root setup, database, provider, network request or actual browser download
runs. Pure expected date vectors are independent of same-library round trips.

The installed library is deliberately not trusted as validation or final folding:
it normalizes invalid dates/intervals, bare yearly leap-day rules drift, raw CR
survives text serialization, default continuation lines can reach 76 bytes, and
Component.toString omits final CRLF. The wrapper closes those boundaries.

Run from the package checkout with the shared dependency directory available:

```sh
timeout 180s node --max-old-space-size=1024 node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r9-c01/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r9-c01/burn4-model.test.ts src/__tests__/burn4-tg3r9-c01/burn4-calendar.test.ts src/__tests__/burn4-tg3r9-c01/burn4-builder.test.tsx src/__tests__/burn4-tg3r9-c01/burn4-download.test.tsx
timeout 180s node --max-old-space-size=1024 node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r9-c01/burn4-tsconfig.json --noEmit --incremental false
timeout 180s node --max-old-space-size=1024 node_modules/eslint/bin/eslint.js --no-config-lookup --config src/__tests__/burn4-tg3r9-c01/burn4-eslint.config.mjs --max-warnings=0 src/lib/burn4-all-day-recurrence.ts src/components/calendar/burn4-all-day-recurrence-builder.tsx src/app/calendar/recurrence/page.tsx src/__tests__/burn4-tg3r9-c01/burn4-model.test.ts src/__tests__/burn4-tg3r9-c01/burn4-calendar.test.ts src/__tests__/burn4-tg3r9-c01/burn4-builder.test.tsx src/__tests__/burn4-tg3r9-c01/burn4-download.test.tsx src/__tests__/burn4-tg3r9-c01/burn4-fixtures.ts src/__tests__/burn4-tg3r9-c01/burn4-jest.config.cjs src/__tests__/burn4-tg3r9-c01/burn4-eslint.config.mjs
git diff --check
```

Expected: 186 ordinary tests across four files, zero skips or expected failures.
Strict source-inclusive types use actual public ICAL declarations, without
ambient replacements. Own Jest/TypeScript/ESLint configs avoid root discovery.

KNOWN GAP: None identified in the new implementation.
Needs-decision: None.
Limits: no Prism event persistence/dialog/nav integration, sync, imported-event
updates, timed/timezone rules, arbitrary RRULE editing or exceptions. No live
browser, clipboard, provider, whole-suite or broad RFC assurance.
