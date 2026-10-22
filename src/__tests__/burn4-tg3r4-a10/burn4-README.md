# Offline PowerShell demo recorder coverage

This package executes an unchanged copy of `scripts/record-demos.ps1` in a disposable project using real PowerShell 7. It runs separately from the default Jest suite. The new `burn4-*.powershell.ts` filenames match only this package's explicit config.

Prerequisites: repository development dependencies and PowerShell 7. The harness checks `node_modules/.bin/pwsh`, `/usr/bin/pwsh` and `/usr/local/bin/pwsh` using filesystem paths. It never reads the caller environment. A portable runtime can be linked into the first location:

```sh
ln -s /absolute/path/to/pwsh node_modules/.bin/pwsh
```

The lane used an official PowerShell 7.6.7 archive with its release digest verified before extraction. The runtime is a prerequisite, not a committed dependency or an automatic download. Missing runtime is an explicit error rather than a skipped test.

Run from the repository root:

```sh
./node_modules/.bin/jest --config src/__tests__/burn4-tg3r4-a10/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r4-a10/burn4-recorder-behavior.powershell.ts src/__tests__/burn4-tg3r4-a10/burn4-recorder-gaps.powershell.ts
./node_modules/.bin/eslint --max-warnings 0 src/__tests__/burn4-tg3r4-a10/burn4-recorder-fixture.ts src/__tests__/burn4-tg3r4-a10/burn4-recorder-behavior.powershell.ts src/__tests__/burn4-tg3r4-a10/burn4-recorder-gaps.powershell.ts src/__tests__/burn4-tg3r4-a10/burn4-jest.config.cjs
./node_modules/.bin/tsc --project src/__tests__/burn4-tg3r4-a10/burn4-tsconfig.json --noEmit --incremental false
```

Validation: 27 cases, comprising 24 ordinary passes and 3 expected failures, with no failures or skipped cases. Focused lint passes with zero warnings. Strict scoped TypeScript covers tests and harness only; PowerShell source is exercised rather than typechecked. The lane adds a local Jest cache/report path. No default suite, full build, browser or production validation is claimed.

The child process inherits no environment. Explicit configuration points PATH to inert shell fakes, PowerShell module lookup to bundled modules, and temp/cache/config/data to the fixture. Profiles, telemetry and update checks are disabled. The HTTP function validates and returns a synthetic result without a transport. Native docker, npx and ffmpeg fakes validate exact argument shapes, record stage/status/working directory and use shell builtins only. npx writes tiny synthetic video marker files; ffmpeg writes arbitrary GIF marker bytes. No SQL, recording or encoding happens outside the fixture. Temporary fixture trees are removed after each test, and each runtime child has a ten-second timeout.

The launch uses PowerShell `-Command` with an initialization prelude followed by invocation of the unchanged source. This preserves the source's explicit exit failures while allowing its final successful host output to return zero. Separate harmless controls compared this launch with direct `-File` execution for explicit exit, a native failure followed by host output, and a terminating exception. Location-restoration tests use a finally observer; process-status tests have no observer after source invocation.

Ordinary coverage includes command and HTTP preflight, output directory creation, selective reset SQL and cleanup, optional reset exceptions, capture arguments and project working directory, finally restoration, tolerated capture failures with partial videos, no-video failure, all seven scenario mappings, recursive discovery, non-video exclusion, unmatched basename and paths with spaces, encoder arguments, missing output reporting and summary count/rounded size.

KNOWN GAP list:

- Native database or Redis reset failures are announced as Data reset. Two cases verify the native failure reached the expected stage before asserting truthful reporting. Continued execution is intentional and is not the defect.
- A failed encoder accepts a pre-existing GIF as successful output. The test verifies the stale bytes remain unchanged before asserting that they should not be reported as a successful conversion.

Every expected-failure case was rerun with its failure inversion removed in an isolated copy. All three failed at the intended reporting assertion, after their native-stage prerequisites passed. Source behavior remains unchanged.

Current behavior limitation: a failed encoder with no output prints FAILED and No GIFs generated, then returns status zero. An ordinary test records this behavior. A written exit-status requirement was not found, so this is not classified as a KNOWN GAP.

Needs-decision list: None.
