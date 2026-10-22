# Dashboard, smoke and mobile regression trust

These offline tests execute the original registered callbacks in:

- `e2e/dashboard.spec.ts`: four test callbacks and three lifecycle hooks.
- `e2e/smoke.spec.ts`: two page callbacks and four API callbacks.
- `e2e/mobile-pwa-settings.spec.ts`: one gated mobile settings callback.

All existing files stay unchanged. This is coverage of the E2E specifications themselves. It supplies no browser, application rendering, device, database or provider integration evidence.

## Run from the repository root

Install the repository's normal development dependencies with lifecycle scripts disabled if they are not already present. No additional package or browser runtime is required.

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r7-b04/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r7-b04/burn4-dashboard.test.ts src/__tests__/burn4-tg3r7-b04/burn4-smoke.test.ts src/__tests__/burn4-tg3r7-b04/burn4-mobile.test.ts src/__tests__/burn4-tg3r7-b04/burn4-known-gaps.test.ts
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r7-b04/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r7-b04/*.ts src/__tests__/burn4-tg3r7-b04/*.cjs --max-warnings 0
```

The focused suite contains 64 ordinary passing cases and seven confirmed expected-failure cases, with zero failures or skips. A fake Playwright skip throws a synthetic sentinel which a normal Jest case checks; no Jest test is skipped. TypeScript inherits strict mode and `noUncheckedIndexedAccess` from the root configuration. The custom Jest config has no setup, teardown or web-server hooks.

Run the desired-contract cases without expected-failure inversion:

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r7-b04/burn4-jest.config.cjs --runInBand --no-cache --testMatch '**/burn4-gaps.inverse.ts'
```

This command must currently exit 1 with seven failures. Each failure message begins with a specific `GAP` assertion, after the relevant original callback has run. The inverse file is outside both the custom normal matcher and the root Jest matcher. When the source defects are fixed, the desired contracts pass and their `test.failing` wrappers report unexpected success until updated.

## Behavior covered

| Original callback or hook | Meaningful observations |
| --- | --- |
| Dashboard `beforeAll` | Reset precedes temporary-page creation; parent lookup is awaited; success closes the page; reset, page creation, lookup and close failures propagate without later setup work. |
| Dashboard `beforeEach`, `afterEach` | Parent identity reaches the inert login boundary; login and logout are awaited; failures preserve identity; logout clears the synthetic session. |
| Dashboard widgets | Missing main, hidden widgets and an empty widget collection reject the callback. Navigation settles before visibility and count checks. |
| Dashboard sidebar | All three navigation steps run; an unrelated destination or failed step prevents later interactions; pathname suffix false positives are pinned. |
| Dashboard direct and home routes | Correct destinations pass; wrong destinations and missing main reject; loose direct/home URL patterns are pinned. |
| API health, family, tasks and chores | Each callback accepts its documented shape, rejects non-OK status before parsing, rejects missing or wrong state/list shape, and propagates request and JSON failures. Empty synthetic arrays remain valid. |
| Homepage and sidebar smoke | Visible landmarks pass; missing landmarks or rejected navigation fail; HTTP error-document false positives are pinned. |
| Mobile settings | Disabled fixture gate stops all work. Both family response envelopes reach settings. Verification precedes navigation. Menu, link, selector, both options, heading and provider cards each form a rejecting oracle when missing. |
| Mobile prerequisites | Family request/JSON, login and verify rejection stop before UI navigation. Failed verification gives its status. Both source identity branches execute, and a child-first valid roster exposes wrong-role selection. |

## Isolation and limits

`burn4-harness.ts` reads only the chosen spec, transpiles it without rewriting behavior, then registers and invokes its callbacks in a fresh VM. Imports are allowlisted and replaced completely. The original auth and reset helpers, `@playwright/test`, application sources, Playwright config and global teardown never execute. Unknown imports, API routes, page routes and selectors fail. No command, browser, service, database, network call or real environment value is used.

The VM receives a synthetic fixture gate. Its PIN override is always absent. Verification request bodies are dropped immediately, with no inspection, retention, assertion, printing or persistence. Events contain only operation names, synthetic member names, paths, statuses and boolean fixture observations. No authentication payload contract is claimed.

Visibility, count, URL and scalar expectations use real Node assertions. Mobile visibility depends on opening its menu, reaching settings and selecting Integrations. These fakes verify callback decisions and failure propagation. They model immediate settled observations, without Playwright's polling, CSS layout, real DOM selectors or network-idle timing. Temporary-page and session state are local to each loaded fixture. The VM is an isolation mechanism for these trusted source files, not a sandbox for hostile code.

## KNOWN GAP list

Seven desired-contract cases identify four groups of source defects:

1. Dashboard setup leaves its owned temporary page open when parent lookup rejects. The page needs cleanup even when setup fails.
2. Dashboard destination regexes match unrelated pathname suffixes for sidebar and direct routes. The home-link regex accepts any non-home pathname ending in slash. Three cases require the expected route identity.
3. Both homepage page-smoke callbacks accept an HTTP 500 document if its shell contains the expected landmarks. Two cases require a failed navigation response to fail the smoke check.
4. Mobile settings selects `members[0]` rather than a parent. A valid child-first roster with an available parent reaches parent-only verification as the child, receives 403 and never exercises settings. The desired contract requires parent selection and successful completion of the synthetic settings flow.

Every inverse case was checked at its intended assertion. A separate lane-state probe also applied narrow source fixes only in memory and confirmed that all seven desired-contract functions then pass. Those probe edits are not part of the repository or source implementation.

Needs-decision: None. Source fixes require a later change under the new-files-only boundary.
