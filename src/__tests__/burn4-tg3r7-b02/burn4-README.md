# Calendar E2E safety and failure detection

These offline tests execute the registered callbacks in three unchanged specs:

| Source | Callbacks | Lifecycle coverage |
| --- | --- | --- |
| `e2e/calendar.spec.ts` | Page header and navigation controls; Today; Next and Previous; Month and Day switching; parent Add Event button | Successful parent discovery closes its page; login; logout after successful and rejected callbacks; discovery failure |
| `e2e/event-crud.spec.ts` | API creation; modal creation; edit; delete with GET verification; all-day toggle | Successful discovery and login; both title cleanup calls and logout; either cleanup rejection; discovery failure; redacted pre-login identity |
| `e2e/calendar-notes.spec.ts` | Day notes button; notes toggle; response shape; upsert and delete; missing date range; Month notes absence | Successful discovery, login and logout; discovery failure; logout after transport and assertion failures |

Every one of the 16 registered tests and nine hooks executes. Event form cases exercise local date formatting across year, month and leap-day boundaries. Fault cases show that existing assertions reject failed statuses, malformed note data, incorrect all-day updates, broken Next/Previous behavior and still-readable deleted events. Unrelated synthetic event and note fixtures survive successful cases.

The VM permits only fake Playwright and inert auth/cleanup imports. It has no process, fetch, timer or real helper access. No original helper implementation executes. Strict local pages reject unknown selectors/methods, and the synthetic API rejects unknown routes. Its mutable stores model event IDs and the date-keyed notes contract. Authentication stubs record only lifecycle labels and use synthetic members. They neither construct nor retain credential-bearing payloads.

This covers E2E test safety and failure detection. It does not run a browser, application route, provider, database or live service. The cleanup helper is intentionally inert; these cases cover whether the source spec calls it and continues cleanup after rejection.

Run from the repository root:

```sh
./node_modules/.bin/jest --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r7-b02/burn4-calendar.test.ts src/__tests__/burn4-tg3r7-b02/burn4-event.test.ts src/__tests__/burn4-tg3r7-b02/burn4-notes.test.ts
./node_modules/.bin/eslint src/__tests__/burn4-tg3r7-b02/*.ts --max-warnings 0
./node_modules/.bin/tsc -p src/__tests__/burn4-tg3r7-b02/burn4-tsconfig.json
```

The scoped TypeScript configuration retains strict mode and `noUncheckedIndexedAccess`. It needs only the existing repository dependencies. Test files use the default Jest matcher and need no optional runtime.

The verified run has 73 passing cases: 57 ordinary passes, including 16 inverse probes, and 16 named KNOWN GAP expected failures. There are zero failed or skipped cases. Scoped TypeScript and focused lint pass without diagnostics or warnings.

KNOWN GAP cases express desired behavior with `test.failing`. Their desired bodies contain no assertion of the current defect. A source repair that satisfies the contract causes an unexpected pass and requires updating the gap. Each separate inverse probe establishes the current defective behavior, invokes the same desired assertion directly, verifies its Jest matcher failure, and prints the actual assertion error. Run the probes alone with:

```sh
./node_modules/.bin/jest --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r7-b02/burn4-calendar.test.ts src/__tests__/burn4-tg3r7-b02/burn4-event.test.ts src/__tests__/burn4-tg3r7-b02/burn4-notes.test.ts --testNamePattern='INVERSE:'
```

The 16 named gap cases pin these source defects:

1. Note CRUD overwrites and deletes a pre-existing shared daily note without restoring it (`calendar-notes.spec.ts:85`).
2. Note CRUD leaves its new note behind when GET verification throws (`calendar-notes.spec.ts:99`).
3. The same residue occurs when GET verification returns wrong persisted content (`calendar-notes.spec.ts:99`).
4. Notes toggle accepts active `data-state` styling without a rendered panel (`calendar-notes.spec.ts:64`).
5. Notes toggle also accepts active class styling without a rendered panel (`calendar-notes.spec.ts:64`).
6. Month notes absence passes when the Month control is missing and Month was never selected (`calendar-notes.spec.ts:129`).
7. Notes setup leaves its temporary page open when parent discovery rejects (`calendar-notes.spec.ts:7`).
8. Modal event creation accepts a closed dialog without checking persistence (`event-crud.spec.ts:47`).
9. The first rejected event cleanup prevents the edited-event cleanup and logout (`event-crud.spec.ts:21`).
10. The second rejected event cleanup prevents logout (`event-crud.spec.ts:21`).
11. Event setup leaves its temporary page open when parent discovery rejects (`event-crud.spec.ts:11`).
12. API event creation sends an empty, redacted pre-login creator ID after login (`event-crud.spec.ts:13`). The desired contract permits omitting an unknown creator or using the authenticated synthetic ID. No auth or validation source executes.
13. Today passes when its button never restores the current period (`calendar.spec.ts:33`).
14. View switching passes with both target controls missing (`calendar.spec.ts:69`).
15. View switching passes when both controls leave the layout unchanged (`calendar.spec.ts:69`).
16. Calendar setup leaves its temporary page open when parent discovery rejects (`calendar.spec.ts:7`).

Needs-decision: None. Source fixes are outside this new-file-only package.
