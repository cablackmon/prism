# Device detection, orientation and polling hook coverage

Plan revision 2. Tests exercise the current master source implementations with
React Testing Library and local browser fakes. No application source is changed.
There are no network requests, services or real device data. Media-query fakes
dispatch real EventTarget events and track active listener identities.

## Run

From the repository root, define the explicit package file list:

```bash
burn4_p09_tests=(
  src/__tests__/burn4-p09/burn4-deviceMedia.test.ts
  src/__tests__/burn4-p09/burn4-deviceViewport.test.ts
  src/__tests__/burn4-p09/burn4-usePollingInterval.test.ts
  src/__tests__/burn4-p09/burn4-usePollingInterval.server.test.ts
)
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath "${burn4_p09_tests[@]}"
node node_modules/eslint/bin/eslint.js "${burn4_p09_tests[@]}" src/__tests__/burn4-p09/burn4-browserFakes.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p09/burn4-tsconfig.json --pretty false
```

For focused coverage, use the same explicit files and a temporary output folder:

```bash
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath "${burn4_p09_tests[@]}" \
  --coverage \
  --collectCoverageFrom=src/lib/hooks/usePollingInterval.ts \
  --collectCoverageFrom=src/lib/hooks/useOrientation.ts \
  --collectCoverageFrom=src/lib/hooks/useScreenOrientation.ts \
  --collectCoverageFrom=src/lib/hooks/useIsPWA.ts \
  --collectCoverageFrom=src/lib/hooks/useIsTouch.ts \
  --collectCoverageFrom=src/lib/hooks/useIsMobile.ts \
  --coverageDirectory=/tmp/burn4-p09-coverage
```

## Verified behavior

- usePollingInterval: stored preferences, rounding, disabled intervals, enable
  and disable events, malformed payloads, default changes, multiple consumers,
  exact listener removal and server rendering without browser globals.
- useOrientation: initial viewport dimensions, square screens, resize and mobile
  orientation-change events, rerenders, independent consumers and exact cleanup.
- useScreenOrientation: portrait and landscape query state, two-way changes,
  isolated queries, subscription stability, multiple consumers, cleanup and SSR.
- useIsPWA: initial standalone detection, entering and leaving standalone mode,
  query isolation, independent consumers, rerenders, cleanup and SSR.
- useIsTouch: primary coarse-pointer detection, pointer changes, query isolation,
  independent consumers, rerenders, cleanup and SSR.
- useIsMobile: the 768-pixel boundary, both resize directions, tall screens,
  zero width, independent consumers, rerenders, exact cleanup and SSR.

The focused run has 47 tests: 45 normal passes and 2 named expected failures;
none skipped. Jest reports expected failures as passed when the defect remains.
Focused ESLint and the package TypeScript configuration pass. The configuration
checks these tests, their fake helper and imported source dependencies; it does
not check the whole application. Jest disables TypeScript diagnostics, so the
separate TypeScript check supplies that evidence.

All six target modules reach 100% statement, branch, function and line coverage.
Those execution metrics include the known-gap probes and do not imply either
defect is fixed.

## KNOWN GAP defects

Both tests use test.failing and assert desired behavior. Verification also ran
them as ordinary tests, saved the raw assertion failures, and removed the probe
copies. Expected failures remain until the corresponding defect is fixed.

1. Blocked browser storage crash: a storage SecurityError crashes polling
   interval initialization instead of using the requested default interval.
2. Missed orientation subscription race: a portrait query change between
   render and effect subscription is lost. The hook stays in landscape even
   though the subscribed query reports portrait. A wrapper layout effect emits
   the real change event before the passive subscription to reproduce the race.

## Needs decision

None for this coverage package. Source fixes are outside its new-files-only scope.
