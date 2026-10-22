# Cache invalidation failure and concurrency coverage

These 17 tests execute both runtime exports from the unchanged
`src/lib/cache/cacheKeys.ts`: `invalidateEntity` and `invalidateEntities`.
They add deferred behavior coverage beyond the existing immediate-success
graph tests.

The entire Redis module is mocked. Each allowed boundary call consumes a
planned local promise that the test resolves or rejects explicitly. An
unplanned invalidation throws, and public promise observations check exact
failure identity. No real Redis implementation, connection factory,
configuration, environment value, filesystem data or service is accessed.

The cases cover:

- A root must settle before its dependencies begin, siblings begin together,
  and the returned promise waits for the last transitive descendant.
- Overlapping roots share one pending descendant across either completion
  order, without letting the public aggregate complete early.
- Root, sibling and transitive failures preserve the original error object.
  Already-started independent work can continue after aggregate rejection,
  and later sibling failures leave the original public failure unchanged.
- Fresh retries after root and descendant failures traverse again.
- Concurrent single-entity, aggregate and mixed invocations have separate
  traversal state and independent completion or failure.
- Empty aggregate input and caller-supplied visited sets skip existing work
  while preserving unfinished sibling waits.

All gates are local deferred promises; the tests use no sleeps or elapsed
time thresholds. Every planned boundary operation is settled within its
case. The tests model invalidation completion and rejection, without
exercising Redis key matching or transport behavior.

## Run focused checks

Run from the repository root after installing dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q09/burn4-cache-invalidation.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q09/burn4-cache-invalidation.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r2-q09/burn4-tsconfig.json --noEmit
```

The separate strict TypeScript project checks this test file, the imported
source and transitive source dependencies with no emit or incremental cache.
Jest uses the existing repository transform configuration, whose diagnostics
are disabled, so the TypeScript command provides the typecheck.

## Test counts and known gaps

17 ordinary passing cases; zero expected failures, failures or skipped cases.
No confirmed KNOWN GAP was found. Early Promise.all rejection and continued
sibling progress are expected JavaScript behavior.

## Needs-decision list

None. Production source is unchanged.
