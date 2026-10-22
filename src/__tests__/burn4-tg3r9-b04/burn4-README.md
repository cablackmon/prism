# Standalone weekly task completion

This feature implements the manual weekly task workflow documented in `docs/features/TASKS.md` lines 196-200. Completing a local date-only occurrence returns a new immutable snapshot with that row completed, exactly one next weekly task and a replay receipt. The React control submits that real candidate through an injected host callback.

It is not connected to the current Tasks page, task APIs, database or sync providers. No existing app module is imported. The host supplies authorized local snapshots, IDs, actor and completion time, and must atomically check the expected revision before saving. Returned state alone does not prove remote persistence.

## Model use

```ts
import { completeWeeklyTask } from '../../lib/burn4-recurring-task';

const initial = {
  revision: 4,
  tasks: [{
    id: 'task-0', origin: 'local', seriesId: 'series-1',
    anchorDate: '2026-01-30', occurrence: 0, dueDate: '2026-01-30',
    title: 'Take out the recycling', description: 'Blue bin',
    listId: 'home', assignedTo: 'member-2', priority: 'high',
    category: 'Household', completed: false, completedAt: null, completedBy: null,
  }],
  receipts: [],
};
const result = completeWeeklyTask(initial, {
  id: 'completion-1', expectedRevision: 4, taskId: 'task-0',
  successorId: 'task-1', actorId: 'historic-parent',
  completedAt: '2026-02-20T12:34:56.789Z',
});
// result.snapshot has revision 5 and task-1 due 2026-02-06.
// The late completion does not skip scheduled weeks or invent missed completions.
```

`parseWeeklyTaskSnapshot` validates the entire value, copies only the exact supported shape, orders rows/receipts by their IDs and freezes all returned state. All fields in the example task are required; nullable fields can be null. Unknown fields, including provider/source identifiers, are rejected. Historical completion actors need no current roster entry.

`nextWeeklyTaskDate(anchorDate, occurrence)` returns the date at the explicit zero-based occurrence using seven-day Gregorian arithmetic. Years 0001 through 9999 are supported. Invalid dates and overflow fail before any transition.

`completeWeeklyTask` returns `applied` or `replayed`. Exact command replay preserves the current snapshot even after later completions. Reusing a command ID with different content conflicts. Stale revisions, unknown tasks, already-completed sources, successor ID collisions and multiple outstanding branches reject the whole operation. No partial candidate is returned. At most one outstanding row per series is allowed and it must have the highest occurrence number. The original anchor must agree across a series. This standalone model allows historical rows to be absent; it does not reconstruct a complete history.

Receipts retain the explicit command and resulting revision. Each command, completed source and resulting revision is unique. Receipt references must match a completed source's actor/time and its next occurrence. Retaining receipts and referenced tasks is required for replay validation; no receipt pruning or series deletion operation is provided.

`WeeklyTaskError` exposes a fixed `code` and value-free message. Codes distinguish invalid input, date overflow, capacity, frontier, revision, command, missing-task, completed-task and successor conflicts. No caller values are included in diagnostics.

Input limits: 5,000 rows, 2,500 receipts, 250,000 total string code units across task/command fields, 64-character ASCII IDs, 240-character titles, 4,000-character descriptions and 80-character categories. Revision is a nonnegative integer up to 1,000,000,000. Per-row and aggregate budgets apply again to the output candidate. Some limits may be reached before others.

## Controlled UI

Render `WeeklyTaskCompletion` with `snapshot`, `taskId`, `actorId`, `completedAt`, `commandId`, `successorId` and `onCommit`. The host creates IDs; the component never reads the clock or generates identities. `onCommit` receives a frozen `{ command, snapshot }` request.

The user confirms after seeing the exact next due date. Cancellation is available before submission. Once saving is attempted, uncertain results retain the frozen request for retry; an in-flight host operation cannot be canceled. Changing command/time/next-ID props does not change an uncertain retry. Duplicate and reentrant submissions are blocked while a request is in flight.

A resolved host callback leaves the UI waiting. Only `isWeeklyTaskAcknowledged(actual, candidate, command)` with the exact canonical candidate and its matching receipt marks it saved. Array order can differ, but any row/receipt content or revision difference conflicts. This deliberately conservative contract does not acknowledge a later unrelated host revision. A host rollback after acknowledgement becomes a conflict too. Reload explicitly adopts the current authoritative state before another operation. A partial host state returning to the old base does not erase an already-observed conflict.

Task or actor changes and unmount fence old asynchronous callbacks. Acknowledgement fencing is published in the committed effect only; speculative Suspense/startTransition renders cannot suppress an active rejection retry or create a sticky conflict when abandoned. Committed phase state preserves the rollback policy, and acknowledgement/conflict rendering suppresses stale transient error text. The host still owns uncertain remote outcomes and atomic revision application; switching UI cannot cancel a commit already attempted. IDs must remain stable across remounts when the host retries uncertain work. This component does not provide persistence, authorization, durable receipts, provider recurrence, time-of-day semantics, RRULE support, or distributed exactly-once guarantees.

## Offline verification

Run from the repository/worktree root with normal repository dependencies already installed. These configs use explicit owned files and never load root Jest setup or discover root TypeScript config.

```sh
timeout 180s node --max-old-space-size=1024 node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r9-b04/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r9-b04/burn4-model.test.ts src/__tests__/burn4-tg3r9-b04/burn4-completion-ui.test.tsx

timeout 180s node --max-old-space-size=1024 node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r9-b04/burn4-tsconfig.json --noEmit --incremental false

timeout 180s node --max-old-space-size=1024 node_modules/eslint/bin/eslint.js --no-config-lookup --config src/__tests__/burn4-tg3r9-b04/burn4-eslint.config.mjs --max-warnings=0 src/lib/burn4-recurring-task.ts src/components/tasks/burn4-recurring-task-completion.tsx src/__tests__/burn4-tg3r9-b04/burn4-fixtures.ts src/__tests__/burn4-tg3r9-b04/burn4-model.test.ts src/__tests__/burn4-tg3r9-b04/burn4-completion-ui.test.tsx src/__tests__/burn4-tg3r9-b04/burn4-jest.config.cjs src/__tests__/burn4-tg3r9-b04/burn4-eslint.config.mjs
```

The two explicit suites have 108 ordinary passing cases, zero failures/skips and no KNOWN GAP expected failures. All runtime exports have behavior coverage. Tests use synthetic local state and deferred host fakes; no services, actual family data, browser, provider, database or environment values are used. jsdom establishes rendered controls, state and focus behavior; it does not establish real browser/device, visual, physical keyboard or assistive-technology behavior. No full application suite was run.

KNOWN GAP: None found in the new feature. Needs-decision: None within this standalone scope. Current app integration and persistence remain future work; this package does not close the native recurring-task follow-up end to end.
