# OAuth start authorization and redirect coverage

Plan revision: 2. These tests exercise unchanged current master source at base `5452b7c6cef8f9b3d9b5e936c748822e2a28535a` for every exported GET handler in:

- `src/app/api/auth/google/route.ts`
- `src/app/api/auth/google-tasks/route.ts`
- `src/app/api/auth/microsoft/route.ts`
- `src/app/api/auth/microsoft-tasks/route.ts`

The package checks unchanged auth and role responses, capability selection, short circuits, authenticated ownership, routing defaults and encoded values, callback paths, provider redirects, requested task scopes, missing configuration, awaited state and credential work, and dependency failures. Existing state-helper and redirect-helper tests were inspected; these route handlers had no direct tests.

All four unchanged source files execute in a VM with synthetic process settings and a strict import whitelist. Auth, role checks, provider URL adapters, state creation, credential lookup, redirect resolution, setup responses and logging are local fakes. A response subclass preserves the `instanceof NextResponse` branch and implements JSON and redirect responses with local Web API objects. No Next.js server or provider runs. A fetch guard rejects unexpected network use. State-shaped and client-shaped values are inert synthetic strings; no actual state nonce or credential is generated, read or changed. Host environment values are never accessed.

Ordinary routing checks accept either a stored payload or the current JSON wire payload so they do not require the insecure state format to remain. Separate expected-failure cases require an opaque state value bound to the authenticated owner. The Microsoft stored-client fixture matches the synthetic configured client for ordinary cases; the database-only gap uses a distinct stored client with no process setting.

## Run only this package

From the repository root with dependencies already installed:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p12/burn4-oauth-common.test.ts src/__tests__/burn4-p12/burn4-provider-starts.test.ts src/__tests__/burn4-p12/burn4-task-starts.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p12/burn4-oauth-common.test.ts src/__tests__/burn4-p12/burn4-provider-starts.test.ts src/__tests__/burn4-p12/burn4-task-starts.test.ts src/__tests__/burn4-p12/burn4-oauth-fixture.ts
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-p12/burn4-tsconfig.json --noEmit
```

## Validation and limits

Three suites contain 60 test cases: 54 ordinary passing cases, six named expected failures, and zero skipped cases. Jest accepts all 60 because the six expected failures fail as intended. Focused ESLint and scoped TypeScript checks pass with no diagnostics. TypeScript checks the new tests and fixture; the production routes execute through transpilation in the VM. No fresh production typecheck, full suite, build or whole-repository lint is claimed here.

A temporary ordinary-test copy of the task cases produced exactly six intended assertion failures and 14 ordinary passes. The copy was removed before publication. Each failure is an assertion about missing state binding, a wrong configuration redirect, or an escaped dependency rejection. No import or mock method failures occurred.

The VM execution is not included in Jest source instrumentation, so no coverage percentage is claimed. Every handler is executed through real source. Provider implementations, callback handlers, actual session validation, credential persistence, nonce cryptography and reverse-proxy URI policy are mocked and outside this package. The state gaps describe missing start-side binding; these tests do not demonstrate a complete exploit or a completed callback flow.

## KNOWN GAP defects

1. Google Tasks sends routing JSON without session-bound opaque state. It does not call the state helper that binds the routing payload to the authenticated owner.
2. Microsoft Tasks sends routing JSON without session-bound opaque state. Task, shopping, wish and return routing data are sent without the same owner-bound helper used by the photo route.
3. Google Tasks redirect-resolution errors escape its JSON error response. A callback resolution failure rejects GET instead of returning its documented-in-code generic JSON 500 body and log context.
4. Microsoft Tasks redirect-resolution errors escape its JSON error response. The same resolution failure bypasses its provider error response.
5. Google Tasks credential-lookup rejection escapes its JSON error response. Credential lookup occurs outside the route's error boundary.
6. Microsoft Tasks ignores credentials stored through application settings. An installation with stored Microsoft client configuration and no process setting is redirected to setup instead of provider authorization.

Each named `test.failing` case asserts the desired behavior. The error-response cases require a resolved HTTP 500 response with the same JSON body and log context as the route's existing catch path. They do not require auth dependency failures, which occur before provider work, to be converted into that response. Source files are unchanged.

## Needs decision

None. Source fixes and callback changes are separate follow-up implementation work.
