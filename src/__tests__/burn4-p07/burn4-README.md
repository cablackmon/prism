# Mealie and barcode integration contracts

This package exercises every runtime export in `src/lib/integrations/mealie.ts`
and `src/lib/integrations/product-lookup.ts` through their public interfaces.
It adds tests and a focused TypeScript configuration only.

The Mealie tests use the actual URL validator with explicit production and
allowlist options, a mocked `safeFetch`, and invented recipe and meal-plan data.
The barcode tests mock global fetch and the Redis client factory. Fake timers
control provider deadlines. No provider, Redis server, database, deployment
configuration, environment value, or real family data is used.

## Run from the repository root

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p07/burn4-mealie.test.ts src/__tests__/burn4-p07/burn4-product-lookup.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p07/burn4-mealie.test.ts src/__tests__/burn4-p07/burn4-product-lookup.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p07/burn4-tsconfig.json --pretty false
```

For focused coverage, add these arguments to the Jest command:

```sh
--coverage --collectCoverageFrom=src/lib/integrations/mealie.ts --collectCoverageFrom=src/lib/integrations/product-lookup.ts --coverageDirectory=/tmp/prism-burn4-p07-coverage
```

## Behavior covered

- Connection status and transport errors, authentication headers, base URL
  cleanup, URL rejection before requests, and the public safety error class.
- Recipe mapping, ingredient headings, instruction titles, missing fields,
  supported duration formats, servings, update timestamps, links, image URLs,
  and preservation of provider objects.
- Recipe and meal-plan pagination, encoded slugs, untrusted next-link handling,
  1000 recipe and 2000 meal-plan limits, 200-page guards, invalid rows, HTTP and
  JSON failures, single recipe failures, and collection recovery after a failed
  detail request.
- Barcode provider priority, missing and malformed product data, category and
  brand mapping, HTTP and JSON failures, transport rejection, timeouts, late
  responses, seven-day cache writes, and unavailable or failing Redis clients.

## Validation evidence

The focused run contains 75 tests: 68 ordinary passing tests and 7 named
`test.failing` cases. There are no skipped tests. Jest reports all 75 as passed
because the seven expected failures still reproduce their defects. Focused
ESLint and TypeScript checks pass without diagnostics.

Measured coverage, including the defect probes, is 100% of statements, lines,
and functions in both modules. Branch coverage is 94.68% for Mealie and 100% for
barcode lookup, or 95.90% combined. This is focused coverage, not a full-suite
or application build result.

Each defect probe was also run temporarily as an ordinary test and failed for
the specific behavior below. The temporary audit files and generated reports
are excluded from this package.

## KNOWN GAP defects

1. Invalid Mealie `updatedAt` strings become `Invalid Date` values, which can
   reach timestamp persistence, instead of a missing timestamp.
2. Mealie ISO durations containing only seconds are read as minutes. The
   `PT120S` probe produces 120 minutes instead of 2 minutes.
3. A null row in a Mealie recipe-list page throws while reading `slug` and
   aborts the whole import, including otherwise valid rows.
4. A whitespace-only Open Food Facts product name becomes an empty name and
   prevents fallback to a usable UPCitemdb product.
5. Barcode classification only considers the first Open Food Facts category.
   A generic `en:foods` tag hides a later specific `en:milk` tag.
6. Completed barcode provider requests leave their three-second timeout
   handles pending.
7. The barcode provider timeout covers fetch but excludes response-body JSON
   loading. A stalled body blocks the fallback provider indefinitely.

The tests assert the desired behavior for these defects. Production sources
are unchanged.

## Needs decision

None. This draft records defects for later review and does not fix them.
