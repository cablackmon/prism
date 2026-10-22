# Household location and timezone behavior

Round 2, plan revision 2. These tests exercise unchanged current master source
in `src/lib/hooks/useLocationSearch.ts` and `src/lib/hooks/useTimezone.ts` through
real React `renderHook` calls and the public synchronous timezone helpers.
Relevant existing hook tests were inspected; neither target had direct tests.

All location records are synthetic. Fetch is replaced with local response and
deferred-promise fakes, so no network is possible. Location debounce timers are
fake and frozen. Timezone detection is replaced with a synthetic Intl formatter;
no machine timezone or host environment values are read. Browser storage and
events use isolated jsdom state, with explicit storage rejection probes. A Node
test file also checks timezone helpers when browser globals are absent.

The package has 48 cases: 43 ordinary passing cases and five named expected
failures. No cases are skipped in the normal run. Focused instrumentation covers
100 percent of lines, statements, functions, and branches in both target files.
Coverage includes the expected-failure executions; it is evidence of execution,
not a claim that the five defects are fixed.

Behavior covered:

- Location settings load modern names and legacy postal, city, and state
  fields without rewriting settings. Unavailable settings leave a usable picker.
- Query updates use an encoded endpoint, a full 350 ms debounce, cancellation
  on edits and unmount, the two-character minimum, pending state, empty results,
  JSON/network rejection, and retry. Deferred requests pin stale-response races.
- Select clears search and persists only the chosen display name and numeric
  coordinates. Clear writes explicit null. Both actions expose pending state,
  settle after rejection, permit retry, and keep stable callback identities.
- Browser timezone detection, UTC fallbacks, cached synchronous reads, server
  execution, initial cache/detection, authoritative settings reconciliation,
  invalid settings, load failures, and failed cache writes are exercised.
- Timezone selection updates state/cache and emits the exact custom event
  before waiting for its PATCH. Its body, retry behavior, callback identity,
  delayed-load ordering, and blocked-storage persistence are covered.

Run from the repository root with installed dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p15/burn4-location-search.test.ts src/__tests__/burn4-p15/burn4-timezone.test.ts src/__tests__/burn4-p15/burn4-timezone-server.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p15/burn4-browser-fakes.ts src/__tests__/burn4-p15/burn4-location-search.test.ts src/__tests__/burn4-p15/burn4-timezone.test.ts src/__tests__/burn4-p15/burn4-timezone-server.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p15/burn4-tsconfig.json
```

All three focused commands pass. The strict TypeScript project includes only
these test/helper entry points and their transitive source imports.

For focused coverage, append these arguments to the Jest command:

```sh
--coverage --collectCoverageFrom=src/lib/hooks/useLocationSearch.ts --collectCoverageFrom=src/lib/hooks/useTimezone.ts --coverageDirectory=/tmp/prism-burn4-p15-coverage
```

## KNOWN GAP defects

1. **Older search responses overwrite results for the current query.** A slow
   response for an old query replaces a newer query's already displayed results.
   The query still names the newer city while the candidate list names the old one.
2. **Clearing a query does not invalidate its pending search response.** A late
   response repopulates candidates even though the query is now empty.
3. **Synchronous timezone reads throw when browser storage is blocked.**
   `getTimezone` propagates a storage access error instead of falling back to
   the detected zone. The desired-behavior probe requires a safe read and fallback.
4. **Delayed initial settings overwrite a timezone selected while loading.**
   An initial GET that resolves after a successful user PATCH replaces the newer
   timezone selection and cache with the old settings value.
5. **Denied timezone cache writes prevent API persistence and browser
   notification.** `setTimezone` updates React state, then rejects before its
   PATCH and custom event when localStorage throws. A cache failure should allow
   the durable settings write and event to continue.

All five cases were also run as ordinary tests in temporary owned copies. The
raw probe log and JSON result are saved in the lane state directory. They fail
for their stated value/order/storage behavior with working fakes. Temporary
copies are removed from the final diff. No production fixes are included.

## Needs decision

None.
