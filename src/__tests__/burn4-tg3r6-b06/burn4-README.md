# Home Assistant safe runtime regression tests

This package exercises unchanged, anchored slices of ha-app/run.sh. It does not execute the complete entrypoint or verify deployment, a real database, Redis, application startup, external connections or secret handling.

Prerequisites: the repository's normal JavaScript test dependencies, /bin/bash, and /usr/bin/jq. These tests use the existing Jest, ts-jest and TypeScript dependencies and add no dependency. If dependencies need installation, run `npm ci --ignore-scripts --no-audit --no-fund` from the repository root using a local cache. Do not run the application's prepare, predev or build scripts for these tests.

From the repository root:

```sh
./node_modules/.bin/jest --config src/__tests__/burn4-tg3r6-b06/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r6-b06/burn4-options.test.ts src/__tests__/burn4-tg3r6-b06/burn4-startup.test.ts
./node_modules/.bin/tsc -p src/__tests__/burn4-tg3r6-b06/burn4-tsconfig.json
./node_modules/.bin/eslint src/__tests__/burn4-tg3r6-b06/burn4-runtime.ts src/__tests__/burn4-tg3r6-b06/burn4-options.test.ts src/__tests__/burn4-tg3r6-b06/burn4-startup.test.ts --max-warnings 0
node --check src/__tests__/burn4-tg3r6-b06/burn4-jest.config.cjs
```

The test configuration runs only this package and does not load the repository-wide setup. The TypeScript check is strict and covers the new tests and harness; it does not typecheck Bash. The Jest configuration has a separate Node syntax check.

## Execution boundaries

The harness reads the source as text, then extracts these unchanged statements using unique start anchors and adjacent end anchors. Line numbers describe base master 5452b7c6cef8f9b3d9b5e936c748822e2a28535a and are not the extraction mechanism.

| Slice | Source lines | Behavior |
| --- | --- | --- |
| Supervisor guard | 27 | Missing options invokes the inert fatal helper. |
| Non-sensitive option reader | 31-34 | Actual opt function, log level and bundled option parsing. |
| Photo and telemetry inputs | 37-38 | Actual photo directory and anonymous-stats parsing. |
| Photo and telemetry decisions | 42-49 | Telemetry opt-out, quoted mkdir and photo-root export. |
| Schema and app boundary | 131-146 | Probe, conditional base apply, migration ordering, listener settings and shell replacement. |

The external connection option assignments at lines 35-36, option-value log at line 40, and every statement in lines 51-120 are excluded before shell execution. The source log/die helpers and path assignments are replaced with private inert fixtures. No options file, secret file, database directory, app directory or log file is opened or created. The test does not execute bundled service preparation. A forbidden-section guard rejects accidental inclusion of credential and connection-handling code.

Every child starts with `env: {}`. No inherited environment is read by the harness. Bash uses a private PATH with no executable directory, an inert file-test function, inert mkdir/psql/cd/node/exec functions, and a denied unknown-command handler. No command text or unknown arguments are logged. The only executable reached by a tested slice is /usr/bin/jq, through a guarded function that permits four known query expressions and supplies synthetic ordinary JSON on stdin. No connection option query is permitted. The database argument is a private empty shell variable and psql is always an inert function. No network or database process starts.

The event channel contains fixed labels and boolean classifications only. Bundled/external labels classify the parsed option; the database-selection branch itself is excluded. It does not print option values, exported values, connection arguments or source log messages. All events share one descriptor so call order is preserved even inside the schema probe command substitution. Unexpected stdout is rejected. Shell replacement is modeled by checking the node argv, recording the listener check, calling the inert server function and terminating the fixture shell with its status.

## Coverage and known gaps

There are 25 ordinary cases and 3 confirmed expected-failure cases. Coverage includes Supervisor absence, configured and missing options, command-error fallbacks, quoted photo paths, mkdir failure, boolean versus string telemetry choices, existing versus absent schema, probe error/partial/empty output, schema and migration failures, listener setup, server failure and directory-change failure.

The expected-failure assertions require the intended safe behavior:

- **Boolean anonymous_stats=false fails to disable anonymous telemetry.** jq's alternative operator emits no value for false, so the existing false comparison is never true for the HA boolean option. A separate ordinary case confirms string false reaches the branch.
- **Schema probe errors are treated as a fresh database.** A failed psql probe substitutes f and attempts base schema application, although the source documents that the base schema is unsafe to reapply. The desired assertion forbids that application and requires startup to stop.
- **Failed app-directory change starts the server without migrations.** `cd /app && node scripts/migrate.js` skips migration when cd fails. Bash does not exit for the failed first command of that AND list, and the entrypoint reaches the server. The desired assertion forbids server startup and requires nonzero status.

Each gap was confirmed by a separate run that changed only `test.failing` to `test` in disposable copies of these same test files. All three fail at the first intended behavior assertion. The source remains unchanged. Partial/empty probe output and missing ordinary option values are documented observations, not additional claimed defects. No decision is needed.
