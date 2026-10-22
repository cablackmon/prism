# Mode controls and mobile card preferences

Plan revision 2. Tests use current master source at base `5452b7c6cef8f9b3d9b5e936c748822e2a28535a` without changing production files.

The six coverage targets are `useAwayMode`, `useBabysitterMode`, `AwayModeToggle`, `BabysitterModeToggle`, `useMobileLayout`, and dashboard `useMobileCardOrder`. Their runtime exports and callbacks are exercised through real React mounts, button clicks, updates, unmounts, remounts, and server rendering.

The excluded mode implementation, authentication modal, button presentation, and permission module are mocked. The modal fake exposes role selection and cancellation, retains the asynchronous callback result, and models the real modal's immediate close behavior. Tests do not exercise authentication or issue network requests. Permissions use the synthetic parent, child, and guest policy required by the controls. A fetch guard fails on any unexpected request. Mobile preference tests use isolated browser storage, storage failure fakes, and real server rendering without a browser. No existing adequate tests for these six targets were found in the base.

Run only this package from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p10/burn4-mode-controls.test.tsx src/__tests__/burn4-p10/burn4-mobile-preferences.test.tsx src/__tests__/burn4-p10/burn4-mobile-ssr.test.tsx
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p10/burn4-harness.ts src/__tests__/burn4-p10/burn4-mode-controls.test.tsx src/__tests__/burn4-p10/burn4-mobile-preferences.test.tsx src/__tests__/burn4-p10/burn4-mobile-ssr.test.tsx
node node_modules/typescript/bin/tsc --noEmit -p src/__tests__/burn4-p10/burn4-tsconfig.json
```

For focused coverage, append these options to the Jest command:

```sh
--coverage --collectCoverageFrom=src/lib/hooks/useAwayMode.ts --collectCoverageFrom=src/lib/hooks/useBabysitterMode.ts --collectCoverageFrom=src/lib/hooks/useMobileLayout.ts --collectCoverageFrom=src/components/away-mode/AwayModeToggle.tsx --collectCoverageFrom=src/components/babysitter-mode/BabysitterModeToggle.tsx --collectCoverageFrom=src/components/dashboard/useMobileCardOrder.ts
```

The recorded run has 40 tests: 34 ordinary passes and 6 named `test.failing` cases, with no skips. Focused lint and the package typecheck pass. Coverage for the six source modules is 97.89% lines, 100% functions, 98.05% statements, and 93.93% branches. This is package-only validation, not a whole-repository result.

Covered behavior includes wrapper mapping and action forwarding, default and overridden polling options, accessible confirmation controls, cancellation and reopening, optional labels, active and loading visibility, both denied roles, asynchronous parent confirmation and event timing, failed writes, layout persistence, card-order migration, retained user ordering, corrupt storage fallback, input safety, independent hidden-card loads, and browser-free defaults.

## KNOWN GAP

Each case asserts the desired behavior. All six were also run without Jest's expected-failure inversion and failed at the intended behavior assertion, with functioning fakes. Raw probe logs are preserved outside the repository in the lane evidence directory.

- Away Mode retains a stale open confirmation after another consumer enables and exits the mode, so the dialog unexpectedly reopens when the control returns.
- Babysitter Mode retains the same stale confirmation across an external mode activation cycle.
- The standalone mobile-layout getter throws when storage is blocked instead of returning the existing rows default.
- Mobile-order migration retains duplicate known card IDs, allowing the same card to appear twice.
- Hidden-card loading accepts non-array JSON instead of using its existing default fallback.
- Mutating a default hidden-card result changes the shared fallback array and corrupts later independent loads. The test restores the array after its assertion to avoid contaminating other cases.

## Needs decision

None. Fixes for the named defects belong in separate source-change work.
