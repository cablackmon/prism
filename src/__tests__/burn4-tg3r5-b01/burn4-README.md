# Layout submission workflow execution

These tests execute the unchanged JavaScript from `.github/workflows/layout-submission.yml`. Four async GitHub Script bodies and the inline validator JavaScript run inside isolated Node VM contexts. The tests cover account-age and daily submission gates, fenced/raw JSON extraction, validator orchestration, error feedback, layout/index generation, command and PR ordering, failures, repeated execution and independent concurrent submissions.

`validateCommunityLayout` is a fake with explicit pass/fail fixtures. Its production implementation is outside this package's scope. The tests exercise how the workflow calls it and handles its results. The shell wrapper around the validator, environment failure signaling, workflow conditions, GitHub Actions scheduling, real git semantics, filesystem durability and live API behavior are outside runtime coverage. Cross-step tests invoke the handlers directly and assert their observable results; they do not simulate a GitHub runner.

All issue, comment, label, PR and command calls are inert recorded functions. Files exist only in an in-memory map with relative path normalization. The VM exposes synthetic context, fixed clock, fake core, fake console and an exit-only process. It has no actual environment, fetch, Buffer or timers. The require allowlist provides only those fakes; string code generation is disabled. The only production file the harness reads is the workflow YAML. No shell text built from layout content is ever executed.

Run from the repo root after the repo's development dependencies are available:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b01/burn4-submission-input.test.ts src/__tests__/burn4-tg3r5-b01/burn4-submission-validation.test.ts src/__tests__/burn4-tg3r5-b01/burn4-submission-publish.test.ts src/__tests__/burn4-tg3r5-b01/burn4-submission-gaps.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r5-b01 --max-warnings=0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r5-b01/burn4-tsconfig.json
node src/__tests__/burn4-tg3r5-b01/burn4-gap-probe.cjs
```

The focused run has 97 cases: 94 ordinary passes and three KNOWN GAP expected failures, with no failures or skips. Scoped strict TypeScript checks only new tests and the harness, not the workflow or production validator. ESLint checks the owned directory with zero allowed warnings. The probe executes each gap check directly, without Jest expected-failure inversion, and requires an AssertionError containing that case's intended assertion. It prints confirmation metadata and exits successfully only when all three defects are reproduced.

The three KNOWN GAP cases are:

- Layout names remain active shell syntax inside the double-quoted git commit command. The fixture uses a harmless shell-expansion marker, records the constructed command and never invokes it. Production community validation accepts general names of 1-100 characters and does not exclude this marker; the synthetic name is within that contract.
- A new submission can overwrite an existing layout file when different names reduce to the same slug. The old and new layouts have disjoint valid widget geometry, so duplicate-widget rejection does not resolve this collision. The handler does not check existing IDs or paths before writing.
- A nonempty name containing only non-ASCII characters reduces to an empty identifier and `dashboard/.json`. Production name validation permits these characters. The handler still creates a branch and PR with the empty slug.

Source reasoning for valid gap inputs: `src/lib/community/validateLayout.ts` checks name length and profanity in its community checks, and checks duplicate layouts by normalized widgets and occupied cells. It does not restrict names to ASCII, escape shell syntax or check generated slugs. That source was inspected read-only and is never imported or changed by this package.

Needs-decision: none. Source changes require separate review; this new-files-only package pins behavior and defects.
