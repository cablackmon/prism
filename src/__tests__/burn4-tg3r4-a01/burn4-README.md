# Offline MCP tools and API boundary coverage

Target: `.mcp/src/index.ts` at base master `5452b7c6cef8f9b3d9b5e936c748822e2a28535a`.

196 accepted cases: 184 ordinary passes and 12 confirmed expected failures across eight defect groups. Four explicit test files run in band. There are no snapshots or skipped cases in the normal run.

The suite invokes all 33 registered handlers through their real Zod input declarations. It covers default and complete bodies, optional list filters, false and zero values, nullable updates, invalid input, HTTP methods and paths, object/array/scalar/text output, HTTP and response-read failures, transport rejection, startup configuration, fake stdio connection rejection, independent VM instances and reversed concurrent responses.

The harness reads and transpiles the unchanged eligible source, removes only the executable shebang from emitted JavaScript, and wraps that output to support top-level await in a VM. Imports allow only fake MCP server and transport classes plus the locally installed real Zod. Fetch and process are wholly synthetic. The authentication presence guard receives an opaque object with empty coercion. Request headers are never recorded or asserted. No real environment, SDK connection, stdio process, database or network is used.

Strict scoped TypeScript checks the tests, fixtures and harness. It does not typecheck the source loaded as a string or establish compatibility with the actual MCP SDK transport. The local consumer fixtures model only required fields, accepted update methods, quantity type and meal range filtering. They are not full API implementations. The excluded API source and validators were inspected read-only for provenance, and are never imported or executed by these tests. Current mapping tests document emitted requests; the separate expected-failure cases identify where those requests cannot satisfy consumers.

## Run from repository root

Dependencies must already be installed. These are the exact focused validation commands used by this lane:

```sh
node_modules/.bin/jest --runInBand --cacheDirectory /home/cameronblackmon/burn-lanes/codex-tg3r4/state/a01/jest-cache --runTestsByPath src/__tests__/burn4-tg3r4-a01/burn4-mcp-handlers.test.ts src/__tests__/burn4-tg3r4-a01/burn4-mcp-validation.test.ts src/__tests__/burn4-tg3r4-a01/burn4-mcp-boundaries.test.ts src/__tests__/burn4-tg3r4-a01/burn4-mcp-gaps.test.ts
node_modules/.bin/eslint src/__tests__/burn4-tg3r4-a01/*.ts --max-warnings=0
node_modules/.bin/tsc --project src/__tests__/burn4-tg3r4-a01/burn4-tsconfig.json --noEmit --incremental false
```

The cache location can be replaced with another writable local directory on another machine.

## KNOWN GAP list

Twelve cases cover eight defect groups. Fixture provenance is recorded next to each contract in `burn4-mcp-consumer-contract.ts`.

1. `complete_chore` emits `userId`; the consumer requires `completedBy`. One case. Source contract: `src/lib/validations/index.ts:82` and `src/app/api/chores/[id]/complete/route.ts:103`.
2. `create_maintenance_item` exposes `dueDate` and `frequency`, and cannot forward required `category`, `schedule` and `nextDue`. One case. Contract: `src/lib/validations/index.ts:165` and `src/app/api/maintenance/route.ts:134`.
3. `create_meal` exposes `date`, and cannot forward required `weekOf` and `dayOfWeek`. One case. Contract: `src/lib/validations/index.ts:122` and `src/app/api/meals/route.ts:137`.
4. `create_goal` emits `title` and `targetPoints`; the consumer requires `name` and `pointCost`. One case. Contract: `src/lib/validations/index.ts:241` and `src/app/api/goals/route.ts:147`.
5. `post_message` emits `content`; the consumer requires `message`. One case. Contract: `src/app/api/messages/route.ts:179`.
6. Four update tools use PUT for PATCH-only endpoints: chores, tasks, events and shopping items. Four cases. Route exports: `src/app/api/chores/[id]/route.ts:134`, `src/app/api/tasks/[id]/route.ts:171`, `src/app/api/events/[id]/route.ts:139` and `src/app/api/shopping-items/[id]/route.ts:42`.
7. Shopping add and update declarations reject positive integer quantities required by the consumer, accepting strings instead. Two cases. Contract: `src/lib/validations/index.ts:107` and partial update at line 116.
8. `list_meals` emits `startDate` and `endDate`, while the consumer reads `from` and `to`. The requested range is ignored and outside-range entries remain. One case. Contract: `src/app/api/meals/route.ts:42` and inclusive filtering at line 87.

Every expected failure was copied to a temporary owned test file with only `test.failing` changed to `test`. Running that file with the KNOWN GAP name filter produced exactly 12 failures at the intended assertions. The temporary file was removed before commit. Normal cases separately verify each fixture's positive control and the emitted request failure. No production fix is included.

Needs-decision list: None.
