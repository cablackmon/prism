# Demo reset orchestration coverage

This package runs the unchanged `scripts/demo-reset.sh` with disposable local
command fakes. It adds 20 cases: 18 ordinary passes, including two fake boundary
calibration cases, and two confirmed expected failures. No cases are skipped.

The tests cover default and configured container names, empty-value fallbacks,
literal SQL heredoc construction, public-schema selection, migration bookkeeping
exclusion, quoted identifiers, empty-table guards, identity resets, mounted seed
selection, cache invalidation order, command output, progress output and immediate
stops after truncate, seed or cache command failure.

The migration and SQL cases inspect generated SQL. They do not execute PostgreSQL
or prove SQL behavior against a database. In particular, the known stdin defect
means the current script does not deliver its generated truncate SQL to psql.

## Isolation

Each invocation starts `/bin/sh` with an explicit environment containing only the
fake command directory and harmless container-name overrides. It does not inherit
the caller environment. `docker` and `date` resolve only to fixture executables
with an absolute Node shebang. The Docker fake rejects unapproved arguments and
never invokes Docker, psql, Redis or another service. Every child has a timeout.
Fixtures are removed after each test. No source rewriting or path relocation is
needed, and the production script is unchanged.

The fake records stdin offered to the Docker CLI separately from stdin delivered
to its inner command. It forwards input only with `-i` or `--interactive`.
Calibration cases verify both branches. Empty psql input exits successfully in
the model, matching the silent reset failure being tested.

## Run

From the repository root, after installing the repository dependencies:

```sh
./node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s05/burn4-demo-reset.test.ts --cacheDirectory /tmp/burn4-tg3r3-s05-jest
./node_modules/.bin/eslint src/__tests__/burn4-tg3r3-s05/burn4-demo-reset-fixture.ts src/__tests__/burn4-tg3r3-s05/burn4-demo-reset.test.ts --max-warnings=0
./node_modules/.bin/tsc --project src/__tests__/burn4-tg3r3-s05/burn4-tsconfig.json
```

Focused Jest, ESLint with zero warnings, and strict scoped TypeScript all pass.
TypeScript checks only the tests and their fixture helper. The production source
is shell and is outside the TypeScript check. No full suite or repository-wide
typecheck is claimed.

## KNOWN GAP

- **Truncate SQL never reaches psql because `docker exec` omits `-i`.** The
  heredoc reaches the Docker CLI, but its noninteractive inner process receives
  empty stdin. The script still reapplies the seed, flushes Redis and reports
  success. One `test.failing` case expects the complete SQL to reach psql. A
  lane-local copy with expected-failure inversion removed fails at that exact
  equality assertion: expected the complete `DO $$` block, received `""`.
- **psql invocations omit `ON_ERROR_STOP`, so SQL errors need not stop the reset.**
  Both database command invocations lack the fail-fast option that lets the shell
  observe script statement failures. One `test.failing` case checks the desired
  `ON_ERROR_STOP=1` invocation contract for both commands. Its inverse probe fails
  at the exact assertion: expected `[true, true]`, received `[false, false]`.
  The fake does not model server-side SQL execution or its errors. PostgreSQL
  documents the variable's effect on continued processing and exit status in the
  [psql manual](https://www.postgresql.org/docs/current/app-psql.html#APP-PSQL-ON-ERROR-STOP).

Needs-decision items: none. The script defect is documented for a later reviewed
production fix; this package adds tests only.
