# Meal date and calendar item time migration coverage

This package executes the unchanged SQL in `drizzle/0007_calendar_item_times.sql` and `drizzle/0020_meal_absolute_date.sql` against embedded in-memory PostgreSQL from PGlite 0.5.11. It creates minimal synthetic meals and chores tables, uses one database instance, drops and recreates the tables for every case, and closes the instance after the suite. There is no database server, connection, credential, environment-file read, application import or live family data.

The 51 ordinary passing cases cover all seven weekdays for Sunday, Monday and Wednesday week starts, the four other start days, leap days, century leap rules, month and year boundaries, explicit date preservation, full-plan preservation, multiple meals per date, replay, partial time upgrades, nullable times, and width failures. Invalid weekday cases assert SQLSTATE `23502`, the affected table/column, retained rows and rollback of the newly added date column. A corrected row then migrates successfully on retry.

Each migration file is passed as one unchanged `db.exec` call. Its transactional rollback behavior belongs to that execution mode. These tests do not execute or claim coverage of the application's migration runner. The prerequisite fixture models only the selected migrations' columns and their relevant legacy nullability/width constraints. It does not reproduce the whole application schema. Time coverage asserts the declared nullable `varchar(5)` storage contract; these migrations do not define a clock-format validator.

From the repository root, install the package-local test dependency without lifecycle scripts:

```sh
npm ci --prefix src/__tests__/burn4-tg3r6-b02 --cache /home/cameronblackmon/burn-lanes/codex-tg3r6/state/npm-cache --ignore-scripts --no-audit --no-fund
```

The `.pglite.ts` filename keeps this optional suite outside default Jest discovery. It needs the explicit test-match override, package-local dependency, and VM flag. Run only this package's test file:

```sh
node --experimental-vm-modules --max-old-space-size=768 node_modules/jest/bin/jest.js --runInBand --testMatch '**/burn4-tg3r6-b02/burn4-*.pglite.ts' --runTestsByPath src/__tests__/burn4-tg3r6-b02/burn4-meal-migrations.pglite.ts
```

The Node flag allows PGlite's local dynamic imports in Jest's VM. All database state stays in memory. A fresh checkout also needs the repository's existing development dependencies installed with lifecycle scripts disabled.

The test loads PGlite through `createRequire` inside setup and uses a strict structural interface for the four database operations it calls. Default repository typechecking can check the test without resolving the optional package. Explicit execution still loads the pinned real runtime and fails if it is absent.

Run the scoped strict typecheck and lint:

```sh
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r6-b02/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r6-b02/burn4-meal-migrations.pglite.ts --max-warnings 0
```

Results: 51 ordinary passes, 0 KNOWN GAP expected failures, 0 skipped. Scoped typecheck and lint pass. KNOWN GAP list: none confirmed. Needs-decision list: none.
