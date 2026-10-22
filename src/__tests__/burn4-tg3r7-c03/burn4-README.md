# Fresh-schema household relational behavior

These offline tests execute the complete unchanged
`src/lib/db/init/02-schema.sql` in fresh in-memory PGlite 0.5.11 databases. Every
database closes in a `finally` block, including bootstrap and assertion failures.
The source checksum is
`7d2d7b5a56723c595242c503cb1ae1f11aff6095d749aeb092e18545a5bf079d`.

The household has two synthetic members, separate ownership and unrelated
control records across calendars/events, chores/completions, messages,
shopping, tasks, recipes/meals, goals, gifts, photos, travel joins, weekend
visits, maintenance, wishes, notes, audit records, bus records, birthdays and
layouts. Actual foreign keys determine which rows cascade and which references
become NULL. Required fields, durable identities, nullable external identities
and ordinary JSON are checked through real inserts, rejected writes and reads.

Only explicit ordinary user/provider columns are written and selected. Before
any fixture rows are inserted, the helper inspects declaration metadata and
requires that all sixteen sensitive columns have no generating default. It
never selects sensitive field values. Source rows omit PIN, email, provider
access, sharing and password fields; a required ordinary server URL uses the
reserved `.invalid` domain as inert text. API credential/token tables stay
empty and have no fixture reads or writes. No real family data, credentials,
process environment values, provider requests or network activity are used.

The package runs no numbered migration, `01-init.sql`, `03-seed.sql`, shell
startup, container or database service. PGlite supplies embedded PostgreSQL
semantics. Deployment, real service configuration, provider synchronization and
container compatibility remain outside this evidence.

## Run from the repository root

Install root development dependencies, then install the package-local optional
runtime with lifecycle scripts disabled:

```sh
npm ci --prefix src/__tests__/burn4-tg3r7-c03 --ignore-scripts --no-audit --no-fund
```

Run the four explicit owned suites in one process:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r7-c03/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r7-c03/burn4-household.pglite.ts src/__tests__/burn4-tg3r7-c03/burn4-constraints.pglite.ts src/__tests__/burn4-tg3r7-c03/burn4-lifecycle.pglite.ts src/__tests__/burn4-tg3r7-c03/burn4-known-gap.pglite.ts
```

This PGlite version needs Node's VM flag inside Jest and emits its experimental
VM warning. Each case creates and closes its own embedded database. A focused
run can take several minutes.

```sh
node_modules/.bin/tsc --project src/__tests__/burn4-tg3r7-c03/burn4-tsconfig.json
node_modules/.bin/eslint src/__tests__/burn4-tg3r7-c03/burn4-database.ts src/__tests__/burn4-tg3r7-c03/burn4-household.pglite.ts src/__tests__/burn4-tg3r7-c03/burn4-constraints.pglite.ts src/__tests__/burn4-tg3r7-c03/burn4-lifecycle.pglite.ts src/__tests__/burn4-tg3r7-c03/burn4-known-gap.pglite.ts src/__tests__/burn4-tg3r7-c03/burn4-jest.config.cjs src/__tests__/burn4-tg3r7-c03/burn4-gap-inversion.cjs --max-warnings 0
```

The strict project checks TypeScript and CommonJS helpers with
`noUncheckedIndexedAccess`, `isolatedModules` and no emitted/incremental output.
A typed dynamic runtime loader imports no optional package declarations.
Normal root compiler options also pass with optional module resolution denied.
The explicit `.pglite.ts` matcher isolates these tests from normal root Jest
discovery, which finds no c03 cases. Root source and configuration are unchanged.

Validated run: 60 ordinary passes and one confirmed prior-root expected-failure
case, 61 total, zero failures or skips. Focused lint and strict scoped
TypeScript/checkJs pass. The full run completed in about 137 seconds.

## Transaction, trigger and replay boundaries

The transaction case supplies its own BEGIN/ROLLBACK/COMMIT around a
multi-feature operation, verifies a real FK failure leaves no partial rows,
and retries successfully while preserving earlier committed records.

The dump declares `update_updated_at_column` and installs no production
timestamp trigger. A clearly test-owned trigger on a disposable ordinary TEMP
table invokes the actual function. Assertions verify returned NEW values and
transaction-stable `NOW()` without sleeps or wall-clock comparisons.

The full fresh-install dump has unguarded ADD CONSTRAINT statements. Its second
execution rejects with observed SQLSTATE 42P07 for the existing migration-name
unique relation while preserving prior committed data. That result is an
ordinary characterization. No whole-file replay guarantee is assumed, and no
tail is extracted or rewritten to bypass it.

## KNOWN GAP: prior root through a fresh-install path

The recipe-source guard consults `information_schema.table_constraints` using
only table and constraint names. An unrelated `shadow.recipes` relation with a
real same-named foreign key suppresses the intended public source FK during
complete raw bootstrap, allowing an orphan public recipe source UUID.

This repeats the namespace-blind guard root reported for numbered migration
0014 in tg3r6-b05 through a distinct eligible fresh-install source. It is one
prior root, with one desired-contract expected-failure case. Clean bootstrap
rejects the same absent source through ordinary 23503 coverage. The desired
case asserts rejection even when the shadow relation exists; a namespace-safe
source repair makes that exact body pass.

Run the direct inverse to expose its intended assertion failure:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r7-c03/burn4-jest.config.cjs --runInBand --setupFilesAfterEnv=./src/__tests__/burn4-tg3r7-c03/burn4-gap-inversion.cjs --runTestsByPath src/__tests__/burn4-tg3r7-c03/burn4-known-gap.pglite.ts
```

The inversion helper reassigns `test.failing` only in that explicit Jest
process. It intentionally exits one because the orphan insert resolves, after
successful full bootstrap. A separate state-only repair probe applies the
intended namespace qualification in memory and runs the same desired body
successfully; the checked-in source and ordinary coverage remain unchanged.

Needs-decision: none.
