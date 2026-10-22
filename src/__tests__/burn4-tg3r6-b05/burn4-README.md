# Recipe source and photo migration behavior

This package runs the unchanged `drizzle/0012_photo_source_priority_dedup.sql`
and `drizzle/0014_recipe_sources.sql` against pinned PGlite 0.5.11. It adds no
application dependency and changes no migration or root configuration.

The two explicit files contain 49 ordinary behavior cases and one confirmed
KNOWN GAP expected failure. The final focused run has no failures or skipped
cases. Strict scoped TypeScript, including checkJs for the optional inversion
helper, and focused ESLint pass.

## Install and run

Run these commands from the repository root after installing its normal test
dependencies. Dependency installation uses no lifecycle scripts. The cache path
can point to any disposable local directory.

```sh
npm ci --prefix src/__tests__/burn4-tg3r6-b05 --cache /tmp/burn4-pglite-cache --ignore-scripts --no-audit --no-fund
node --experimental-vm-modules --max-old-space-size=768 node_modules/jest/bin/jest.js --runInBand --testMatch '**/burn4-tg3r6-b05/burn4-*.pglite.ts' --runTestsByPath src/__tests__/burn4-tg3r6-b05/burn4-photo.pglite.ts src/__tests__/burn4-tg3r6-b05/burn4-recipes.pglite.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r6-b05/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r6-b05/burn4-harness.ts src/__tests__/burn4-tg3r6-b05/burn4-photo.pglite.ts src/__tests__/burn4-tg3r6-b05/burn4-recipes.pglite.ts src/__tests__/burn4-tg3r6-b05/burn4-gap-inversion.cjs --max-warnings 0
```

Jest needs `--experimental-vm-modules` for the engine's dynamic import. The
package uses the existing root Jest configuration with an explicit test pattern,
explicit paths and in-band execution. The `.pglite.ts` files stay outside normal
root Jest discovery; the opt-in command supplies their required engine flags.
It never invokes Playwright or discovers another test suite.
The harness resolves the optional runtime through package-local `createRequire`
only when a test opens an engine. Its small strict TypeScript interface covers
the operations used here without statically importing optional runtime types.
The package's scoped typecheck also passes when its child dependencies are absent.

Default-discovery exclusion can be checked without running any suite:

```sh
node node_modules/jest/bin/jest.js --runInBand --listTests --runTestsByPath src/__tests__/burn4-tg3r6-b05/burn4-photo.pglite.ts src/__tests__/burn4-tg3r6-b05/burn4-recipes.pglite.ts --json
```

The result is `[]`. The explicit engine command above runs all 50 cases.

## Contracts exercised

- Historical and new photo-source priority defaults, integer boundaries, null
  rejection, preference ordering and preserved user priorities.
- Historical photos with unknown identity, cross-source duplicate keys,
  Unicode character limits and indexed key lookup after replay.
- Existing local recipes, required source metadata, enabled/time defaults,
  safe JSON preferences and diagnostics, and provider/name/remote-ID lengths.
- Unique source plus remote-ID matching, independent identities in different
  sources, empty strings, every nullable identity combination, exact case and
  Unicode identity, and conflict updates through a fixture-authored upsert.
- Creator and recipe-source foreign keys, creator/source deletion with SET
  NULL, retained recipe metadata and isolation from unrelated sources.
- Populated and partial-schema replay, duplicate legacy-data rejection,
  missing prerequisite errors and caller-controlled transaction rollback.

The upsert and transaction wrappers are fixture queries that test capabilities
of the source-created schema. They are not application sync or migration-runner
coverage. Photo read-time dedup selection is also outside these SQL files.

## KNOWN GAP

`0014` searches `information_schema.table_constraints` by constraint name and
table name without schema identity. A valid foreign key named
`recipes_source_id_recipe_sources_id_fk` on `fixture_shadow.recipes` therefore
causes the migration to omit the foreign key on `public.recipes`. The engine
then accepts a dangling public recipe source.

The setup first confirms that the shadow constraint rejects a dangling source.
It executes the actual migration, attempts the public insertion and accepts
only the intended foreign-key rejection shape. Engine and setup errors occur
outside the expected-failure body. The sole inverted assertion requires the
public insertion to have been rejected. A later source fix will make the
expected-failure case unexpectedly pass and fail the normal run.

To repeat the direct inverse proof without changing any file, run:

```sh
node --experimental-vm-modules --max-old-space-size=768 node_modules/jest/bin/jest.js --runInBand --testMatch '**/burn4-tg3r6-b05/burn4-*.pglite.ts' --runTestsByPath src/__tests__/burn4-tg3r6-b05/burn4-recipes.pglite.ts --testNamePattern 'KNOWN GAP' --setupFilesAfterEnv ./src/__tests__/burn4-tg3r6-b05/burn4-gap-inversion.cjs
```

This command intentionally exits 1 with one failure showing expected
`rejected` and received `accepted`. The other 34 recipe cases are filtered out
for this proof only. The optional helper converts expected failures into
ordinary cases solely when explicitly passed as Jest setup.

## Isolation and limits

Each file opens one `new PGlite()` with no storage path or connection, resets
synthetic schemas between cases and closes the engine in `afterAll`. The only
source reads are the two owned migration targets. Prerequisite tables are
minimal fixtures; no application schema, seed, provider, migration runner or
environment file is imported. IDs are explicitly synthetic, URLs use a
reserved example domain and no host is contacted. Queries specify safe
columns. Sensitive source columns remain unused and null.

PGlite provides real PostgreSQL constraint and transaction behavior inside the
test process. These tests do not verify a running server, deployment,
application sync behavior or UUID generation defaults. Needs-decision: none.
