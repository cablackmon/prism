import { assertConcurrentIsolation, assertPartialWriteCleanup } from './burn4-reset-gap-cases';

test.failing(
  'KNOWN GAP: same-millisecond reset calls share a temporary file and lose a pending payload',
  assertConcurrentIsolation,
);

test.failing(
  'KNOWN GAP: a partial temporary write fails before cleanup and leaves its artifact behind',
  assertPartialWriteCleanup,
);
