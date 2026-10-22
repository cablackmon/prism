# Offline visual scenario reliability

This package exercises unchanged `e2e/visual-regression.spec.ts` through strict inert module and Page fakes. All 34 registered scenarios are invoked as individual unit callbacks. Playwright, browsers, original E2E suites, imported auth/reset helpers, subprocesses and screenshot files never run or load.

Coverage includes every scenario's route path, screenshot identity, theme/performance/calendar preferences, masks, viewport, modal readiness, settle duration and asynchronous operation order. Deferred and rejected fake dependencies verify that initialization, login, navigation, readiness and screenshot expectations are awaited. The actual setClientFlags and nested setCalendarPrefs function bodies are extracted through TypeScript AST text without edits, then their real addInitScript callbacks execute against synthetic in-memory localStorage. Default and explicit options, string serialization, page isolation and dynamic mask ownership are covered.

The only nonempty VM environment field is a private ordinary `E2E_HAS_TEST_DB='1'` lifecycle control for direct callback tests. A separate empty-gate run verifies that all 34 callbacks stop before page, login or locator effects. All other environment fields are inaccessible. Both VM contexts disable string and WebAssembly code generation. Unknown imports and every subprocess command are denied.

The enabled beforeAll callback stops at the denied reset fake. getSeededParentName is intentionally never executed, so it cannot read connection fields, construct command/SQL text or return an auth-shaped value. parentName remains undefined. The login fake accepts only the synthetic Page argument and discards the unused second JavaScript argument without recording it. The disabled beforeAll callback performs no work. Credential-bearing backend setup is outside this package.

This validates scenario orchestration and preferences. It does not validate rendered pixels, browser behavior, auth, database setup or Playwright baseline-path resolution. TypeScript checks only the new tests and harness; source loaded as text is not typechecked. No snapshot-path collision claim is made.

Run from the repository root with dependencies already installed:

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r5-b11/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b11/burn4-visual-scenarios.test.ts src/__tests__/burn4-tg3r5-b11/burn4-visual-helpers.test.ts src/__tests__/burn4-tg3r5-b11/burn4-visual-async.test.ts src/__tests__/burn4-tg3r5-b11/burn4-visual-gaps.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r5-b11/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r5-b11/*.ts src/__tests__/burn4-tg3r5-b11/burn4-jest.config.cjs --max-warnings 0
```

Validation: 81 accepted cases, comprising 75 ordinary passes and 6 named KNOWN GAP expected failures. Zero normal-run failures or skips. Focused lint passes with zero warnings. Strict scoped test/harness TypeScript passes.

KNOWN GAP list:

- Six settings subsection screenshots select the account section instead of their intended family, display or integrations section. Their actual captured callbacks navigate with a hash, while SettingsView selects its section from the query parameter. This is one defect affecting three sections in both themes.

Supporting contract evidence was read without importing or executing the excluded consumer: at base master `5452b7c6cef8f9b3d9b5e936c748822e2a28535a`, `src/app/settings/SettingsView.tsx:145` normalizes a missing section to account; lines 151-166 and 180-185 read the section search parameter. The captured visual callbacks at `e2e/visual-regression.spec.ts:280` omit that query parameter. The earlier integrations scenario at line 179 uses the correct query form.

The same six intended assertion callbacks run as ordinary failures in this explicit-only inverse reproduction. It must exit 1 with six query-section assertion failures while the defect remains:

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r5-b11/burn4-jest.config.cjs --runInBand --testMatch '**/burn4-visual-gaps.inverse.ts' --runTestsByPath src/__tests__/burn4-tg3r5-b11/burn4-visual-gaps.inverse.ts
```

The inverse file does not match normal discovery. No hash precondition is asserted, so fixing navigation makes the expected-failure cases report unexpected passes and signals that they should become ordinary regressions.

Needs-decision: none. Source fixes remain outside this new-files-only package.
