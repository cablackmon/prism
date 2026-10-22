# Atomic shopping item batches

The new production route `POST /api/shopping-items/batch` creates a prepared
ingredient list with one bounded request. The written follow-up is
`docs/features/RECIPES.md:222-224`: sequential ingredient adds can exhaust the
single-item rate limit, and a properly batched endpoint is planned.

The existing recipe button still calls the single-item endpoint. This package
adds the batch API without changing that client or any existing application file.

## Request

Use an authenticated parent or child session, or existing full API authority.
Guest sessions and API authority without `*` receive 403. Authentication happens
before reading the body or accessing the database. One request consumes one
`shopping-item-batches` rate-limit charge, capped at 30 requests per 60 seconds
per authenticated user.

Send `Content-Type: application/json` and a body shaped like this synthetic data:

```json
{
  "listId": "10000000-abcd-4000-8000-000000000001",
  "items": [
    { "name": "1/2 cup rice", "category": "Pantry" },
    { "name": "Milk", "quantity": 2, "unit": "carton", "notes": "Synthetic example" }
  ]
}
```

There must be 1 through 200 items and one valid list UUID. UUID case is normalized
before comparison with PostgreSQL values. Every request object is strict. Item
fields are limited to `name`, `quantity`, `unit`, `category` and `notes`. Name must
contain nonwhitespace text and have at most 255 UTF-16 code units; optional unit
and category have at most 50 each, and notes at most 500. Quantity must be an
integer from 1 through 2147483647. PostgreSQL-incompatible NUL and lone Unicode
surrogates are rejected. Valid Unicode, empty optional text, whitespace in
nonblank names and duplicate items are preserved. Prepared ingredient strings
are not parsed, merged, deduplicated or scaled. Caller-supplied attribution,
record IDs, checked state, recurrence and provider fields are rejected.

The body cap is 512 KiB measured in UTF-8 bytes while consuming the request
stream. A fixed-size buffer bounds retained bytes. `Content-Length` is not
trusted. Overflow cancels the reader without waiting for transport cleanup.
Invalid media returns 415, overflow 413, and invalid JSON or fields 400. Validation
issues contain paths and codes without reflecting submitted values.

Adding remains available across family shopping lists, including assigned lists.
The existing assignment rule restricts checking items off. This endpoint creates
unchecked rows and does not change ownership or checkoff permissions. Attribution
always comes from the authenticated user.

## Persistence and response

A single transaction locks the target list with `FOR KEY SHARE`, inserts all
items in one statement, validates the public returned row contract, and inserts
one audit row per item in one statement. Audit summaries contain fixed text,
not ingredient names or notes. Ordinary generated item UUIDs let the response
preserve input order even when `RETURNING` supplies rows in another order.

Missing lists return 404 without item writes. A rejected select, item insert,
audit insert, returned-data check or commit returns a fixed 500 error. Transaction
rejection rolls back the staged work. This uses the existing transaction API;
no custom transaction or retry framework is introduced.

After commit the route invalidates `shopping-lists` once. Success returns 201
with `items` and `count`. Items contain `id`, `listId`, `name`, `quantity`, `unit`,
`category`, `checked`, `recurring`, `recurrenceInterval`, `notes` and ISO
`createdAt`. Cache failure still returns saved rows with 201 and a
`CACHE_INVALIDATION_FAILED` warning telling the caller to refresh and not
resubmit. It does not turn a committed write into a reported rollback.

There is no cross-request idempotency. Replaying a request can create duplicate
rows. A lost response or connection failure during commit can leave its outcome
unknown to the caller, as with the existing transaction transport. Do not infer
that a 500 or network failure proves no commit happened, and do not automatically
retry a failed or unobserved request. A received 201 confirms the saved result.

## Offline verification

Only this new route and the package's own files execute. Exact-name virtual mocks
for auth, DB, schema, rate limiter and invalidation are installed before importing
the route. No existing app module is loaded. The TypeScript project uses local
ambient declarations, an actual installed `PostgresJsDatabase` type and precise
test-owned table types. It has no root config, alias discovery or broad includes.

The declarations were checked by read-only inspection against these signatures:

- `requireAuth(): Promise<AuthResult | NextResponse>`; auth contains user ID,
  parent/child/guest role and optional scope names.
- `rateLimitGuard(userId, endpoint, maxRequests, windowSeconds)` returns a
  nullable denial response.
- `invalidateEntity('shopping-lists')` returns `Promise<void>`; the production
  signature also permits a visited-set argument that the route does not use.
- The production DB is a typed Drizzle PostgreSQL client with transaction,
  select/lock, multirow insert and explicit returning methods.
- Item and audit columns match the inspected public contract in
  `src/lib/db/schema.ts:470-507,951-959`. The fixture defines only columns needed
  to compile route SQL, plus an unused source identity to test output exclusion.

The transaction fake stages item and audit rows, commits only on successful
callback/commit, and discards staged work on injected rejection. A real Drizzle
SQL builder compiles the route's actual queries using the local fixture. Its
transport throws if executed. Tests check SQL locking, bound parameters, two
multirow insert statements and the explicit public returning projection.

These are route behavior and emitted-SQL checks. They do not prove real
PostgreSQL locking, transport outcomes, concurrency or database rollback.
No provider, Redis service, actual database, network request, credential, real
family data, application bootstrap or existing suite is used.

Run from this package's worktree with the shared dependency directory available:

```sh
timeout 180s node --max-old-space-size=1024 node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r9-b07/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r9-b07/burn4-route.test.ts src/__tests__/burn4-tg3r9-b07/burn4-db-contract.test.ts
timeout 180s node --max-old-space-size=1024 node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r9-b07/burn4-tsconfig.json --noEmit --incremental false
timeout 180s node --max-old-space-size=1024 node_modules/eslint/bin/eslint.js --no-config-lookup --config src/__tests__/burn4-tg3r9-b07/burn4-eslint.config.mjs --max-warnings=0 src/app/api/shopping-items/batch/route.ts src/__tests__/burn4-tg3r9-b07/burn4-app-contracts.d.ts src/__tests__/burn4-tg3r9-b07/burn4-db-fixture.ts src/__tests__/burn4-tg3r9-b07/burn4-harness.ts src/__tests__/burn4-tg3r9-b07/burn4-route.test.ts src/__tests__/burn4-tg3r9-b07/burn4-db-contract.test.ts src/__tests__/burn4-tg3r9-b07/burn4-jest.config.cjs src/__tests__/burn4-tg3r9-b07/burn4-eslint.config.mjs
git diff --check
```

Expected: 107 tests pass in two files, no skips or expected failures. The tests
cover authorization before body access, rate accounting, streamed limits and
cleanup errors, exact input boundaries, UTF-8 and PostgreSQL text constraints,
malformed final rows, list lookup, ordering, attribution, transactional failures,
corrupt returned rows, per-item audit data and postcommit cache warnings.

KNOWN GAP: None identified in the new implementation.
Needs-decision: None.
Limits: existing UI stays sequential; no cross-request idempotency, automatic
retry, recipe parsing/scaling, provider transport or live database assurance.
