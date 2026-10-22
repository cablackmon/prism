# Viewport cold boot and subscriber lifecycle

This package covers the unchanged `src/lib/hooks/useViewportSize.ts` using real React and synthetic consumers. The existing tests already cover simple resize and orientation events. These additions cover the layout-to-passive-effect viewport change without an event, independent server snapshots, StrictMode cleanup, subscriber removal, remounts, single-axis changes, memoized consumers, rapid event batches and native event delivery after unmount.

The cold-boot consumer changes the jsdom viewport in a layout effect after the hook's initial read. No event is dispatched. It first observes `1024x768`, then must render the settled `1920x1080` dimensions. A separate node-environment file renders the hook with no window binding and verifies zero-size server snapshots.

Only local jsdom dimensions and events are used. Property descriptors are restored after each browser case. Listener tracking forwards events to the original callback, records callback identities, and removes the same native wrapper during cleanup. No excluded dashboard consumers, filesystem storage, network, family data, environment values or services are involved.

Run only this package from the repository root:

```sh
node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q10/burn4-viewport-lifecycle.test.tsx src/__tests__/burn4-tg3r2-q10/burn4-viewport-server.test.tsx
node_modules/.bin/eslint src/__tests__/burn4-tg3r2-q10/burn4-viewport-fixture.tsx src/__tests__/burn4-tg3r2-q10/burn4-viewport-lifecycle.test.tsx src/__tests__/burn4-tg3r2-q10/burn4-viewport-server.test.tsx --max-warnings 0
node_modules/.bin/tsc --project src/__tests__/burn4-tg3r2-q10/burn4-tsconfig.json
```

Verified: 10 ordinary passing cases, zero expected failures, zero failures and zero skipped cases. Focused ESLint passed with zero warnings. Scoped strict TypeScript passed with no diagnostics and includes the source hook. No whole-repository suite or typecheck is claimed.

A disposable lane-local transform removed only the immediate `update()` call from the source text in memory. The cold-boot test then failed at the final DOM assertion, receiving `1024x768` instead of `1920x1080`. The production file was never edited. This confirms the new case protects the documented race, rather than duplicating a post-mount resize test.

KNOWN GAP list: none found. The tests protect existing behavior.

Needs-decision list: none.
