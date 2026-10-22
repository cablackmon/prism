# Alexa deployment preparation coverage

This package runs unchanged `alexa/deploy.ps1` through real PowerShell 7 with synthetic manifest/model files and an inert ask command. It adds 29 cases: 28 ordinary passes and one confirmed expected failure. Production source is unchanged.

## Runtime prerequisite

These explicit tests need PowerShell 7 on a Unix host with `/bin/sh`. The package finds it through repository `node_modules/.bin/pwsh`, `/usr/bin/pwsh` or `/usr/local/bin/pwsh`. It never reads the caller environment to find the runtime. The normal Jest matcher does not select `.powershell.ts` files, so this prerequisite applies only to the separate package command.

An existing local PowerShell installation is enough. Alternatively, install the official portable runtime in a disposable location before offline testing:

```sh
mkdir -p /tmp/prism-burn4-pwsh/runtime
gh release download v7.6.7 --repo PowerShell/PowerShell --pattern powershell-7.6.7-linux-x64.tar.gz --dir /tmp/prism-burn4-pwsh
printf '%s\n' '6896f9e3a6b0a354bf470835a96da76d2f801cd50dcf047ad7c4563bf93bf431  /tmp/prism-burn4-pwsh/powershell-7.6.7-linux-x64.tar.gz' | sha256sum --check
tar -xzf /tmp/prism-burn4-pwsh/powershell-7.6.7-linux-x64.tar.gz -C /tmp/prism-burn4-pwsh/runtime
chmod +x /tmp/prism-burn4-pwsh/runtime/pwsh
ln -s /tmp/prism-burn4-pwsh/runtime/pwsh node_modules/.bin/pwsh
```

The archive digest matches the official [PowerShell v7.6.7 release](https://github.com/PowerShell/PowerShell/releases/tag/v7.6.7). Runtime setup is separate from the offline tests. No runtime binary is committed, and no test downloads dependencies.

## Focused commands

From the repository root with JavaScript dependencies and PowerShell already installed:

```sh
./node_modules/.bin/jest --config src/__tests__/burn4-tg3r4-a09/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r4-a09/burn4-preparation.powershell.ts src/__tests__/burn4-tg3r4-a09/burn4-failures.powershell.ts src/__tests__/burn4-tg3r4-a09/burn4-gaps.powershell.ts --cacheDirectory /tmp/prism-burn4-a09-jest
./node_modules/.bin/eslint src/__tests__/burn4-tg3r4-a09/*.ts src/__tests__/burn4-tg3r4-a09/burn4-jest.config.cjs --no-ignore --max-warnings 0
./node_modules/.bin/tsc -p src/__tests__/burn4-tg3r4-a09/burn4-tsconfig.json --noEmit --incremental false
./node_modules/.bin/jest --config jest.config.js --runInBand --listTests src/__tests__/burn4-tg3r4-a09 --json
```

The last command lists no tests. It only checks discovery for this package; it executes no default suite. TypeScript checks the new tests/harness only. ESLint explicitly includes the CJS config. There is no whole-repository build or PowerShell lint claim.

## Behaviors and isolation

Coverage includes hostname preflight, all-occurrence substitution, byte/newline/UTF-8 preservation, staging creation/reuse, recursive model copying, stale model replacement, repeated preparation, independent concurrent fixtures, ask arguments and working directory, missing/wrong-kind files, injected filesystem failures, missing/throwing ask and location restoration failures.

Every fixture lives under this package directory and is removed after its test. It copies the source script byte-for-byte and verifies that copy before each run. Metadata and models are invented test files; committed skill metadata and account configuration are never read. The child receives a fresh environment object with only synthetic configuration and fixture paths, a fixture-only PATH, bundled PowerShell modules and fixture cache/config/data/temp directories. Profiles, update checks and telemetry are disabled. No actual environment values or credentials are read, created or logged.

Instrumented runs use a PowerShell driver that wraps every filesystem/location command used by the source. Every path is normalized and rejected unless inside the fixture, then forwarded to the bundled local cmdlet. Expected failures are injected only at named fixture operations. Ask is an inert recording or throwing function. Other operational commands fail closed. These runs report source exceptions and location traces; their wrapper status is not used to establish the native-command gap.

Native runs invoke the unchanged fixture script directly with `pwsh -File`. They place one inert ask executable on the otherwise empty PATH. That executable uses only shell builtins to record synthetic arguments/current directory and exit with a configured status. The known source's filesystem and location paths remain anchored under its disposable script directory. Direct runs avoid assigning a harness exit status and therefore observe the actual source CLI behavior. They perform no deployment, provider authentication, networking, dependency installation or archive operation.

These are command orchestration and local file behavior tests. They do not validate ASK CLI, Alexa account settings, actual skill schema, Windows behavior or a real deployment.

## KNOWN GAP list

- Native ask deployment failure returns a successful script exit. An inert ask returns status 17 after receiving the expected targets in the staged directory, while direct `pwsh -File deploy.ps1` returns 0. The desired assertion requires a nonzero script status. The source does not check LASTEXITCODE after ask; successful location cleanup leaves the deployment failure unreported to callers.

The direct assertion was verified without expected-failure inversion. Reproduce with a temporary new file, leaving the committed gap file untouched:

```sh
python3 - <<'PY'
from pathlib import Path
root = Path('src/__tests__/burn4-tg3r4-a09')
source = root / 'burn4-gaps.powershell.ts'
target = root / 'burn4-inverse.powershell.ts'
with target.open('x') as handle:
    handle.write(source.read_text().replace('test.failing(', 'test('))
PY
./node_modules/.bin/jest --config src/__tests__/burn4-tg3r4-a09/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r4-a09/burn4-inverse.powershell.ts --cacheDirectory /tmp/prism-burn4-a09-jest
```

The inverse command exits 1 at the final nonzero-status assertion after its native invocation preconditions pass. Remove only the temporary file afterward:

```sh
python3 - <<'PY'
from pathlib import Path
Path('src/__tests__/burn4-tg3r4-a09/burn4-inverse.powershell.ts').unlink()
PY
```

Needs-decision list: none. No additional hostname policy, deployment transaction guarantee or account/region behavior is asserted.
