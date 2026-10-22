# Tooling isolation behavior

These 33 offline tests exercise five unchanged tooling sources:

- `eslint.config.mjs`: actual ESLint and installed plugins lint synthetic TSX strings. Invalid accessibility, list keys, unused names and type declarations have valid controls. Ignore predicates keep generated content outside linting while application paths remain eligible.
- `playwright.config.ts`: source runs in a VM with a synthetic process, an allowlisted inert `defineConfig` and a synthetic device profile. Cases cover local and CI policies, retries, worker limits, server reuse, demo exclusion and independent evaluations.
- `jest.config.js` and `jest.integration.config.js`: real Jest normalization and `SearchSource.isTestFilePath` evaluate supplied paths. No discovery scan, discovered test import or suite execution occurs.
- `jest.setup.js`: a separate synthetic global receives the ResizeObserver stub. Cases verify synchronous geometry callbacks, callback identity, multiple targets, isolated observers and teardown calls.

The default Jest matcher intentionally includes the database integration path. That file documents a separate opt-in skip gate. This package only checks its path and does not import the test, its database helper or its gate. The separate integration configuration narrows its own matcher to that one path.

The VM import adapter replaces only `import.meta.url` with the equivalent module file URL in memory before CommonJS transpilation. The adapter does not rewrite policy or rule code. Real ESLint dependencies load locally; the tests never launch browsers, servers, external commands or services and never access application environment values.

From the repository root, run only these files:

```sh
node node_modules/jest/bin/jest.js --runInBand --cacheDirectory /tmp/burn4-tg3r4-a06-jest --runTestsByPath src/__tests__/burn4-tg3r4-a06/burn4-eslint-behavior.test.ts src/__tests__/burn4-tg3r4-a06/burn4-playwright-policy.test.ts src/__tests__/burn4-tg3r4-a06/burn4-jest-boundaries.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r4-a06/burn4-tooling-harness.ts src/__tests__/burn4-tg3r4-a06/burn4-eslint-behavior.test.ts src/__tests__/burn4-tg3r4-a06/burn4-playwright-policy.test.ts src/__tests__/burn4-tg3r4-a06/burn4-jest-boundaries.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r4-a06/burn4-tsconfig.json --incremental false
```

Results: 33 ordinary passes, zero expected failures, failures or skips. Focused lint has zero warnings. The strict TypeScript project covers this package's tests and harness; it does not typecheck the unchanged tooling sources or the application.

KNOWN GAP list: none confirmed. This is a tooling behavior package. It does not validate actual browser/server startup, database connectivity, full-suite execution, translation helper behavior, real device profiles or layout measurements.

Needs-decision list: none.
