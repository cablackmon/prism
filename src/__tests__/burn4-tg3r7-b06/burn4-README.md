# Task, message and goal scenario reliability

These offline tests execute the unchanged callbacks and hooks from three E2E modules:

| Source | Scenarios | Hooks | Covered behavior |
| --- | --- | --- | --- |
| `e2e/task-crud.spec.ts` | 5 | 3 | Modal creation, editing, completion reversal, deletion, listing, setup and cleanup |
| `e2e/message-crud.spec.ts` | 5 | 3 | Creation, listing, pin reversal, deletion, cross-author deletion, optional-child setup and cleanup |
| `e2e/goals.spec.ts` | 7 | 3 | Header, populated/empty lists and counters, add control, dialog Escape, API shape and create/delete |

The loader reads only these allowlisted source files and transpiles each into a fresh VM. Fake Playwright, authentication and cleanup modules are installed before evaluation. Original helper implementations never execute. Unknown imports, source paths, selectors, scenario names and API operations fail closed. The VM has no supplied process, fetch or browser object, and runtime string/Wasm generation is disabled. Runtime-boundary tests verify the import and host-global checks.

Synthetic tasks, messages and goals live in local maps. Navigation captures rendered row text; editing requires reload to update that text. A task modal requires an add-button click, title input and submission before closing. Goal dialogs require an add-button click and Escape. Status and body faults are independent so missing HTTP guards remain observable. The fake applies the normal local mutation before substituting its reply; it models a mutation whose reply can be unsuccessful or malformed, not a server transaction implementation.

All 17 original scenarios and nine lifecycle hooks execute. Separate fault cases hide created rows, keep modals open, ignore Escape, change completion/pin results, omit list entries/properties and return unsuccessful statuses. These cases require actual source assertions to reject with matcher results. The other-user message case stays authenticated as the parent and creates a message with the synthetic child's authorId, matching the source. It does not claim child-session creation coverage.

There are 62 ordinary passing cases and 11 confirmed expected-failure cases, with zero failures or skips. A missing-child branch throws a private skip sentinel inside an ordinary passing test; no outer test is skipped. The ordinary count includes 11 in-memory repair sensitivity cases. They apply representative fixes to a source string inside the loader and prove each desired gap contract passes after its defect is repaired. No repository source is written or patched.

## Run from the repository root

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r7-b06/burn4-scenarios.test.ts src/__tests__/burn4-tg3r7-b06/burn4-known-gaps.test.ts src/__tests__/burn4-tg3r7-b06/burn4-oracles.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r7-b06 --max-warnings 0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r7-b06/burn4-tsconfig.json
node --import tsx src/__tests__/burn4-tg3r7-b06/burn4-gap-probe.ts
```

The final command runs the exact desired assertions without `test.failing`. Exit 1 means all 11 assertions failed at their named intended contracts; exit 2 means an unexpected pass or unrelated failure. Each direct failure must contain its `GAP <id>:` marker. The strict scoped typecheck inherits the root settings, retains `noUncheckedIndexedAccess`, and includes every new TypeScript file. Only existing root development dependencies are used. These `.test.ts` files also use the normal root Jest discovery; the standalone probe is not a default test entry.

## KNOWN GAP list

| IDs | Defect and desired behavior |
| --- | --- |
| `setup-task-crud`, `setup-message-crud`, `setup-goals` | Failed parent discovery leaves the temporary setup page open. The page must close while the original rejection remains visible. |
| `cleanup-task-crud`, `cleanup-message-crud` | A first cleanup rejection prevents the edited-title cleanup and logout. Both remaining operations must still run, with failure visible. |
| `message-child-discovery` | Every child discovery error is treated as an absent child. Infrastructure failure must propagate instead of turning a scenario into a skip. |
| `goal-assertion-cleanup` | A failed content assertion after successful creation bypasses the inline goal delete. The created goal must be deleted even if that assertion fails. |
| `task-toggle-create`, `task-delete-create` | These task scenarios consume a rejected creation response and perform later mutations. An unsuccessful prerequisite must stop the sequence before mutation. |
| `message-delete-create`, `message-other-delete-create` | These message deletion scenarios consume a rejected creation response without checking its status. They must stop before deleting any returned id. |

The 11 cases represent six defect groups. They pin existing E2E reliability defects under the new-files-only constraint. They are not production feature tests. Browser rendering, real timing, Playwright retry behavior, services, databases, real family records and original authentication/cleanup helpers are outside this package. Needs-decision items: none.
