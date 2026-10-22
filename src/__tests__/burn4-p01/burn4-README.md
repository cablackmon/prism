# Runtime readiness and settings verification coverage

Plan revision: 2. These offline tests exercise unchanged current master source at base `5452b7c6cef8f9b3d9b5e936c748822e2a28535a`.

The package covers every runtime function exported by these five sources:

- `src/lib/config/runtime.ts`: HA mode, deployment channel precedence and sanitization, shared storage roots, independent photo and avatar overrides, empty overrides, and call-time path resolution.
- `src/lib/auth/settingsAuth.ts`: namespaced verification flags, ten-minute expiry, session isolation, renewal, missing Redis, exact stored markers, and cache command failures.
- `src/app/api/health/ready/route.ts`: healthy responses, database and Redis failures, connection acquisition failure, exact public response fields, recovery, and awaited checks.
- `src/app/api/setup/status/route.ts`: both completion values, changes between requests, awaited completion policy, and propagation of an unexpected policy rejection.
- `src/app/api/auth/settings-verified/route.ts`: real cache-to-handler verification, expiry, absent cookies, session isolation, cookie access failures, and Redis unavailability or acquisition failure.

Existing adjacent auth degradation, health-deep, setup-complete and settings tests were inspected. They do not directly exercise these target modules.

Runtime configuration is loaded from the unchanged source and transpiled into a VM with a synthetic `process` and a whitelist containing only the local path module. No host environment values are read or changed. Database, Redis, cookies, logging, setup policy and NextResponse boundaries are replaced with local fakes. The response fake delegates JSON serialization to the built-in `Response.json`; it does not start a server. Session-shaped values are inert synthetic fixtures. No services, actual cookies, accounts or credentials are used.

## Run only this package

From the repository root with dependencies already installed:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p01/burn4-runtime.test.ts src/__tests__/burn4-p01/burn4-settings-verification.test.ts src/__tests__/burn4-p01/burn4-status-handlers.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p01/burn4-runtime.test.ts src/__tests__/burn4-p01/burn4-settings-verification.test.ts src/__tests__/burn4-p01/burn4-status-handlers.test.ts src/__tests__/burn4-p01/burn4-runtime-fixture.ts
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-p01/burn4-tsconfig.json --noEmit
```

To collect focused coverage, append these options to the Jest command:

```sh
--coverage --collectCoverageFrom=src/lib/auth/settingsAuth.ts --collectCoverageFrom=src/app/api/health/ready/route.ts --collectCoverageFrom=src/app/api/setup/status/route.ts --collectCoverageFrom=src/app/api/auth/settings-verified/route.ts --coverageDirectory=/tmp/prism-burn4-p01-coverage
```

## Validation

Three suites contain 52 ordinary passing cases, zero expected failures and zero skipped cases. Focused ESLint and the restricted TypeScript config passed without diagnostics. No full suite, build, repository lint or whole-repository typecheck is claimed.

The four instrumented auth and route modules reached 100% lines, statements, functions and branches. `runtime.ts` executes inside the synthetic-process VM and is excluded from those percentages. Its five exported functions have behavior tests, but no instrumented coverage percentage is claimed for it.

The setup-status handler delegates normal setup failure policy to `isSetupComplete`, which is replaced with a fake here. The unexpected rejection test checks propagation to framework error handling; it does not claim to exercise Next.js error rendering or the database implementation of the shared setup policy.

## KNOWN GAP defects

None established by this package. There are no expected-failure cases or applicable negative gap probes in this revision.

## Needs decision

None.
