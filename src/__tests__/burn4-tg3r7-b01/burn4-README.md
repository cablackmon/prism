# Catch-up schema and member-length migration contracts

These offline tests execute the complete, unchanged `drizzle/0000_upgrade.sql`
and `drizzle/0018_user_pin_length.sql` in embedded in-memory PostgreSQL using
`@electric-sql/pglite` 0.5.11. There is no server, connection string, container,
hosted database or application API.

The fixture starts with minimal original tables containing ordinary UUIDs and
synthetic markers. It does not load the full application schema or seed data.
The full schema is read-only context for expected foreign-key actions, including
goal achievements, creators, wishes, bus logs and gifts. This suite is evidence
about catch-up migration behavior, not full application integration.

The tests cover preservation of all eleven original fixture tables, added
defaults and optional fields, existing column values, application entity inserts,
two replays with populated tables, required values, Unicode text bounds, price
precision and overflow, unique identities, queued duplicate callers, migration
failure and repair, and member-length backfill/fallback/error atomicity. The
queued-caller test uses PGlite's serialized query queue and makes no claim about
concurrent transactions on a PostgreSQL server.

The unchanged catch-up SQL also creates credential-bearing tables. The fixture
leaves `api_tokens`, `task_sources`, `shopping_list_sources` and
`wish_item_sources` entirely empty and never reads credential fields. Constraint
cases that require source rows are outside this package. Only digit-count
metadata is used for member-length cases. No PIN, PIN hash, password, secret,
key, token or real family data is created, read or stored by a fixture.

## Run from the repository root

Install the root development dependencies first. Install the optional runtime
with lifecycle scripts disabled:

```sh
npm ci --prefix src/__tests__/burn4-tg3r7-b01 --ignore-scripts --no-audit --no-fund
```

Run only these three suites:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r7-b01/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r7-b01/burn4-catchup.pglite.ts src/__tests__/burn4-tg3r7-b01/burn4-member-length.pglite.ts src/__tests__/burn4-tg3r7-b01/burn4-known-gaps.pglite.ts
```

The Node VM flag is required by this PGlite version when loaded inside Jest.
The runtime emits Node's experimental VM warning. Tests are named `.pglite.ts`
and need the explicit owned configuration. Default repository Jest discovery
does not find them, and no root setup file runs with the owned configuration.

Validation:

```sh
node_modules/.bin/tsc --project src/__tests__/burn4-tg3r7-b01/burn4-tsconfig.json
node_modules/.bin/eslint src/__tests__/burn4-tg3r7-b01/burn4-database.ts src/__tests__/burn4-tg3r7-b01/burn4-catchup.pglite.ts src/__tests__/burn4-tg3r7-b01/burn4-member-length.pglite.ts src/__tests__/burn4-tg3r7-b01/burn4-known-gaps.pglite.ts src/__tests__/burn4-tg3r7-b01/burn4-jest.config.cjs src/__tests__/burn4-tg3r7-b01/burn4-gap-inversion.cjs --max-warnings 0
```

The strict project checks the new TypeScript and CommonJS helpers with
`noUncheckedIndexedAccess`, `isolatedModules`, and no emitted or incremental
artifacts. A typed `createRequire` interface prevents root TypeScript from
resolving optional package declarations. The new TypeScript also passes root
safety flags after being copied into a directory with no optional runtime.
Normal root typechecks do not require the package-local install.

Validated result: 59 ordinary passes and 4 confirmed expected-failure cases,
63 total, with no failures or skips. Focused lint and strict scoped types pass.

## KNOWN GAP defects

1. The catch-up migration omits application foreign keys promised by its
   current-schema contract. Three consolidated desired-contract cases show
   twelve orphan references accepted, four dependent record groups retained
   after parent deletion, and six creator references retained instead of being
   set to NULL. Expected actions come from the current schema's foreign keys;
   no full schema or foreign key is installed by the fixture.
2. Replaying the member-length migration overwrites later per-member choices
   with the legacy family setting. The desired-contract case changes one
   member's length to six after a family backfill of five and expects replay
   to preserve that member's choice.

The source is unchanged. Each gap body asserts the intended repaired behavior;
it can pass when its source defect is fixed. Run the explicit inversion helper
to remove Jest's expected-failure wrapper and expose the four assertion
failures:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r7-b01/burn4-jest.config.cjs --runInBand --setupFilesAfterEnv=./src/__tests__/burn4-tg3r7-b01/burn4-gap-inversion.cjs --runTestsByPath src/__tests__/burn4-tg3r7-b01/burn4-known-gaps.pglite.ts
```

That probe intentionally exits one. The failures are comparisons of captured
SQL outcomes, child counts, remaining creator IDs and member lengths, not
loader failures or a broken fixture. Ordinary cases independently establish
valid setup and data preservation.

Needs-decision: none.
