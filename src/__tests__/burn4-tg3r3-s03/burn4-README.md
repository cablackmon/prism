# Restore command behavior

This package adds offline behavior coverage for `scripts/restore.sh`. Production source is unchanged. The fixture copies its text and relocates only the usage listing glob `/backups/prism_*.sql.gz` into a disposable `/tmp/burn4-prism-restore-*` directory.

The 23 accepted cases contain 19 ordinary passes and 4 expected failures, with no ordinary failures or skips. They cover missing, empty, absent and directory inputs; fixture backup listings; filenames containing spaces and shell syntax; relative paths; cancellation wait failure; SQL target selection and phase order; complete payload delivery; backup preservation; nonzero client failures at every SQL phase; and single-command SQL errors before the load phase.

Every child receives an explicit environment containing only a fixture PATH and empty password configuration. The PATH contains fake psql, gunzip, sleep and date executables plus the allowlisted local `/bin/ls`. The shell is `/bin/sh`; Node runs the fakes by its absolute executable path. Real sleep, database tools, containers and network tools cannot be resolved through the fixture PATH. Fake gunzip uses Node's local gzip decoder for normal and corrupt fixtures. All SQL is recorded locally. Cleanup removes each temporary fixture, and each shell child has a four-second timeout.

The psql fake distinguishes single-command SQL errors from stdin script errors. Its single-command mode exits 1 on an SQL error. Its stdin mode exits 0 on an SQL error unless ON_ERROR_STOP is set, in which case it exits 3. This models the distinction in PostgreSQL's [startup.c](https://doxygen.postgresql.org/bin_2psql_2startup_8c_source.html) and [mainloop.c](https://doxygen.postgresql.org/mainloop_8c_source.html), along with the [psql error handling contract](https://www.postgresql.org/docs/current/app-psql.html). It does not parse SQL or connect to a database.

Run from the repository root after dependencies are already available:

```sh
node node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s03/burn4-restore.test.ts --cacheDirectory /tmp/burn4-s03-jest-cache
node node_modules/.bin/eslint src/__tests__/burn4-tg3r3-s03/burn4-restore-harness.ts src/__tests__/burn4-tg3r3-s03/burn4-restore.test.ts --max-warnings=0
node node_modules/.bin/tsc --project src/__tests__/burn4-tg3r3-s03/burn4-tsconfig.json
```

Focused lint passed with zero warnings. Strict scoped TypeScript passed for the tests and harness only; Bash source is outside TypeScript's scope. No full suite, repository build or real PostgreSQL restore is claimed. Cancellation is modeled through a failing fake wait exit status, including status 130; it is not an interactive terminal signal test.

## KNOWN GAP list

- A failed decompressor is hidden by successful psql at the end of the pipeline. Two expected-failure cases cover invalid gzip and a corrupt trailer after partial SQL output. Both observe exit 0 where nonzero is required.
- Corrupt input is not validated before destructive work. The existing database is dropped and recreated before decompression reports invalid gzip. One expected-failure case requires that the drop phase be absent.
- Stdin SQL statement errors are accepted because the load invocation does not set ON_ERROR_STOP. One expected-failure case observes exit 0 despite an SQL error diagnostic.

All four expected-failure cases were independently run after removing expected-failure inversion. They failed at their intended status or recorded-phase matcher. The lane evidence is `state/s03/gap-probe.json` and `state/s03/gap-probe.log` in the burn lane. These are four cases for three defects.

## Needs-decision list

None.
