# Provider registry and connection status tests

These offline tests exercise the unchanged current master source at `5452b7c6cef8f9b3d9b5e936c748822e2a28535a`:

- `src/lib/sync/adapters/tandoorSource.ts`
- `src/lib/integrations/tasks/index.ts`
- `src/lib/integrations/shopping/index.ts`
- `src/lib/integrations/wish-items/index.ts`
- `src/app/api/integrations/oauth-status/route.ts`
- `src/app/api/integrations/kroger/status/route.ts`
- `src/app/api/integrations/kroger/disconnect/route.ts`

`burn4-source.test.ts` tests both source resolver exports: source-id filtering, provider validation, missing connection fields, failed storage reads and failed decryption. The predicate-aware database fake distinguishes unrelated sources and users.

`burn4-registries.test.ts` exercises the real registry modules, their exported provider identities and maps, supported and unknown lookups, distinct implementations for shared identifiers and lookup mutation safety. Provider implementations are mocked before import. Existing provider-auth tests mock the registry, so they do not cover these lookup behaviors.

`burn4-connections.test.ts` exercises all three route handlers: authentication responses, concurrent OAuth configuration checks, configuration booleans without configuration fields, user-scoped Kroger connection metadata, nullable fields, expiry serialization, authentication/configuration/storage failures, waiting for disconnect deletion and safe error bodies. Existing adjacent provider tests do not exercise these route contracts.

All provider implementations, authentication, credential stores, crypto, logging and database access are faked. The NextResponse boundary uses a Response-backed test class supporting JSON responses and authentication `instanceof` checks. Tests cover route logic, not a running Next.js server. Configuration fixtures are inert synthetic objects. The tests do not read host environment values or contact services. No source files are changed.

Run from the repository root using its existing dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p05/burn4-source.test.ts src/__tests__/burn4-p05/burn4-registries.test.ts src/__tests__/burn4-p05/burn4-connections.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p05/burn4-fixtures.ts src/__tests__/burn4-p05/burn4-source.test.ts src/__tests__/burn4-p05/burn4-registries.test.ts src/__tests__/burn4-p05/burn4-connections.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p05/burn4-tsconfig.json --pretty false
```

For coverage, append these arguments to the Jest command:

```sh
--coverage --collectCoverageFrom='src/lib/sync/adapters/tandoorSource.ts' --collectCoverageFrom='src/lib/integrations/tasks/index.ts' --collectCoverageFrom='src/lib/integrations/shopping/index.ts' --collectCoverageFrom='src/lib/integrations/wish-items/index.ts' --collectCoverageFrom='src/app/api/integrations/oauth-status/route.ts' --collectCoverageFrom='src/app/api/integrations/kroger/status/route.ts' --collectCoverageFrom='src/app/api/integrations/kroger/disconnect/route.ts'
```

Validation: 50 ordinary passing tests and 3 named expected failures, 53 total, no skips. Jest reports all 53 as passed because `test.failing` inverts the expected failures. Focused coverage is 100% statements, branches, functions and lines for all seven target modules. Coverage includes the expected-failure cases and does not mean the defects are fixed. Scoped ESLint and TypeScript checks pass. The TypeScript project checks these tests and their imported source graph; no full test suite or whole-repository check was run.

## KNOWN GAP

- **Task registry accepts inherited constructor as a task provider.** `getTaskProvider('constructor')` returns the inherited Object constructor instead of `undefined`.
- **Shopping registry accepts inherited constructor as a shopping provider.** `getShoppingProvider('constructor')` returns the inherited Object constructor instead of `null`.
- **Wish registry accepts inherited constructor as a wish provider.** `getWishItemProvider('constructor')` returns the inherited Object constructor instead of `null`.

These are named desired-behavior `test.failing` cases. Each was also run as an ordinary test and failed at its sole lookup assertion, receiving `[Function Object]`. Provider imports were mocked successfully. The raw probe log is retained in the lane evidence, with no probe copy in the branch.

## Needs decision

None. The draft records the three lookup defects for review.
