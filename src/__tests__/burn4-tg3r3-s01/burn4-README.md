# Collector worker offline regression coverage

This package executes the unchanged `collector/worker.js` default export in a VM. The only source rewrite replaces `export default` with an assignment so Jest can call the worker. The VM receives native inert URL/request/response primitives, a fixed clock, an in-memory edge cache, a fake D1 adapter and a mocked origin fetch. It has no process, module loader, caller environment or real network function.

The 73 cases include 69 ordinary behavior checks and four named expected failures. Coverage includes endpoint dispatch, CORS and cookie absence, malformed JSON, missing ids, clamping and deployment sanitation, parameterized upsert SQL, first-seen preservation, DB failures, request privacy, release response parsing, edge cache clone/TTL behavior, simultaneous cache misses and all nine concurrent stats queries. Privacy getters throw if the worker reads request headers, address, cookies or Cloudflare metadata. Stats success uses equality between two references to one opaque symbol via a fake URL parser. No credential string is created or read.

Run from the repository root with dependencies already installed:

```sh
node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s01/burn4-worker-dispatch.test.ts src/__tests__/burn4-tg3r3-s01/burn4-worker-checkin.test.ts src/__tests__/burn4-tg3r3-s01/burn4-worker-cache.test.ts src/__tests__/burn4-tg3r3-s01/burn4-worker-stats.test.ts src/__tests__/burn4-tg3r3-s01/burn4-worker-gaps.test.ts --cacheDirectory /tmp/burn4-tg3r3-s01-jest
node_modules/.bin/eslint src/__tests__/burn4-tg3r3-s01/burn4-*.ts --max-warnings=0
node_modules/.bin/tsc --project src/__tests__/burn4-tg3r3-s01/burn4-tsconfig.json --noEmit
```

Strict TypeScript checks only the test and harness files. The JavaScript worker executes in the VM and is not typechecked by this scoped command. D1 is a recording fake with an in-memory upsert model; SQL shape assertions complement the model. This package does not verify a real SQLite engine, Cloudflare runtime, release service, full repository suite or production data.

## KNOWN GAP defects

- JSON `null` crashes at `body.id` instead of producing the same 400 validation response as other invalid bodies.
- Edge cache lookup rejection escapes after the check-in has been stored; the expected response is success with `latestVersion: null`.
- Release fetch rejection escapes after the check-in has been stored; the expected response is success with `latestVersion: null`, matching the existing non-OK upstream response behavior.
- Cache write rejection escapes after a valid release response and stored check-in; the expected response retains the fetched release.

Each `test.failing` contains one intended behavior assertion. The null case recognizes only its exact validation exception; the dependency cases recognize only their injected exception identity. Removing `.failing` in an untracked lane-local probe produced four assertion failures, receiving `undefined` where the expected status or response body was required. The probe did not fail during unrelated setup.

## Needs decision

None. These additions pin defects without changing worker behavior. A future implementation can decide how to map D1 failures to an HTTP response. Current ordinary tests accurately record that they reject before release lookup.
