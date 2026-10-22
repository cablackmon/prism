# Offline sync migration behavior tests

This package runs seven unchanged PostgreSQL migrations with the pinned in-process PGlite 0.5.11 engine. It opens no socket, starts no server and creates no persistent database. All prerequisite tables and rows are synthetic. Each test resets the schema, and each test file closes its database after use. The fixture never imports application services, the schema module, the migration runner, seed data, environment files or credential fields.

Covered sources:

- `drizzle/0015_dismissed_events.sql`
- `drizzle/0016_event_pending_deletion.sql`
- `drizzle/0017_event_caldav_href.sql`
- `drizzle/0021_excluded_photos.sql`
- `drizzle/0022_event_location_text.sql`
- `drizzle/0024_dismissed_tasks.sql`
- `drizzle/0025_task_pending_deletion.sql`

The 54 cases comprise 52 ordinary passing tests and two confirmed KNOWN GAP expected failures. They exercise per-source identity uniqueness, case-sensitive and Unicode remote identifiers, rejected null/orphan/overflow values, source deletion cascades, local deletion independence, generated row identities, timestamp persistence, null review defaults, keep-local marker preservation, CalDAV href and ETag character limits, long calendar locations, repeated upgrades and recovery after missing prerequisites. These are database migration guarantees. Application reconciliation, provider requests and whether sync consults these fields are outside this package.

The test-only dependency lives in this private subdirectory. The root dependency manifests and production sources are unchanged. From the repository root, install with lifecycle scripts disabled:

```sh
npm ci --prefix src/__tests__/burn4-tg3r6-b04 --cache /tmp/burn4-tg3r6-b04-npm-cache --ignore-scripts --no-audit --no-fund
```

The run used the same command with the lane cache at `/home/cameronblackmon/burn-lanes/codex-tg3r6/state/npm-cache`. Root development dependencies must already be installed. Run only these two files, in one process:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testMatch '**/burn4-tg3r6-b04/burn4-*.pglite.ts' --runTestsByPath src/__tests__/burn4-tg3r6-b04/burn4-tombstones.pglite.ts src/__tests__/burn4-tg3r6-b04/burn4-event-task-upgrades.pglite.ts
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r6-b04/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r6-b04/burn4-sql-fixture.ts src/__tests__/burn4-tg3r6-b04/burn4-tombstones.pglite.ts src/__tests__/burn4-tg3r6-b04/burn4-event-task-upgrades.pglite.ts --max-warnings=0
```

The `.pglite.ts` filenames keep these opt-in tests outside the root Jest discovery pattern. The fixture loads its optional runtime with createRequire and describes only the query, exec and close methods it uses. There are no static imports or type imports from the private dependency, so normal repository typechecking can inspect these files before that dependency is installed. A strict typecheck of copied source files with no child runtime package also passes.

The explicit testMatch override selects only this package after its separate dependency install. The VM modules flag lets PGlite load its WebAssembly runtime through Jest. It does not start an external service. Typechecking is strict and limited to this package. Lint is limited to the three authored TypeScript files.

Confirm that the normal root configuration excludes both paths without executing any test:

```sh
node node_modules/jest/bin/jest.js --runInBand --listTests --json --runTestsByPath src/__tests__/burn4-tg3r6-b04/burn4-tombstones.pglite.ts src/__tests__/burn4-tg3r6-b04/burn4-event-task-upgrades.pglite.ts
```

The expected listing is `[]`. No root config or normal CI dependency install needs to change.

## KNOWN GAP list

- **0015 namespace-blind FK guard skips the public dismissed_events source constraint.** If a second schema already contains a table named `dismissed_events` and the same named foreign key, the information_schema guard sees that unrelated constraint. The migration creates the public table but omits its source FK, allowing an orphan calendar-source UUID. The desired assertion requires PostgreSQL error `23503` for that orphan insertion.
- **0021 namespace-blind FK guard skips the public excluded_photos source constraint.** The corresponding second-schema constraint causes the same omission for photo tombstones and permits an orphan photo-source UUID. The desired assertion again requires `23503`.

Both gaps require a same-named table and constraint in a second schema. Ordinary single-schema installs enforce the FK and cascade, covered by passing tests. The two desired assertions were first run as ordinary tests: exactly those two failed because orphan inserts resolved successfully; all other 52 cases passed. They then became `test.failing` cases. Setup runs in beforeEach so setup failures cannot satisfy the expected-failure marker. A corrected migration will make the expected-failure case fail as an unexpected pass and signal that it can become an ordinary regression test.

## Needs decision

Decide whether migrations should support namespace collisions from unrelated PostgreSQL schemas. If that is in scope, qualify both FK guards by the target relation schema or relation identity. This PR only records the observed defects and adds tests.
