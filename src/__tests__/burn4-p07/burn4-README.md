# OAuth profile and redirect helper coverage

Plan revision 2 covers these current master sources without changing them:

- `src/lib/integrations/oauth-userinfo.ts`
- `src/lib/integrations/oauthSetupRedirect.ts`
- `src/lib/integrations/kroger/redirect.ts`
- `src/lib/utils/googleRedirectSupport.ts`

The tested master SHA is `5452b7c6cef8f9b3d9b5e936c748822e2a28535a`.
Every runtime export receives behavior coverage. All provider fetches and
logging are mocked. The setup helper is read unchanged from the source tree,
transpiled, and evaluated in a fresh VM with an invented `process.env` object
and a mocked `NextResponse.redirect`. It never imports the source into the host
process or reads host environment values. Other redirect tests use local
Request objects. No provider, database, Redis server, deployment, or real family
data is used.

## Run from the repository root

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p07/burn4-oauth-userinfo.test.ts src/__tests__/burn4-p07/burn4-oauth-redirects.test.ts src/__tests__/burn4-p07/burn4-google-redirect-support.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p07/burn4-oauth-userinfo.test.ts src/__tests__/burn4-p07/burn4-oauth-redirects.test.ts src/__tests__/burn4-p07/burn4-google-redirect-support.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p07/burn4-tsconfig.json --pretty false
```

Optional focused coverage arguments for the Jest command:

```sh
--coverage --collectCoverageFrom=src/lib/integrations/oauth-userinfo.ts --collectCoverageFrom=src/lib/integrations/kroger/redirect.ts --collectCoverageFrom=src/lib/utils/googleRedirectSupport.ts --coverageDirectory=/tmp/prism-burn4-p07-coverage
```

## Behavior covered

- All three account-email helpers: provider endpoint selection, authorization
  headers, lowercasing, missing fields, rejected HTTP responses, malformed
  payloads, transport errors, JSON errors, and nonfatal logging. Microsoft mail
  priority and the userPrincipalName fallback also receive direct coverage.
- Setup configuration precedence, default origin, isolation between loaded
  configurations, provider-specific banner parameters and anchors, response
  delegation, framework failures, and missing-configuration error recognition.
- Kroger request origin fallback, proxy header precedence, independent protocol
  override, ports, IPv6 hosts, case-insensitive headers, and request preservation.
- Additional Google redirect boundaries absent from the existing
  `src/lib/utils/__tests__/googleRedirectSupport.test.ts`: IPv6 loopback,
  nonloopback IPv6, remaining private hostname suffixes, internationalized
  hostname parsing, and nonweb protocols. Existing ordinary public-host, LAN,
  null-origin, and invalid-origin cases were read and are not duplicated here.

## Validation evidence

The focused run has 82 tests: 73 ordinary passing cases and 9 named
`test.failing` instances, with zero skipped. The expected failures cover five
defect types below. Jest reports 82 passed because those defects still
reproduce. Every gap instance was also run as an ordinary test and failed at
its intended assertion. Raw assertion proofs are retained in the lane state;
temporary probe copies are not part of this package.

Focused ESLint and scoped TypeScript both pass without diagnostics. No full
suite, application build, or live-service checks were run.

The profile and Kroger modules have 100% statements, lines, functions, and
branches in the focused coverage run. The additional Google edge cases cover
85% statements, 92.85% lines, 100% functions, and 75% branches. The new tests
alone do not repeat all existing Google coverage. Combined metrics for those
three directly imported modules are 95% statements, 98.03% lines, 100%
functions, and 92% branches, including defect probes. The VM-executed setup
module is outside Jest instrumentation and has no numeric coverage claim.

## KNOWN GAP defects

1. Google, Gmail, and Microsoft profile helpers return a whitespace-only email
   as a connected-account address instead of returning null. Three probes.
2. A trailing slash in the configured setup base creates `//settings` instead
   of `/settings`. One probe.
3. Comma-separated proxy host and protocol chains produce an invalid Kroger
   callback URL instead of using the original public origin. One probe.
4. Google browser OAuth detection accepts nonweb loopback schemes because the
   loopback check runs before protocol rejection. FTP and WebSocket probes.
5. A trailing DNS dot lets private `.local` and `.internal` hosts pass Google
   browser OAuth detection. Two probes.

Each expected-failure test asserts the desired correct behavior. Production
sources are unchanged.

## Needs decision

None. Defect fixes are outside this coverage package.
