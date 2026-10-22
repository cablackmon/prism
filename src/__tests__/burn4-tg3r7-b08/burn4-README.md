# Offline chore and task E2E reliability

This package executes the unchanged callbacks in `e2e/chore-crud.spec.ts`,
`e2e/chores.spec.ts` and `e2e/tasks.spec.ts`. It checks whether those scenarios
perform their stated interactions and fail on the synthetic faults they already
assert. It does not run Playwright, a browser, an application route or a service.
No application behavior, visual layout or production coverage is claimed.

The loader reads those three source files and uses the existing TypeScript
compiler to evaluate their CommonJS output in a VM. Only the Playwright test
registration API and inert auth, cleanup and reset replacements are available.
Original helper implementations never load. The VM has no process, environment,
network, timer or unrestricted module loader. Its clock is fixed. Helpers use
synthetic identities without credential fields. Explicit response queues reject
unexpected requests. Locator assertions consult local visibility and text state;
primitive assertions use Jest. Hidden clicks, unsupported selectors, unknown
requests and unexpected payload paths fail. These checks validate scenario
control flow, not browser rendering or application permission implementation.

## Run from the repository root

Use the existing root development dependencies. Run only these package files:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r7-b08/burn4-lifecycle.test.ts src/__tests__/burn4-tg3r7-b08/burn4-chore-crud.test.ts src/__tests__/burn4-tg3r7-b08/burn4-smoke.test.ts src/__tests__/burn4-tg3r7-b08/burn4-known-gaps.test.ts src/__tests__/burn4-tg3r7-b08/burn4-inverse-probes.test.ts
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r7-b08/burn4-inverse-probes.test.ts
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r7-b08/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r7-b08/*.ts --max-warnings=0
```

The scoped compiler inherits root strictness, adds explicit Jest/Node types,
disables incremental output and preserves `noUncheckedIndexedAccess`. No
optional runtime or dependency installation is needed. Normal root Jest
selection can discover these tests safely; imports execute only local fakes.

## Callback coverage

All 15 test callbacks and all 9 lifecycle hooks execute. Every hook has success
and injected failure coverage. Each scenario below executes its original body.

| Source | Registered callback or hook | Useful checks |
| --- | --- | --- |
| All three | beforeAll | Reset where required, allocation, synthetic discovery, page closure, allocation/reset/close failures, discovery leak gaps |
| All three | beforeEach | Parent login role, rejected login leaves no session |
| All three | afterEach | Logout, cleanup ordering where required, rejected logout, cleanup continuation gap |
| chore-crud | create a chore via API | Request settings, 201, title, points, frequency, request/JSON failure |
| chore-crud | create chore via modal UI | Navigation, control visibility, modal open, input, submit, closure, new title, missing/stuck controls |
| chore-crud | complete a chore as parent (auto-approve) | Parent identity, daily settings, 201, approved/points/approval flags, corrupt replies |
| chore-crud | complete chore as child requires approval | Explicit no-child skip sentinel, child payload, pending flags, parent approval payload/points, corrupt replies, session gap |
| chore-crud | disable a chore prevents completion | Disabled patch before completion, HTTP400 and disabled reason, rejected patch/wrong status/reason |
| chores | chores page loads with header | Correct navigation and heading; wrong heading fails |
| chores | chores are displayed from database | Populated/empty branches, rendered badge, missing content, invalid JSON, failed-response gap |
| chores | history button toggles completion history view | History click must expose heading; missing heading fails |
| chores | group by person view shows user columns | Positive column count when control exists, hidden-control branch, zero columns fails |
| chores | add chore button is visible for parents | Presence and missing-control failure |
| tasks | tasks page loads with header | Correct navigation and heading; wrong heading fails |
| tasks | tasks are displayed from database | Populated/empty branches, main content, missing content, invalid JSON, failed-response gap |
| tasks | status filter buttons are visible | Active branch, hidden mobile branch, Completed-only gap |
| tasks | group by person toggle switches view mode | Two clicks restore grouping; hidden-control branch |
| tasks | add task button is visible for parents | Presence and missing-control failure |

Navigation and load failures execute separately for each source. An absent child
uses the source's fake skip sentinel; no Jest test is skipped. Optional grouping
and mobile filter branches are documented behavior, not invented defects.

## KNOWN GAP desired contracts

Nine expected-failure cases represent six defect categories. Each desired probe
asserts the behavior a future source fix should produce. A fixed contract makes
`test.failing` report an unexpected pass, so the gap must then be retired. Direct
inverse probes invoke those same functions without expected-failure inversion,
require an `AssertionError` with the named marker and print its message. A
loader, fake or prerequisite failure cannot satisfy that check.

| ID | Source defect and desired behavior |
| --- | --- |
| G01 | The child approval scenario stays authenticated as parent when posting child `completedBy`. Authenticate the child for completion and parent for approval. Canned API replies avoid simulating application permissions; recorded session roles prove the missing transition. |
| G02 | The child lookup catches every error and converts transport failure into missing-child skip. Infrastructure failures must propagate. |
| G03 | Chores database smoke ignores HTTP500 and accepts a JSON error document. A failed data response must fail the scenario. |
| G04 | Tasks database smoke has the same HTTP500 false positive. A failed data response must fail the scenario. |
| G05 | Chore CRUD setup leaves its temporary page open when parent discovery rejects. Close it on failure. |
| G06 | Chores setup leaks the same temporary page on discovery failure. Close it on failure. |
| G07 | Tasks setup leaks the same temporary page on discovery failure. Close it on failure. |
| G08 | Chore deletion rejection prevents logout. Attempt logout while retaining the cleanup failure. |
| G09 | With Active hidden and Completed visible, the task filter callback clicks hidden Active. Click its visible filter and complete successfully. |

Existing source files remain unchanged. Needs-decision: none.
