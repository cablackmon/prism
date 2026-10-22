# Original mode and settings scenario reliability

This package runs the original registered callbacks in `e2e/modes.spec.ts` and
`e2e/settings.spec.ts` against synthetic state. It covers their nine scenarios
and five lifecycle callbacks, including response checks, navigation, overlay and
settings assertions, prerequisite failures, and temporary setup pages.

There are 93 ordinary passing cases and seven named expected-failure cases.
No existing source changes. All source evaluation is restricted to the two
eligible files; imported Playwright, auth, and reset helpers are inert local
objects. No real helper, browser, application, database, network, process
environment, or family data is used. Locators interpret predicates over fixture
elements and fail for hidden, missing, or ambiguous results. Their behavior is
an offline model, not proof of CSS selectors or browser compatibility.

`burn4-harness.ts` transpiles each original module with explicit TypeScript
options, captures its callbacks through an allowlisted require function, and
evaluates registration in a VM with a one-second timeout. Callbacks retain
their original closure state. This is isolation for these fixed trusted source
files, not a security sandbox for arbitrary input. The runner does not supply
process, network, timers, or actual require globals to the VM.

The owned Jest config supplies no setup files and no inherited root config.
The scoped tsconfig checks the new harness, tests, gap helpers, inverse runner,
and JavaScript configs with strict, noUncheckedIndexedAccess, and checkJs.
skipLibCheck applies only to installed declaration files. The owned ESLint
config reads installed tooling only, with root config lookup disabled.

## Focused commands

Run from the repository root using the existing installed dependencies:

```sh
timeout 120 node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r8-b01/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r8-b01/burn4-modes.test.ts src/__tests__/burn4-tg3r8-b01/burn4-settings.test.ts
timeout 60 node node_modules/tsx/dist/cli.mjs --tsconfig src/__tests__/burn4-tg3r8-b01/burn4-tsconfig.json src/__tests__/burn4-tg3r8-b01/burn4-inverse.ts
timeout 120 node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r8-b01/burn4-tsconfig.json --noEmit --incremental false
timeout 120 node node_modules/eslint/bin/eslint.js --no-config-lookup --no-ignore --config src/__tests__/burn4-tg3r8-b01/burn4-eslint.config.mjs --max-warnings 0 src/__tests__/burn4-tg3r8-b01/burn4-harness.ts src/__tests__/burn4-tg3r8-b01/burn4-modes.test.ts src/__tests__/burn4-tg3r8-b01/burn4-settings.test.ts src/__tests__/burn4-tg3r8-b01/burn4-known-gaps.ts src/__tests__/burn4-tg3r8-b01/burn4-inverse.ts src/__tests__/burn4-tg3r8-b01/burn4-jest.config.cjs src/__tests__/burn4-tg3r8-b01/burn4-eslint.config.mjs
```

The inverse runner calls the exact shared desired-contract assertions directly,
without Jest expected-failure inversion, then confirms the specific assertion
type and message. Unexpected setup/import errors cannot qualify. An unexpected
error inside the permanent expected-failure wrapper becomes a Jest failure.

## KNOWN GAP list

The unchanged originals have four observed defect categories, with seven
fixture variants:

1. `overlay-mutation-status:away` and `overlay-mutation-status:babysitter`:
   overlay scenarios ignore unsuccessful enable responses, allowing a stale
   visible overlay to mask failed activation.
2. `disable-enable-precondition`: the disable scenario ignores an unsuccessful
   preliminary enable response, so it can pass without proving a transition.
3. `activation-verification-status`: away activation ignores HTTP failure on
   the verification GET when its body still looks enabled.
4. `setup-page-cleanup:modes:getFirstParent`,
   `setup-page-cleanup:settings:getFirstParent`, and
   `setup-page-cleanup:settings:getFamilyMembers`: a failed prerequisite leaves
   the created temporary page open.

These gaps describe test-infrastructure reliability, not defects in mode or
settings application implementations. No known gap is assigned to new code.

## Limits and decisions

No needs-decision items. This package proves callback control flow and
detection strength under fakes. It does not prove authentication, actual reset
behavior, APIs, rendered app content, browser selectors, or end-to-end behavior.
The original two-member sample and vacuous empty-member behavior are explicitly
characterized without inventing a third-member or nonempty-fixture policy.
