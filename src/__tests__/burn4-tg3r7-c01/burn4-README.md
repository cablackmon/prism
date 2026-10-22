# Offline chore due-date preview and calendar

This standalone tool rehearses the proposed due-date recurrence in
[Prism planning](../../../docs/planning.md) line 32 and the linked open
[chore semantics proposal](https://github.com/sandydargoport/prism/issues/51).
It produces a JSON migration preview or an importable all-day calendar from one
explicit local snapshot. Existing application modules are context only.

The server's recurring-chore engine, database, points, archive records, backfill,
sweeper and app calendar remain outside this tool. A missed row means what the
proposed policy would archive, not a write or a verified historical event.

## Try the synthetic example

From the repository root, with Node 24 or newer:

```sh
node scripts/burn4-chore-anchor-preview.mjs --help
node scripts/burn4-chore-anchor-preview.mjs --input src/__tests__/burn4-tg3r7-c01/burn4-example.json
node scripts/burn4-chore-anchor-preview.mjs --input src/__tests__/burn4-tg3r7-c01/burn4-example.json --format ics
```

Output goes only to stdout. To save a calendar for import, explicitly redirect it:

```sh
node scripts/burn4-chore-anchor-preview.mjs --input src/__tests__/burn4-tg3r7-c01/burn4-example.json --format ics > chore-preview.ics
```

The included example contains one missed occurrence on October 20 at zero
projected points, a current occurrence on October 21, three future occurrences,
and two skip diagnostics. Only the four current/future dates enter the calendar.

## Input contract

A snapshot contains exactly `asOf`, `through` and `chores`. Both dates use real
Gregorian `YYYY-MM-DD` dates in years 0001 through 9999. The caller supplies the
household local date explicitly; the tool never reads the clock or infers a
household timezone. `through` is inclusive and cannot precede `asOf`.

Every chore requires `id`, `title`, Boolean `enabled`, and `state`. States are
`outstanding`, `pending-approval`, and `completed`. IDs are unique, whitespace-free
strings up to 128 UTF-16 code units. Titles have 1 through 1000 code units and
normalize CRLF/lone CR to LF. Invalid controls and lone surrogates reject.
Unknown fields reject. In-memory API callers must supply plain objects with
own enumerable data fields and plain dense arrays; accessors are rejected.

An enabled outstanding chore also requires `nextDue`, `frequency`, and the
literal Boolean `noInterveningCompletion: true`. The caller thereby certifies
that no completion occurred between the supplied anchor and `asOf`. This is an
explicit attestation, not history verified by the tool. A normal application API
response cannot establish it by itself.

Disabled, pending-approval and completed chores produce skip diagnostics instead
of projections. They may omit their scheduling fields. Every supplied field still
validates, and true no-intervening-completion evidence conflicts with pending or
completed state. Disabled outstanding rows do not need that evidence because
they do not project history. All rows still need identity, title, enabled and
state. Reasons sort by ID, with disabled taking precedence.

Supported frequencies are `daily`, `weekly`, `biweekly`, `monthly`, `quarterly`,
`semi-annually`, `annually`, and `custom`. Custom frequency requires integer
`customIntervalDays` from 1 through 365. That field rejects on other frequencies.
Optional `nextDueTime` must be valid `HH:mm`; it is suggestive and never changes
a due day's status. Null schedule fields reject; omit unused fields instead.

Month-family dates use the original supplied anchor plus N months, clipping the
day only for the target occurrence. January 31 produces February 28 then March
31; annual February 29 returns to February 29 in the next leap year. These are
explicit preview policies, not the current server's reset-day behavior.

## Output and limits

JSON contains `missed`, `current`, and `future` arrays per active chore. Every
missed entry has `projectedPoints: 0`; scheduled entries do not award points.
`firstNonexpiredDue` is the first occurrence on or after `asOf`, even when it is
beyond `through`. Future anchors never create earlier phantom instances. Rows
sort by ID and occurrence dates are chronological. The input is never mutated.

The calendar expands only current/future occurrences inside the horizon. Each
has a stable SHA-256 UID derived from its exact chore ID and occurrence date,
all-day start and exclusive next-day end. Titles are escaped, CRLF framed and
folded to at most 75 UTF-8 octets per physical line without splitting code points.
A fixed valid DTSTAMP (`20000101T000000Z`) is a deterministic artifact marker,
not a claim about actual creation time. There is no timezone conversion or
recurrence rule for an importing client to reinterpret.

Calendar export requires at least one scheduled occurrence. Empty projections
still produce JSON, but ICS returns a controlled error rather than inventing an
event or emitting an invalid empty calendar. This follows
[RFC 5545 section 3.6](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6).
The file omits METHOD because it is a local import artifact, rather than an iTIP
PUBLISH transaction with an organizer as specified in
[RFC 5546 section 3.2.1](https://www.rfc-editor.org/rfc/rfc5546.html#section-3.2.1).
Calendar application import behavior beyond the format round-trip is untested.

File input is bounded to 1 MiB of valid UTF-8 and 1000 rows. The difference between
`asOf` and `through`, and between the earlier of `nextDue`/`asOf` and `through`
for each active row, cannot exceed 3660 days. The combined budget is 10000
projected occurrences, including missed history. Projection work also has at
most one lookahead per active row. Limits reject before successful output;
calendar arithmetic never walks unbounded ancient history. A scheduled
9999-12-31 rejects because its exclusive end is outside the supported calendar.
If no first nonexpired occurrence exists before year 10000, projection rejects.

Exit code 0 means artifact/help success. Exit code 2 means controlled argument,
read, encoding, JSON, schema, bound, empty-calendar or output-sink failure. Errors
use bounded stderr messages without source values or stack traces; stdout stays
empty for input/validation failures. A failing output sink may have consumed
partial output, so discard output if the exit code is nonzero. A broken stderr
sink cannot receive a diagnostic. The CLI reads only the explicit regular input
file with a bounded read that also catches file growth. It does not create an
output file, fetch, spawn commands, read environment values or contact services.
Imports perform no input reads or output. Runtime dependencies are Node builtins.

## Validation

The 100 native tests cover every exported parser/planner/renderer/CLI path,
eight hand-authored recurrence vectors, early years and century leap rules,
state evidence and skips, bounds, independent ical.js round trips, UTF-8 folding,
content injection, UID stability, real CLI failures, input growth, output sinks
and import safety. Tests use synthetic data and local temporary files only.
`ical.js` is an existing development-time test dependency; the tool does not
import it. Native test filenames stay outside default root Jest discovery.

```sh
node --test --test-concurrency=1 src/__tests__/burn4-tg3r7-c01/burn4-planner.test.mjs src/__tests__/burn4-tg3r7-c01/burn4-validation.test.mjs src/__tests__/burn4-tg3r7-c01/burn4-calendar.test.mjs src/__tests__/burn4-tg3r7-c01/burn4-cli.test.mjs
node node_modules/eslint/bin/eslint.js scripts/burn4-chore-anchor-preview.mjs src/__tests__/burn4-tg3r7-c01/burn4-*.mjs --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r7-c01/burn4-tsconfig.json --pretty false
```

Strict scoped checkJs inherits root safety flags, including strict mode,
isolated modules and noUncheckedIndexedAccess, without emitting artifacts.
KNOWN GAP: None. Needs-decision: None.
