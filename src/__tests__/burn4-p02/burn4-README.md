# Calendar deduplication, navigation cache and safe logging

These offline tests exercise current master source at `5452b7c6cef8f9b3d9b5e936c748822e2a28535a`:

- `src/lib/utils/calendarDedup.ts`: representative identity and metadata, input order, equivalent timezone instants, millisecond boundaries, title distinctions, and input preservation.
- `src/lib/utils/navCache.ts`: exact 60-second TTL, expiry deletion, replacement, independent keys, falsy values, and mutation invalidation.
- `src/lib/utils/logError.ts`: production error minimization, request correlation, unknown error values, and development diagnostic preservation.

Every runtime function in these three modules is exercised. Existing route tests mock `logError`; no existing direct tests covered these behaviors. The logger tests read its unchanged source and execute the transpiled module in a VM with a synthetic `process` and fake console. They never read or change actual environment values. No network or service dependencies are used.

## Run only this package

From the repository root with dependencies already installed:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath \
  src/__tests__/burn4-p02/burn4-calendar-identity.test.ts \
  src/__tests__/burn4-p02/burn4-nav-cache.test.ts \
  src/__tests__/burn4-p02/burn4-log-error.test.ts

node node_modules/eslint/bin/eslint.js \
  src/__tests__/burn4-p02/burn4-calendar-identity.test.ts \
  src/__tests__/burn4-p02/burn4-nav-cache.test.ts \
  src/__tests__/burn4-p02/burn4-log-error.test.ts \
  src/__tests__/burn4-p02/burn4-log-error-fixture.ts

node node_modules/typescript/bin/tsc \
  --project src/__tests__/burn4-p02/burn4-tsconfig.json --pretty false
```

Validation: 3 suites, 25 total cases, 23 ordinary passing cases, 2 named expected failures, 0 skipped. Focused ESLint and package TypeScript checks pass with no diagnostics. No repository-wide suite or typecheck is claimed.

To collect focused coverage, append these arguments to the package Jest command:

```sh
--coverage \
--collectCoverageFrom=src/lib/utils/calendarDedup.ts \
--collectCoverageFrom=src/lib/utils/navCache.ts \
--coverageDirectory=/tmp/prism-burn4-p02-coverage
```

Both instrumented modules reach 100% statements, branches, functions, and lines. `logError.ts` executes in the VM, so no instrumentation percentage is claimed for it.

## KNOWN GAP defects

1. **Global invalidation regex skips matching cache entries.** `navCacheInvalidate` reuses the regex cursor between keys. With `/^\/api\/events/g`, the second matching key remains cached. The expected-failure test asserts that all three matching keys are removed.
2. **Production logger throws for non-Error objects without a primitive conversion.** Converting a null-prototype diagnostic object with `String(error)` throws a `TypeError`. An error logger should emit a safe diagnostic without throwing a second error. The expected-failure test asserts that logging the object does not throw and emits one log entry.

Both probes use `test.failing` and assert desired behavior. Validation also runs the probes without expected-failure inversion and saves the raw assertion failures outside the repository. No production source changes are included.

## Needs decision

None.
