# Dashboard modes and visibility coverage

These offline tests exercise `useModeToggle`, `useAwayMode`, `useBabysitterMode`, `useHiddenPages`, and `useAutoHideUI` through real React mounts, updates, events, and unmounts. They add no source changes.

Mode tests also run the real `useFetch`, navigation cache, visibility polling, and performance polling dependencies. All fetch responses are local fakes. Browser storage is isolated between tests, timers are fake, and navigation is a pathname fake. The server-render test uses React's real Node server renderer because jsdom resolves the browser server-renderer entry by default.

Run only this package from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p10/burn4-mode-toggle.test.tsx src/__tests__/burn4-p10/burn4-hidden-pages.test.tsx src/__tests__/burn4-p10/burn4-auto-hide.test.tsx
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p10/burn4-harness.ts src/__tests__/burn4-p10/burn4-mode-toggle.test.tsx src/__tests__/burn4-p10/burn4-hidden-pages.test.tsx src/__tests__/burn4-p10/burn4-auto-hide.test.tsx
node node_modules/typescript/bin/tsc --noEmit -p src/__tests__/burn4-p10/burn4-tsconfig.json
```

For focused coverage, append these options to the Jest command:

```sh
--coverage --collectCoverageFrom=src/lib/hooks/useModeToggle.ts --collectCoverageFrom=src/lib/hooks/useAwayMode.ts --collectCoverageFrom=src/lib/hooks/useBabysitterMode.ts --collectCoverageFrom=src/lib/hooks/useHiddenPages.ts --collectCoverageFrom=src/lib/hooks/useAutoHideUI.ts
```

The recorded run has 53 tests: 48 ordinary passes and 5 named `test.failing` cases, with no skips. Focused lint and the package typecheck pass. Coverage for the five source modules is 100% lines, 100% functions, 98.49% statements, and 91.42% branches. This is package-only validation, not a whole-repository test or typecheck result.

Covered behavior includes confirmed mode writes, loading and metadata, explicit authorization-style rejections, transport and JSON failures, refresh recovery, wrapper endpoints and polling overrides, event isolation and multiple consumers, cached settings fallback, optimistic preferences, navigation filtering and input safety, dashboard route gating, storage and custom setting events, exact inactivity deadlines, mouse movement throttling, server rendering, timer reset, and listener cleanup.

## KNOWN GAP

Each case asserts the desired behavior. All five were also run without Jest's expected-failure inversion and failed at the intended behavior assertion, with functioning fakes.

- An older initial GET overwrites a confirmed mode toggle. A delayed initial inactive response replaces a successful active POST result.
- Valid JSON cache values that are not arrays bypass the cache fallback. A cached JSON string is exposed as `hiddenPages` instead of falling back to an empty array.
- An initial settings response overwrites a newer local hidden-page choice. A delayed server response replaces both the newer hook choice and its browser cache.
- A cache write failure prevents saving hidden pages to the server. The setter rejects before issuing PATCH when browser storage throws, although the in-memory choice changes.
- Mounted navigation consumers do not receive changes from the settings consumer. One instance updates while a concurrently mounted instance keeps its old visibility state.

## Needs decision

None. Fixes for the named defects belong in separate source-change work.
