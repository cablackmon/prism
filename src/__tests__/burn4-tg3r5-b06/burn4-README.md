# Offline cleanup helper behavior

This package executes the unchanged `e2e/helpers/cleanup.ts` in an isolated Node VM. Its `Page` import is erased by TypeScript. Runtime imports are forbidden, and every request is an inert Jest function. No Playwright runtime, browser, network, database, environment values or authentication helper is used.

Coverage includes all six exports: task/event title lookup, message substring lookup, all matching chores, and direct shopping-list/item deletion. Cases cover wrapped and raw arrays, first-match selection, case sensitivity, missing and invalid responses, failed HTTP statuses, preserved transport/JSON errors, independent calls and deferred concurrent chore deletions. Fixed clocks cover year rollover, leap years and timezone boundaries.

Run from the repository root with its existing dependencies installed:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b06/burn4-cleanup-selection.test.ts src/__tests__/burn4-tg3r5-b06/burn4-cleanup-concurrency.test.ts src/__tests__/burn4-tg3r5-b06/burn4-cleanup-dates.test.ts src/__tests__/burn4-tg3r5-b06/burn4-cleanup-gaps.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r5-b06/*.ts --max-warnings=0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r5-b06/burn4-tsconfig.json
```

The accepted run contains 83 cases: 82 ordinary passes and one confirmed expected failure, with no skipped cases. TypeScript validates only the new tests and harness. The unchanged helper is transpiled in memory and is not part of the scoped typecheck.

KNOWN GAP: event cleanup shifts local calendar boundaries one day earlier east of UTC. Local midnight is converted to UTC before its date is extracted. At UTC+05:30, a January search requests November 30 through February 27 instead of December 1 through February 28. The test asserts the intended local calendar dates. Source fixes are outside this new-files-only package.

Run that exact assertion directly, without expected-failure inversion:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b06/burn4-cleanup-gaps.test.ts --globals '{"burn4DirectGap":true}'
```

This direct probe must exit 1 with one assertion failure showing the shifted request dates. The normal run uses `test.failing`, so a future source fix requires promoting the gap to an ordinary regression case.

Malformed successful payloads and request/JSON errors currently reject without unsafe deletion; these cases preserve the existing error contract. No separate recovery policy is asserted. Needs-decision: none.
