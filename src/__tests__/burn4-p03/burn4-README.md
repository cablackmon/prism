# Local recipe images and audit lifecycle

Plan revision 2. These tests exercise the unchanged current master source at
`5452b7c6cef8f9b3d9b5e936c748822e2a28535a` in:

- `src/lib/services/recipe-image-storage.ts`: `saveRecipeImage`,
  `deleteRecipeImage`, and `getRecipeImagePath`.
- `src/lib/services/auditLog.ts`: `logActivity`.
- `src/lib/services/auditCleanup.ts`: `cleanupOldAuditLogs`.

There were no dedicated tests for these services. Existing route tests replace
the audit helpers with mocks, so they do not exercise this implementation.

Run only this package from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p03/burn4-images.test.ts src/__tests__/burn4-p03/burn4-audit.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p03/burn4-fakes.ts src/__tests__/burn4-p03/burn4-images.test.ts src/__tests__/burn4-p03/burn4-audit.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p03/burn4-tsconfig.json
```

For focused coverage, append these flags to the Jest command:

```sh
--coverage --collectCoverageFrom=src/lib/services/recipe-image-storage.ts --collectCoverageFrom=src/lib/services/auditLog.ts --collectCoverageFrom=src/lib/services/auditCleanup.ts
```

Validation: 31 total cases, consisting of 30 ordinary passing cases and one named
expected failure. No skipped cases. Focused ESLint and package typecheck pass.
Statements, lines, functions, and branches measure 100% in the three target
modules. This is service orchestration coverage; it does not test native JPEG
encoding, actual disk behavior, or an actual database.

Image tests use pure fake filesystem and sharp modules. They verify the original
buffer and orientation/resize/JPEG transform order, await directory creation,
replace only the selected file, preserve neighbors, return a stable filename,
resolve local paths without I/O, propagate guard/mkdir/decode/write errors, and
handle existing and absent file deletion. The path guard is a mocked excluded
dependency; tests verify delegation before effects without claiming guard
implementation coverage. The filesystem fake never writes an actual file.

Audit tests use deferred fake insert promises to verify that `logActivity`
returns before persistence completes, reports asynchronous failures, keeps
independent event payloads, and supplies nullable optional fields. Frozen inputs
check that the service does not mutate callers' values. Cleanup uses a real
Drizzle less-than predicate against a mocked minimal audit table and an
in-memory persistence model. Fake time verifies the exact 30-day millisecond
boundary, future entries, idempotency, cutoff recomputation, and failure recovery.
The excluded real schema and database client never load at runtime.

No host environment values are read or changed. No native sharp library,
external provider, hosted database, or network service is used. Only the explicit
package files are run, never the whole suite.

## KNOWN GAP

- Image deletion suppresses permission failures and leaves the file behind.
  `deleteRecipeImage` catches every unlink error even though its comment only
  describes absent files. With an existing image and `EACCES`, callers see a
  successful deletion while the image remains stored. The named expected-failure
  test asserts that the permission error reaches the caller. It was also run as
  an ordinary test; its saved probe log shows the rejection assertion fails
  because the function resolves. The temporary probe file was removed.

## Needs decision

None. This package adds tests only; the documented production defect remains
available for a separate reviewed fix.
