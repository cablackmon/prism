# Travel migration behavior coverage

These tests execute the unchanged SQL in `drizzle/0001_travel_map.sql` through `drizzle/0006_weekend_ideas.sql` against embedded PostgreSQL through PGlite 0.5.11. They cover existing-row upgrades, defaults and explicit metadata, numeric precision and overflow, required fields, foreign keys, unique photo links, nested parent deletion, trip membership, weekend visits and replay over a connected graph.

All rows are synthetic. The only prerequisite tables are `users(id)` and `photos(id)`. The tests do not import the application database code, schema, seed data or other migrations. No server, network connection, Docker process, credentials or application services are used. One in-memory database is reused sequentially, its schema is reset before every case, and it is closed after the suite. The package-local dependency is private and locked; root dependency manifests are unchanged.

## Run

Run from the repository root with Node 24 or later and the repository development dependencies already installed. Use a writable temporary cache instead of the lane cache below when running elsewhere.

```sh
npm ci --prefix src/__tests__/burn4-tg3r6-b01 --cache /home/cameronblackmon/burn-lanes/codex-tg3r6/state/npm-cache --ignore-scripts --no-audit --no-fund
node --experimental-vm-modules node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r6-b01/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r6-b01/burn4-travel.test.ts
node_modules/.bin/tsc -p src/__tests__/burn4-tg3r6-b01/burn4-tsconfig.json
node_modules/.bin/eslint src/__tests__/burn4-tg3r6-b01/burn4-*.ts --max-warnings 0
node --check src/__tests__/burn4-tg3r6-b01/burn4-jest.config.cjs
```

Node's VM module CLI flag is required for PGlite's dynamic import under Jest. No environment setting is needed. Run only this explicit test file in band. The strict TypeScript check covers the actual test, fixture and probe code, including PGlite query types; it does not claim to typecheck SQL or the whole application. Focused ESLint covers the four TypeScript files, and `node --check` checks the Jest configuration syntax. Root dependencies and PGlite are downloaded during installation; test execution is offline.

## Result and known gap

The focused suite has 46 cases: 45 ordinary passes and one confirmed KNOWN GAP expected failure, with zero failed or skipped cases.

`0003_travel_parent_child.sql` searches `information_schema.table_constraints` by table and constraint name without checking schema. If another schema already has `travel_pins` with a constraint named `travel_pins_parent_id_fkey`, the migration skips adding the public foreign key. A pin can then reference a nonexistent parent. The regression fixture creates a real second schema with a same-named check constraint in a setup hook outside the expected-failure marker. The marked body contains only the intended foreign-key rejection assertion. A separate ordinary case proves that orphan writes are rejected when there is no collision.

Run the same desired-contract assertion without expected-failure inversion:

```sh
node_modules/.bin/tsx src/__tests__/burn4-tg3r6-b01/burn4-gap-probe.ts
```

On the current migration, the probe exits 1 with `Missing expected rejection` and identifies the same-named constraint contract. This confirms that the write succeeded, rather than failing for a missing prerequisite or unrelated database error. The probe closes its database even when the assertion fails. Once the SQL is corrected, the probe should exit 0 and the named `test.failing` case must become an ordinary test.

JSON collections, visit date strings and latitude/longitude values are characterized according to their declared SQL storage types. These tests do not invent domain validation requirements that the migrations do not state. No trip-member join table or uniqueness rule exists in these migrations; `member_ids` is preserved JSON metadata, while actual pin membership uses `trip_id`.

Needs decision: none. The confirmed schema-qualification defect needs a later source fix, outside this additions-only package.
