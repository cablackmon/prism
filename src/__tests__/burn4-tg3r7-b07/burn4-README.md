# Offline demo scenario contracts

This package executes the registered callbacks from all seven unchanged files in
`e2e/demos/scenarios`. It covers setup order, awaited interactions, optional editor
controls, celebration fallbacks, ingredient limits, request failures and actual
mode-change event callbacks. These scenario files contain no lifecycle hooks.

The VM loader reads only those seven named sources. Every auth/reset import is an
inert fake. The original helper, seed and application modules never load or run.
Unknown imports, registration hooks, page methods, window methods and request
paths fail. Page operations use synthetic objects and deferred promises; display
pauses accumulate virtual durations. The source `page.evaluate` functions execute
in a separate window/CustomEvent context, so event assertions depend on their real
code. Request records retain only approved mode fields and synthetic identity.

No browser, video, geometry measurement, service, database, real app data or
environment access occurs. The VM is a capability boundary for these fixed,
trusted source files, not a security sandbox for arbitrary hostile JavaScript.
The tests establish scenario control flow and failure detection. They do not
establish that selectors match a real rendered page or that recordings look good.

`burn4-baseline.ts` is an explicit tiny catalog of public synthetic grocery and
recipe names from `src/lib/db/seed.ts` at master `5452b7c6`. Its source line ranges
and SHA-256 are recorded beside the snapshot. It copies no person records or
credential fields, and the tests never import or execute the seed. This fixture
represents a clean seeded install after the inert reset prerequisite.

Run from the repository root with its development dependencies installed:

```sh
node node_modules/jest/bin/jest.js --runInBand --cacheDirectory /tmp/burn4-tg3r7-b07-jest --runTestsByPath src/__tests__/burn4-tg3r7-b07/burn4-scenarios.test.ts src/__tests__/burn4-tg3r7-b07/burn4-known-gaps.test.ts src/__tests__/burn4-tg3r7-b07/burn4-gap-fixes.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r7-b07/burn4-*.ts --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r7-b07/burn4-tsconfig.json --pretty false
node node_modules/tsx/dist/cli.mjs src/__tests__/burn4-tg3r7-b07/burn4-gap-probe.ts
```

The tests use normal Jest discovery and existing repository dependencies. The
scoped compiler configuration inherits strict mode, isolated modules and
`noUncheckedIndexedAccess` from the root. No optional runtime is needed.

Four desired contracts are named `KNOWN GAP` expected-failure cases:

- Grocery demo requires products missing from baseline seed. Its hardcoded list
  first fails at Apples on the synthetic seeded catalog, preventing completion.
- Recipe demo requires an unseeded user-added recipe. The requested Carne Asada
  card is absent from the synthetic seeded recipe catalog.
- Away demo broadcasts enabled state after rejected HTTP activation. A 503
  response still leads to the real callback emitting enabled state.
- Babysitter demo broadcasts enabled state after rejected HTTP activation. The
  same ignored-status path emits enabled state despite a 503 response.

The direct probe executes each exact desired-contract body without Jest's
expected-failure wrapper. It succeeds only when all four fail at their named
contract AssertionErrors, and prints only assertion names and primitive mismatch
values. Separate ordinary counterprobes apply each intended correction in memory
and require the same contract body to pass. Mode contracts accept either clean
early return or fail-fast rejection after HTTP failure, with no enabled event.
No original source file is changed by these counterprobes.

Missing celebration animations and an unavailable optional maximize button are
documented fallback behavior, covered as ordinary cases. No defect is claimed
for those fallbacks or for an unestablished concurrent/cleanup contract.

Needs-decision: None.
