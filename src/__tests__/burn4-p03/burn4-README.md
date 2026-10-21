# Birthday merge and CardDAV offline coverage

This package exercises every exported runtime function in
`src/lib/services/birthday-merge.ts` and
`src/lib/services/carddav-birthday-sync.ts`.

Run only this package from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p03/burn4-birthdays.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p03/burn4-store.ts src/__tests__/burn4-p03/burn4-birthdays.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p03/burn4-tsconfig.json
```

To collect coverage for just these two service modules:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p03/burn4-birthdays.test.ts --coverage --collectCoverageFrom=src/lib/services/birthday-merge.ts --collectCoverageFrom=src/lib/services/carddav-birthday-sync.ts
```

The suite contains 57 cases: 55 ordinary passing cases and two named
`test.failing` cases asserting desired behavior for known defects. There are no
skipped tests. Focused ESLint and the package TypeScript project pass.

Birthday cases cover insert and unique-key conflict persistence, event-type and
month/day boundaries, leap-day sentinel upgrades, case and punctuation handling,
whole-token prefix identity, distinct surnames, year preference, provenance-only
no-ops, manual authority, metadata preservation, idempotency, and database failures.

CardDAV cases cover source opt-in filtering, empty accounts, server/user account
identity, deduplication across calendars, account fan-out, incomplete configuration,
decryption failures, provider failures, birthday write failures, independent runs,
and imports through the actual birthday merge function. A successful duplicate
counts as a processed contact even though it does not change the database.

The in-memory database uses the real schema and Drizzle SQL compilation. It
applies the selected event type and date parameters, preserves unspecified
columns on updates, and enforces the real `(name, eventType)` conflict key. It
rejects unsupported query shapes. The fake does not model transactions,
concurrency, PostgreSQL date validation, or external network behavior. All provider
and decryption effects are mocked; global fetch rejects unexpected network calls.
All records and account markers are synthetic.

Measured coverage is 100% of statements, lines, and functions in both services.
Branch coverage is 100% in birthday merge and 94.44% in CardDAV sync. The remaining
CardDAV branch is the null provider-config fallback, which a real opted-in-source
query filters out before iteration. Tests do not force an impossible query result
just to cover that fallback.

## KNOWN GAP

- Same-name date conflicts overwrite authoritative manual birthdays. Candidate
  selection is limited to the incoming month/day. A manually entered same-name
  birthday on another day is missed, then `onConflictDoUpdate` replaces its date
  and stamps sync provenance. The expected-failure test asserts the original
  manual row remains unchanged.
- Non-ASCII names collapse to the same empty identity. The ASCII-only normalization
  strips both `李明` and `王芳` to an empty string, so distinct people sharing a date
  are treated as one exact match. The expected-failure test asserts both people
  remain present.

Each expected-failure assertion was also run temporarily as an ordinary test.
Both failed on the documented persisted-row mismatch, without mock or import
errors. The temporary probe was removed after verification.

## Needs decision

None. This package adds tests only and leaves production fixes for review.
