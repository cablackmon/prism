# Calendar provider migration coverage

These tests execute five unchanged Prism SQL migrations in PGlite 0.5.11, an embedded PostgreSQL runtime. Each case starts from minimal synthetic tables in a fresh public schema. One in-memory instance is reused serially and closed after the file completes. No database server, sockets, container, environment configuration or application database code is used.

Covered sources:

- `drizzle/0009_calendar_ical_url.sql`: nullable subscription metadata, existing rows, long URLs and replay.
- `drizzle/0011_calendar_provider_config.sql`: legacy config transfer, false and null values, error preservation, unrelated providers, existing partial configuration and replay.
- `drizzle/0013_integrations_account_email.sql`: all six source tables, null backfill, 320-character boundaries, partial upgrades and replay.
- `drizzle/0019_family_group_type.sql`: exact Family seed shape, case and linked-user exclusions, retained rows and replay.
- `drizzle/0023_dismissed_birthdays.sql`: legacy source flags, existing opt-outs, nulls, birthday identity uniqueness, required fields, defaults and replay.

Only synthetic identifiers and reserved example domains are used. No credential columns or username values are populated or inspected. The empty `api_credentials` prerequisite contains only an integer id and a marker; its new account label is metadata. `authMethod` is exercised with a non-secret mode label. The username-copy branch of 0011 is deliberately outside this fixture boundary. No app schema, init data, seed data or migration shell runner is imported.

## Run

Use the repository's installed Jest, TypeScript and ESLint dependencies. From the repository root:

```sh
npm ci --prefix src/__tests__/burn4-tg3r6-b03 --cache /tmp/prism-burn4-npm-cache --ignore-scripts --no-audit --no-fund
node --max-old-space-size=1024 --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r6-b03/burn4-calendar-provider.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r6-b03/tsconfig.json
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r6-b03/burn4-calendar-fixture.ts src/__tests__/burn4-tg3r6-b03/burn4-calendar-provider.test.ts --max-warnings 0
```

The dependency is pinned and locked locally to this test directory. Installation disables lifecycle scripts. Jest needs `--experimental-vm-modules` for PGlite's dynamic module loading. Tests run in the Node environment and only this explicit file is selected. TypeScript checks the actual tests and fixture under strict settings. It does not check SQL syntax; executing the original SQL provides that evidence.

The verified run contains 57 ordinary passing tests and one confirmed KNOWN GAP expected failure, 58 total. No test is skipped.

## KNOWN GAP

`authMethod-only legacy config is erased without being copied`: migration 0011 copies config only when one of six other keys is present, but its cleanup also recognizes `authMethod`. A source whose legacy object contains only that mode and error metadata keeps its errors and loses the mode. The desired assertion requires `provider_config` to retain it. PostgreSQL currently returns SQL null instead.

The gap uses `test.failing`. A future fix makes the desired assertion pass and causes Jest to request removal of the expected-failure marker. The direct probe was verified by temporarily replacing only that marker with `test`, then running the same file with `--testNamePattern 'KNOWN GAP: authMethod-only'`. It failed at the config equality assertion after the cleanup assertion passed. The marker was restored for the final run.

Existing non-null provider config is characterized as authoritative because the migration explicitly guards the copy with `provider_config IS NULL`. Tests record its residual-key cleanup without claiming recovery of uncopied partial configuration.

Needs decision: none for this coverage package. Repairing migration 0011 remains a separate change.
