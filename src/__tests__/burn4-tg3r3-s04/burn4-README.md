# Offline database clear command coverage

Source under test: `scripts/db-clear.sh`. The shell source runs unchanged. This package adds tests only.

The 20 tests comprise 14 ordinary passes and 6 expected-failure cases for 3 underlying defects. Coverage includes the default and `--keep-users` modes, repeated flags, all 20 listed content tables, dependency order, separate content/user phases, schema preservation, displayed seed guidance, missing command, process failures, SQL failures and retained fixture data. SQL arguments and stdin are recorded by a local fake.

## Run

From the repository root after installing the repository dependencies:

```sh
node node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s04/burn4-db-clear.test.ts --cacheDirectory /tmp/burn4-tg3r3-s04-jest
node node_modules/.bin/eslint src/__tests__/burn4-tg3r3-s04/burn4-db-clear-harness.ts src/__tests__/burn4-tg3r3-s04/burn4-db-clear.test.ts --max-warnings=0
node node_modules/.bin/tsc --project src/__tests__/burn4-tg3r3-s04/burn4-tsconfig.json
```

TypeScript checks only this package's tests and harness. Production source is shell. Lint is scoped to these new TypeScript files.

## Isolation and limits

The harness runs `/bin/sh` with an empty child environment plus a fixture-only `PATH`. That path contains only the fake `psql`, whose shebang is the absolute running Node executable. No host command fallback is available. The source needs no filesystem relocation. Fixtures contain table names and numeric row counts, with no real database, family records, credentials or env files. A five-second timeout bounds every shell invocation. Fixture files are removed in `finally`.

The fake models direct truncation and psql error handling. It does not implement PostgreSQL, foreign-key cascades or rollback. Retention assertions use explicitly listed tables; omitted-content cases use tables that cannot be reached by truncating the listed content tables while users are preserved. The independent birthday tombstone has no foreign keys. These are command-boundary tests and do not establish live database behavior.

The fake distinguishes stdin scripts from `-c` command mode. Stdin processing continues after a SQL error unless `ON_ERROR_STOP` is enabled, as described by the [official psql documentation](https://www.postgresql.org/docs/17/app-psql.html#APP-PSQL-VARIABLES). A failed single SQL command returns failure in the upstream [psql startup implementation](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/bin/psql/startup.c), in its `ACT_SINGLE_QUERY` branch. No database client runs in these tests.

## KNOWN GAP list

- Unknown arguments start destructive clearing instead of rejecting the input. Three cases cover a misspelled preservation flag, `--help` and an unexpected positional argument. Each intends zero SQL calls; the unchanged script makes two calls.
- The content phase omits `ON_ERROR_STOP`. An injected content SQL error is followed by later truncations, user deletion and the final success message. One case expects the command to stop before users and final success.
- The content table list omits newer user content. Two cases cover preserved users and default clearing. `recipes`, `travel_trips`, `weekend_places` and `dismissed_birthdays` remain when keeping users. Independent `dismissed_birthdays` also remains in default mode.

The last defect follows the script's written promise to clear user-created data while preserving schema. Table definitions were checked read-only in eligible migrations: `drizzle/0000_upgrade.sql` defines recipes, `drizzle/0005_travel_trips.sql` defines trips, `drizzle/0006_weekend_ideas.sql` defines places, and `drizzle/0023_dismissed_birthdays.sql` defines independent birthday tombstones. Migrations are contract evidence, not additional source coverage. Excluded `src/lib/db` modules are not tested or claimed by this package.

Every expected-failure test has one intended assertion. The lane-local raw probe removes Jest's failure inversion and confirms six assertion failures, without setup failures. Multiple cases for one defect are counted as cases, not separate defects.

Needs-decision: none. The gaps are pinned for later review; existing source is unchanged.
