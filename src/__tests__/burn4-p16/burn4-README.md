# Integration status lifecycle and provider presentation

These tests exercise the unchanged current master source at `5452b7c6cef8f9b3d9b5e936c748822e2a28535a`:

- `src/app/settings/sections/integrations/shared/useIntegrationStatus.ts`
- `src/app/settings/sections/integrations/shared/useOAuthConfigStatus.ts`
- `src/app/settings/sections/integrations/shared/ConnectionStatusBadge.tsx`
- `src/app/settings/sections/integrations/cards/KrogerProviderCard.tsx`

No direct tests of these four exports existed in the base. The hooks run through real React rendering and effects. Deferred local fetch and JSON responses cover initial loading, stable refetch identity, account identities and split-account arrays, visible prior data during refresh, transport/HTTP/JSON failures, recovery, independent consumers and overlapping refreshes. OAuth configuration tests distinguish unknown configuration from false configuration, check rerender stability, cancel a late response after unmount and exercise StrictMode effect cleanup with out-of-order responses.

Badge tests follow disconnected, connected and expired transitions through accessible button names, and check the actual variant, caller class and text delegated to Badge. Alpha and setup-required labels remain readable without nested controls. The Kroger wrapper test checks the provider anchor, mounted connection-card delegation, preservation of child state across rerenders and cleanup on unmount.

All fetch responses are local fakes with synthetic account identities. The excluded Badge dependency is a DOM-preserving fake, so these tests check prop delegation and readable output, not Badge CSS. The excluded KrogerConnectionCard is a stateful fake, so the wrapper test checks mounting and lifecycle without running account operations or credential forms. No network requests, host environment values, credentials or family data are used. Production source is unchanged.

Run from the repository root using its existing dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p16/burn4-integration-status.test.tsx src/__tests__/burn4-p16/burn4-oauth-config.test.tsx src/__tests__/burn4-p16/burn4-cards.test.tsx
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p16/burn4-fixtures.ts src/__tests__/burn4-p16/burn4-integration-status.test.tsx src/__tests__/burn4-p16/burn4-oauth-config.test.tsx src/__tests__/burn4-p16/burn4-cards.test.tsx
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p16/burn4-tsconfig.json --pretty false
```

For focused coverage, append these arguments to the Jest command:

```sh
--coverage --collectCoverageFrom='src/app/settings/sections/integrations/shared/useIntegrationStatus.ts' --collectCoverageFrom='src/app/settings/sections/integrations/shared/useOAuthConfigStatus.ts' --collectCoverageFrom='src/app/settings/sections/integrations/shared/ConnectionStatusBadge.tsx' --collectCoverageFrom='src/app/settings/sections/integrations/cards/KrogerProviderCard.tsx'
```

Validation: 21 ordinary passing tests plus 2 named expected failures, 23 total, no skipped tests. Jest reports all 23 as passed because `test.failing` inverts the expected failures. Focused coverage is 100% statements, branches, functions and lines across all four targets, including the expected-failure cases. Focused ESLint and scoped TypeScript pass with zero warnings or diagnostics. The TypeScript project checks these tests and their imported source graph. No whole suite or whole-repository check was run.

## KNOWN GAP

- **An older integration status request overwrites the newest completed refresh.** When two refetch calls overlap, the older request can complete last and replace current account identities with stale data. The desired assertion retains the newest request's data.
- **An earlier refresh clears loading while the latest integration status request is pending.** Each request independently clears loading in its finally block, so an older completion can hide the latest refresh's pending state. The desired assertion keeps loading true until the latest request completes.

Both cases were also run as ordinary tests. They failed at their final desired-behavior assertions: stale account data instead of the newest object, and false instead of true for loading while the latest request was pending. All deferred requests were completed in each test. Raw proof remains in the lane evidence, and no temporary probe copy is committed.

## Needs decision

None. The draft records the two race defects for review.
