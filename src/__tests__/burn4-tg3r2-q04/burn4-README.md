# Migration startup and recovery coverage

These tests execute the unchanged `scripts/migrate.js` in a Node VM. The VM can require only fake `postgres`, `fs` and a pure path join function. Timers resolve immediately. A fake process supplies an opaque Symbol through its configuration getter and throws a local exit signal. No real process environment is read or changed. The SQL fake stages effects and tracking records together, then commits or rolls back both.

Coverage includes connection retry boundaries, client setup and cleanup, absent baseline files, filesystem failures, baseline recording and recovery, pending file filtering and ordering, per-file transaction boundaries, record failures, interrupted-run recovery and repeat startup. All migration content is local synthetic fixture text, held in memory.

Run only this package from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q04/burn4-migrate.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q04/burn4-migrate-harness.ts src/__tests__/burn4-tg3r2-q04/burn4-migrate.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r2-q04/burn4-tsconfig.json
```

The scoped strict TypeScript check covers these TypeScript tests and their harness. The JavaScript runner is loaded as text at runtime and is not checked by that command. These tests verify runner orchestration and calls to transaction boundaries. They do not validate SQL syntax, database locking, actual PostgreSQL rollback, migration schema correctness or live connectivity.

Known gap: if migration execution fails and `sql.end()` also rejects, the error thrown from `finally` replaces the original error. The final diagnostic names only the close failure. One expected-failure test pins preservation of the original migration diagnostic. A separate passing test verifies rollback and cleanup in the same scenario.

Needs decision: none. Production code remains unchanged.
