# Calendar identity and browser boundary coverage

This package adds offline behavior tests for every exported function in:

- `src/lib/utils/calendarDedup.ts`: first representative, order, timestamp identity, title differences, and input preservation.
- `src/lib/utils/googleCalendarLink.ts`: calendar UI URLs, subscription feeds, malformed URLs, hostname spoofing, fragments, and query boundaries.
- `src/lib/utils/navCache.ts`: typed values, key isolation, exact 60-second expiry, replacement, invalidation, and removal of expired entries.
- `src/lib/utils/browserFetch.ts`: launch options, HTML extraction, import reuse, challenge wait fallbacks, dependency failures, and awaited cleanup.
- `src/lib/utils/logError.ts`: production error minimization, request correlation, non-Error values, and development diagnostics.
- `src/lib/input/keyboardTarget.ts`: attached and detached keyboard targets, library markers, SVG descendants, and ordinary controls.

Only new test files and this documentation are added. Puppeteer is a local fake. Browser and logging tests read the unchanged source, transpile it, and execute it in a VM with a synthetic `process` and fake imports. They do not read or change the actual environment, launch Chromium, fetch URLs, or contact services. The source loader is `burn4-vm-fixture.ts`.

## Run only this package

From the repository root with dependencies already installed:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath \
  src/__tests__/burn4-p02/burn4-calendar-identity.test.ts \
  src/__tests__/burn4-p02/burn4-nav-cache.test.ts \
  src/__tests__/burn4-p02/burn4-keyboard-target.test.ts \
  src/__tests__/burn4-p02/burn4-browser-fetch.test.ts \
  src/__tests__/burn4-p02/burn4-log-error.test.ts

node node_modules/eslint/bin/eslint.js \
  src/__tests__/burn4-p02/burn4-calendar-identity.test.ts \
  src/__tests__/burn4-p02/burn4-nav-cache.test.ts \
  src/__tests__/burn4-p02/burn4-keyboard-target.test.ts \
  src/__tests__/burn4-p02/burn4-browser-fetch.test.ts \
  src/__tests__/burn4-p02/burn4-log-error.test.ts \
  src/__tests__/burn4-p02/burn4-vm-fixture.ts

node node_modules/typescript/bin/tsc \
  --project src/__tests__/burn4-p02/burn4-tsconfig.json --pretty false
```

Validation: 5 suites, 81 total cases, 79 ordinary passing cases, 2 named expected failures, 0 skipped. Focused ESLint and package TypeScript checks passed with no diagnostics. This does not claim a repository-wide typecheck or suite pass.

To collect focused coverage, append these arguments to the package Jest command:

```sh
--coverage \
--collectCoverageFrom=src/lib/utils/calendarDedup.ts \
--collectCoverageFrom=src/lib/utils/googleCalendarLink.ts \
--collectCoverageFrom=src/lib/utils/navCache.ts \
--collectCoverageFrom=src/lib/input/keyboardTarget.ts \
--coverageDirectory=/tmp/prism-burn4-p02-coverage
```

All four instrumented modules reached 100% statements, branches, functions, and lines. `browserFetch.ts` and `logError.ts` execute inside the VM and are excluded from those instrumentation percentages. Their behavior is tested, but no coverage percentage is claimed for them.

## KNOWN GAP defects

1. **Global invalidation regex skips matching cache entries.** `navCacheInvalidate` reuses the stateful regex cursor between keys. With `/^\/api\/events/g`, the second matching key remains cached. The expected-failure test asserts that all three matching keys are removed.
2. **Unrelated class names containing hg-button are treated as keyboard keys.** `isVirtualKeyboardTarget` checks a substring rather than a class token. An ordinary button with `not-hg-button` is classified as part of the virtual keyboard. The expected-failure test asserts that it is rejected.

Both probes use `test.failing` and assert the desired behavior. During validation, temporarily removing those markers produced exactly the two intended assertion failures. No implementation changes are included.

## Needs decision

None.
