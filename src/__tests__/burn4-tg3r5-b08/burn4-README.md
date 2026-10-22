# HTTPS setup command orchestration

This package runs the unchanged `scripts/setup-https.ps1` in a disposable synthetic project through a separately installed local PowerShell 7 runtime. It covers mandatory parameters, command availability, ordering and arguments, domain splitting, directory handling, terminating command failures, simulated native exit statuses, completion messages, concurrent isolation and working-directory cleanup.

All eight commands visible in the subject resolve to in-process functions defined by the driver. Before subject execution, the driver verifies those function bindings and parses the unchanged source against its command allowlist. Unallowlisted or dynamic commands, environment-provider access and member invocation are denied. Separate safety probes verify those controls before the subject starts. Filesystem wrappers constrain directory operations to the fixture. All file creation is denied by the subject-facing wrapper. The script has no file-copy operation, so no copy-failure behavior is invented here.

`mkcert` never runs. Its install, generation and root-query functions are inert. No certificate, private key or PEM file is created or read, and no trust store changes. The root query returns an ordinary fixture directory pathname without discovering or accessing a CA. Output consists of source status text and ordinary synthetic paths or hostnames. The source instructions naming tools remain text and are never executed.

The PowerShell child receives an explicit ordinary runtime environment built from an empty map. It inherits no caller values. PATH contains only an empty fixture bin directory. Runtime module/cache/config/data/temp paths remain explicitly scoped. Telemetry and update checks are disabled. The tests neither install software nor write to dependencies or the shared runtime. Each child has a ten-second timeout and each fixture is removed after its test.

## Runtime prerequisite

Install PowerShell 7 separately before running this package, or expose an existing read-only runtime through `node_modules/.bin/pwsh`. The harness also recognizes `/usr/bin/pwsh` and `/usr/local/bin/pwsh`. It discovers filesystem paths and reads no process environment values. The current verification reused the prior lane's existing `node_modules/.bin/pwsh` symlink and PowerShell 7.6.7 runtime read-only. No runtime or dependency installation was performed. Disposable fixtures use `/tmp`, so the current runner targets a POSIX Node host with PowerShell 7.

Default Jest discovery does not include the `.powershell.ts` files. Run only these explicit files with the package config from the repository root:

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r5-b08/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b08/burn4-safety.powershell.ts src/__tests__/burn4-tg3r5-b08/burn4-behavior.powershell.ts src/__tests__/burn4-tg3r5-b08/burn4-gaps.powershell.ts
node node_modules/eslint/bin/eslint.js --no-ignore --max-warnings 0 src/__tests__/burn4-tg3r5-b08/burn4-fixture.ts src/__tests__/burn4-tg3r5-b08/burn4-safety.powershell.ts src/__tests__/burn4-tg3r5-b08/burn4-behavior.powershell.ts src/__tests__/burn4-tg3r5-b08/burn4-gaps.powershell.ts src/__tests__/burn4-tg3r5-b08/burn4-jest.config.cjs src/__tests__/burn4-tg3r5-b08/burn4-inverse.mjs
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r5-b08/burn4-tsconfig.json
node src/__tests__/burn4-tg3r5-b08/burn4-inverse.mjs
```

The package has 37 accepted cases: 33 ordinary passes and four expected failures. Focused lint has zero warnings. Strict scoped TypeScript checks only the new tests and fixture harness, with no incremental output. PowerShell source and driver are executed by the explicit tests rather than TypeScript checked. The inverse command copies only this package and the unchanged subject into a temporary repository, replaces the four `test.failing` registrations with ordinary tests, and verifies that all four fail at their intended behavior assertion. It prints a concise proof and removes the copy. It never changes repository source or the checked-out tests.

## KNOWN GAP list

- Nonzero native CA installation status does not stop certificate generation.
- Nonzero native generation status still announces a written certificate.
- Nonzero native CA-root status still announces completion.
- Terminating generation failure leaks the pushed working directory.

Native failure cases are simulated by an in-process function setting `LASTEXITCODE` to nine without throwing, matching the ordinary native status boundary. No native tool is executed. The CA-root status case deliberately returns a harmless fixture pathname as partial output despite its nonzero status. This pins the missing status check; it does not claim to model all mkcert failure output.

The gap assertions state the desired behavior. A future source fix that throws, exits or suppresses false completion can make them pass and therefore make `test.failing` report an unexpected pass. The three native cases retain only call/status evidence before the intended behavior assertion, so an exception-based fix cannot be hidden by a null-error precondition.

No needs-decision items. Actual certificate validity, trust installation, Windows-specific native behavior, real CA discovery and service availability remain outside this offline orchestration package. Production source is unchanged.
