# Sync restoration and source lifecycle endpoints

Plan revision 2, round 2 package p14. This package exercises unchanged current
master source at `5452b7c6cef8f9b3d9b5e936c748822e2a28535a`:

- `src/app/api/calendars/removed/route.ts`: GET and POST.
- `src/app/api/birthdays/sync/route.ts`: POST.
- `src/app/api/recipe-sources/[id]/route.ts`: DELETE.

No direct endpoint tests existed. The existing tombstone tests cover value
normalization; this package mocks that service and tests route behavior instead.

Run only this package from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p14/burn4-routes.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p14/burn4-fakes.ts src/__tests__/burn4-p14/burn4-routes.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p14/burn4-tsconfig.json
```

Focused coverage command, with the literal bracket route escaped for the glob:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p14/burn4-routes.test.ts --coverage --collectCoverageFrom=src/app/api/calendars/removed/route.ts --collectCoverageFrom=src/app/api/birthdays/sync/route.ts '--collectCoverageFrom=src/app/api/recipe-sources/[[]id]/route.ts'
```

The suite has 57 cases: 54 ordinary passing cases and three named expected
failures. None are skipped. Focused ESLint and the scoped TypeScript project
pass. All three route modules measure 100% statements, lines, functions, and
branches. Only these explicit package tests were run.

Authentication tests check that every handler returns the exact denial response
before dependencies run. Removed-calendar routes require `canModifySettings`;
recipe disconnection requires `canManageIntegrations`. Tests cover parent
permission delegation, child and guest denials, insufficient explicit scopes,
and denial before body parsing or route-parameter resolution. Authentication and
role internals are mocked excluded dependencies. Birthday sync retains its
existing authentication-only contract; no new role policy is assumed.

Calendar tests list the correct tombstone namespace, restore only the requested
ID, preserve other namespaces and entries, observe persisted changes through a
subsequent GET, handle repeated restore, validate ordinary missing/non-string
IDs, await persistence, and report settings failures. Birthday tests verify
`added + updated` accounting separately from considered totals, omitted empty
errors, ordered partial errors without mutation, awaited detection, provider or
database failures, and authentication lookup failures.

Recipe tests assert that only `recipeSources` is deleted using the awaited path
ID. The in-memory persistence model preserves recipes and models the schema's
`ON DELETE SET NULL` effect, including neighboring sources and local recipes.
It compiles the real Drizzle equality predicate and models a PostgreSQL `22P02`
error for the malformed UUID fixture. Parameter and database failures, deferred
deletion, idempotency, and unauthorized operations are covered. These tests do
not verify the real database's foreign-key implementation or complete UUID
syntax.

Next responses use a small Response subclass with native JSON serialization.
All authentication, logging, detection, tombstone, and database dependencies are
pure fakes. The excluded real dependency modules never load. No host environment
values, real family data, credentials, disk effects, provider calls, or hosted
databases are used.

## KNOWN GAP

- Malformed JSON in calendar restoration is reported as a server error. A client
  parse error is caught by the generic restore catch and becomes 500. The test
  asserts 400 and confirms no tombstone mutation was attempted.
- A null restoration body is reported as a server error. Destructuring JSON null
  throws before the required-ID check. The test asserts a client error 400 with
  no restore attempt.
- Invalid recipe source UUIDs reach PostgreSQL and become server errors. The
  handler sends `not-a-uuid` into the UUID comparison; the modeled database
  rejects it with `22P02`, and the route returns 500. The test asserts 400 before
  database access while preserving source state.

All three expected failures were also run as ordinary tests. The saved raw probe
log shows each fails at its intended 400-status assertion, receiving 500, after
working dependency checks. The temporary probe copy was removed.

## Needs decision

None. These tests pin production defects for separate reviewed fixes.
