# Shopping and gift scenario reliability

These tests execute the registered callbacks in three unchanged E2E specs with a deterministic in-memory page, roster, shopping store and gift store. They cover 18 scenarios and all nine beforeAll/beforeEach/afterEach hooks. All auth, reset and cleanup imports are inert package-local fakes. The harness allows only listed relative routes, methods, selectors and imports. It denies process access and does not start a browser or server.

The suite contains 79 ordinary cases and 11 confirmed KNOWN GAP cases, with zero failures or skips. The ordinary cases include 11 fixture-boundary probes and 11 repair-oracle probes. Jest counts test.failing cases as passes when their desired contracts fail. The three setup-page cases represent one shared defect, giving nine underlying defects.

The API fake keeps response status and stored records separate from source assertions. Failed mutations preserve records, gift listings filter by the current synthetic identity, and UI content state changes only through modeled interactions. Scalar assertions use Jest. Locator assertions read independently maintained visible/text state. The harness does not model browser rendering, selector engines, Playwright retry timing or actual application endpoints.

## Run

From the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r7-b05/burn4-shopping.test.ts src/__tests__/burn4-tg3r7-b05/burn4-shopping-crud.test.ts src/__tests__/burn4-tg3r7-b05/burn4-gift-ideas.test.ts src/__tests__/burn4-tg3r7-b05/burn4-gaps.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r7-b05 --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r7-b05/burn4-tsconfig.json --noEmit
```

The scoped TypeScript configuration extends the root strict settings, retains noUncheckedIndexedAccess and uses only root dependencies. The test files also run through default root Jest discovery without a custom config or optional runtime.

The inverse probe deliberately exits 1 with eleven failed tests:

```sh
node node_modules/jest/bin/jest.js --runInBand --testMatch '**/burn4-gaps.inverse.ts' --runTestsByPath src/__tests__/burn4-tg3r7-b05/burn4-gaps.inverse.ts
```

Each inverse failure must show the named contract with `satisfied: false` against the desired `satisfied: true`. Each gap body contains only that desired-contract assertion. Separate ordinary cases prove that its fixture reached the intended boundary. The same assertion also passes under a small in-memory repair to the source text. Those repairs are oracle checks and do not change any repository source file; ordinary behavior and KNOWN GAP cases always load unchanged source.

## Coverage

| Source | Registered scenarios | Hooks | Behavior |
| --- | --- | --- | --- |
| e2e/shopping.spec.ts | 6 | 3 | Header, layout alternatives, item progress, mode entry/exit, progress visibility, list controls and reset ordering |
| e2e/shopping-crud.spec.ts | 5 | 3 | List discovery, API/modal creation, documented API fallback, check/uncheck, list creation, deletion, cleanup ordering and failure handling |
| e2e/gift-ideas.spec.ts | 7 | 3 | Tab content, person columns, unavailable prerequisites, response shape/status, target identity, self-gift rejection, account isolation and deletion |

The modal scenario explicitly documents an API fallback when its control is absent. That path receives ordinary behavior coverage.

## KNOWN GAP defects

1. Shopping progress reports success when there is no item to exercise, so it never checks an update.
2. Shopping mode reports success when the required entry control is absent.
3. Gift content reports success after a no-op tab click because it checks only the tab control.
4. Gift privacy reports success without observing another account when the roster has no child, even with another parent available.
5. Shopping teardown ignores false cleanup results and drops the IDs of remaining fixtures.
6. Gift privacy teardown ignores a failed delete response.
7. Gift verification failures bypass deletion of the created record.
8. A shopping item cleanup rejection prevents remaining list cleanup and logout.
9. All three setup hooks leak their temporary page if roster discovery rejects, covered by three cases.

The gaps describe test reliability defects. They do not establish a defect in the actual shopping or gift application endpoints. Source repairs need a separate review.

Needs-decision: none.
