import { assertConcurrentIsolation, assertPartialWriteCleanup } from './burn4-reset-gap-cases';

// Explicit-only reproduction: the same intended assertions run as ordinary tests.
// This file is excluded by the package's normal testMatch.
test(
  'KNOWN GAP inverse: same-millisecond reset calls must preserve both pending payloads',
  assertConcurrentIsolation,
);

test(
  'KNOWN GAP inverse: partial temporary write artifacts must be removed',
  assertPartialWriteCleanup,
);
