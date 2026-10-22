# Offline GitHub session activity hook coverage

These tests execute the unchanged `.claude/hooks/github-activity.sh` with synthetic formatted output. They cover missing gh, failed repo binding, successful empty lists, independent PR and issue sections, draft rows, counts, command ordering, literal text, Unicode, trailing newlines, suppressed diagnostics, partial failure and repeated session isolation.

The harness starts `/bin/bash` without profiles in a disposable directory inside this package. It supplies a new environment containing only a fixture PATH and a fixed locale. That PATH contains fake gh and local grep. Fake gh uses shell builtins, accepts only the hook's read command shapes, records calls and returns the configured stdout, stderr and status. Unknown invocations fail the harness. No real gh, network client, repository query, credential, family data or service is available to the tested script. Fixture directories are removed in a finally block.

## Run

From the repository root, with development dependencies installed:

```sh
node node_modules/jest/bin/jest.js --runInBand --cacheDirectory ./src/__tests__/burn4-tg3r4-a04/burn4-jest-cache --runTestsByPath src/__tests__/burn4-tg3r4-a04/burn4-hook-output.test.ts src/__tests__/burn4-tg3r4-a04/burn4-hook-gaps.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r4-a04/burn4-hook-harness.ts src/__tests__/burn4-tg3r4-a04/burn4-hook-output.test.ts src/__tests__/burn4-tg3r4-a04/burn4-hook-gaps.test.ts --max-warnings=0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r4-a04/burn4-tsconfig.json --noEmit --incremental false
```

The verified run has 23 cases: 20 ordinary passes and 3 confirmed KNOWN GAP expected failures, with no failed or skipped cases. ESLint passes with zero warnings. Strict scoped TypeScript covers the tests and harness; the Bash source is not typechecked. No full suite or whole-repository build was run.

## KNOWN GAP

One defect has three cases: the hook discards PR and issue enumeration exit statuses before publishing their stdout as session context.

- When both commands fail without output, it claims there are no open items, despite the source's silent-on-failure promise.
- A failed PR command with partial stdout publishes an apparently complete PR section alongside successful issue output.
- A failed issue command with partial stdout publishes an apparently complete issue section alongside successful PR output.

The partial-output assertions require failed-list rows to be withheld while retaining the successful list. They do not prescribe a warning or retry policy. Each expected-failure case was temporarily run as an ordinary test and failed at its final output assertion, after its exit, diagnostic and successful-data prerequisites passed. Production behavior is unchanged.

## Limits

Fake gh returns preformatted text. These tests do not evaluate gojq, prove sorting/draft formatting against actual GitHub data, reproduce any specific gh transport failure, or establish when gh produces partial stdout. They verify the shell's treatment of a command response containing stdout plus a nonzero status. The CLI request shape is checked by the strict fake; real authentication and remote permissions are outside scope. The 20-item examples verify response counting, not total repository counts. Repeated invocation coverage is sequential and does not claim concurrent-process or hook timeout coverage.

Needs-decision: none.
