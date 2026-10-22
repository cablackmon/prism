# Telemetry identity, storage, and check-in coverage

Plan revision 2. These tests execute unchanged current master source from:

- `src/lib/telemetry/instanceId.ts`
- `src/lib/telemetry/store.ts`
- `src/lib/telemetry/constants.ts`
- `src/lib/telemetry/checkIn.ts`

The test loader reads each source file, transpiles it in memory, and executes it
in a VM with an explicit dependency allowlist. The VM receives only a synthetic
process object, local database/provider/configuration fakes, a frozen clock, and
a fake fetch. It cannot import an unlisted dependency. No host environment value,
database, mailbox, or collector is accessed. Source text is not rewritten.

There are 63 cases: 62 ordinary passing cases and one named expected failure.
No cases are skipped. Existing `telemetry/__tests__/version.test.ts` was read;
the new tests verify the public reexports without repeating its version matrix.

Coverage includes every runtime export in the four listed modules:

- Settings reads retain false, zero, empty, null, array, and object values.
  Inserts and updates are scoped to one key, preserve unrelated records, record
  modification times, and expose storage failures. The real store and identity
  implementations are also composed to verify persistence across instances.
- Instance identity is reused after restart, created only when missing or
  invalid, regenerated after explicit removal, and withheld when persistence
  fails. Randomness and lookup failures remain observable.
- Endpoint resolution handles absent, whitespace, and trimmed configuration.
  Enablement checks opt-out defaults, explicit false, and synthetic hard-disable
  priority. Disabled and inert builds do not create identity or make HTTP calls.
- Payload assertions require exactly the anonymous fields. Check-in behavior
  covers the POST contract, ten-second timeout request, HTTP failures, invalid
  response bodies, version normalization, best-effort metadata persistence,
  dependency failures, retry after failure, and opt-out during a pending check.
- Version helpers are exercised through the check-in module's public reexports.

Run from the repository root with installed dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p04/burn4-telemetry-storage.test.ts src/__tests__/burn4-p04/burn4-telemetry-check-in.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p04/burn4-telemetry-vm.ts src/__tests__/burn4-p04/burn4-telemetry-storage.test.ts src/__tests__/burn4-p04/burn4-telemetry-check-in.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p04/burn4-tsconfig.json
```

All three focused commands passed. TypeScript uses the repository's strict
settings and includes these tests plus their transitive source imports. The VM
source is not instrumented, so no numerical coverage claim is made. The assigned
master modules contain no scheduler or busy guard; those are outside this scope.

## KNOWN GAP

**Concurrent first writes are not atomic upserts and violate the unique settings
key.** `writeSetting` reads for existence and then inserts without an atomic
conflict handler. Two simultaneous writes can both observe the key as absent.
The local database fake enforces the actual unique-key constraint from the
settings schema, so one insert rejects. An upsert should permit both callers to
complete while retaining a single row. This race also affects first-time
identity persistence when callers start together.

The named `test.failing` asserts that both writes fulfill. A temporary copy with
expected-failure inversion removed failed at that assertion with one fulfilled
and one rejected result. The probe log is retained in the lane state directory;
the temporary test copy is removed. No production fix is included.

## Needs decision

None.
