# Offline installation and screenshot readiness checks

These tests execute unchanged shell from `.github/workflows/test-install.yml`
and the readiness loop in `.github/workflows/refresh-screenshots.yml`.
They add no application changes and require no services or network.

The focused run has 71 cases: 69 ordinary passing cases and 2 confirmed
KNOWN GAP expected failures. The separate uninverted probe exposes both
assertion failures and exits with status 1.

## Run

The harness uses existing repository dev dependencies. No new package is
installed by this change. If dependencies are absent, install them with
`npm ci --ignore-scripts --no-audit --no-fund` from the repository root.

Run only these files from the repository root:

```sh
node node_modules/jest/bin/jest.js \
  --config src/__tests__/burn4-tg3r6-b07/burn4-jest.config.cjs \
  --runInBand --runTestsByPath \
  src/__tests__/burn4-tg3r6-b07/burn4-harness.test.ts \
  src/__tests__/burn4-tg3r6-b07/burn4-readiness.test.ts \
  src/__tests__/burn4-tg3r6-b07/burn4-validation.test.ts \
  src/__tests__/burn4-tg3r6-b07/burn4-known-gaps.test.ts

node node_modules/typescript/bin/tsc \
  -p src/__tests__/burn4-tg3r6-b07/burn4-tsconfig.json

node node_modules/eslint/bin/eslint.js \
  src/__tests__/burn4-tg3r6-b07/*.ts \
  src/__tests__/burn4-tg3r6-b07/burn4-jest.config.cjs --max-warnings 0

node --check src/__tests__/burn4-tg3r6-b07/burn4-jest.config.cjs
```

To confirm the defects without expected-failure inversion, run this command
separately. Its two failed assertions and exit status 1 are intentional:

```sh
node node_modules/jest/bin/jest.js \
  --config src/__tests__/burn4-tg3r6-b07/burn4-jest.config.cjs \
  --testRegex 'burn4-gap-probe\.ts$' --runInBand --runTestsByPath \
  src/__tests__/burn4-tg3r6-b07/burn4-gap-probe.ts
```

The probe filename does not match ordinary test discovery.

## Behavior covered

- Fresh-install readiness succeeds immediately, during retries or at the
  thirtieth probe. Tests count actual curl and sleep calls and check failures.
- Screenshot readiness succeeds through the eightieth probe and its final
  confirmation, fails after exhaustion, handles a failed confirmation after
  initial success, and propagates sleep and log-tail failures.
- Required containers can be present, missing, disappear between checks or
  fail a daemon command. Native grep executes the actual workflow patterns.
- Health and page checks propagate curl failures, require the expected page
  branding and handle empty or multiline responses.
- Installer, executable selection, database, log collection and build-only
  commands use inert fakes with exact arguments and failure propagation.
- Extraction rejects missing or duplicate steps. The execution boundary
  rejects unreviewed commands, substitutions and output redirection. Fakes
  reject unplanned calls and argument mismatches, including redirected errors.

## Execution boundary

`burn4-workflow-harness.ts` extracts run text by unique step name. It does not
parse workflow environment or secret blocks. A fixed allowlist admits only
reviewed shell statements. Each run uses a new disposable directory inside
this package, with a PATH containing only local inert command fakes and native
`/usr/bin/grep` and `/usr/bin/seq`. The shell runs with `-e`, matching the implicit
Linux workflow shell. No inherited environment is read or forwarded.

The fake curl records arguments and returns selected synthetic statuses and
content. It does not implement HTTP. The fake docker and npm record commands
without containers, databases, applications or installations. The installer
is a local fixture. Sleep is immediate. Tail returns synthetic logs without
opening the referenced path. Temporary files are removed in a `finally` block.

For `test-install.yml`, every inline run step is selected. The tests cover
the wrapper's behavior. They do not execute installer, npm, psql or curl internals.
For `refresh-screenshots.yml`, only the readiness slice from the waiting
message through the final health-check `fi` executes. Application startup,
the fixed shared log write, screenshot capture, service declarations, event
expressions and third party actions are outside coverage.

## Confirmed KNOWN GAP defects

1. Fresh-install health polling exits successfully after all thirty requests
   fail. The desired assertion requires a nonzero status. Current shell returns
   0 after 30 failed probes and 31 successful sleep calls, with no success
   message. The later endpoint check may still fail the job, but this readiness
   step itself reports success incorrectly.
2. Fresh-install container checks accept similarly named containers instead
   of required identities. For each required container, replacing its name
   with the same name plus `-unrelated` still returns 0. The desired assertion
   expects failure for all three decoys. Native grep reproduces the defect.

No claim is made about redirects or database SQL-error semantics because
those would require testing the real delegated tool behavior.

Needs decisions: none. These tests record existing defects without editing
either workflow.
