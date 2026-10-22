import { attempt, loadResetHarness, ResetWorld } from './burn4-reset-harness';

export function assertConcurrentIsolation(): void {
  const world = new ResetWorld();
  const second = loadResetHarness({ world });
  let secondStarted = false;
  let secondError: unknown;
  const first = loadResetHarness({
    world,
    beforeExecute: (entry) => {
      if (entry.operation === 'sql' && !secondStarted) {
        secondStarted = true;
        secondError = attempt(second.api.resetShoppingItems);
      }
    },
  });
  const firstError = attempt(first.api.resetTasks);
  const kinds = world.trace.filter((entry) => entry.action === 'read').map((entry) => entry.payload?.kind);
  const paths = world.trace.filter((entry) => entry.action === 'write').map((entry) => entry.path);
  expect({
    firstSucceeded: firstError === undefined,
    secondSucceeded: secondStarted && secondError === undefined,
    eachReadOwnPayload: kinds.includes('tasks') && kinds.includes('shopping'),
    distinctTemporaryPaths: new Set(paths).size === 2,
    allTemporaryFilesRemoved: world.remainingFileCount === 0,
  }).toEqual({
    firstSucceeded: true,
    secondSucceeded: true,
    eachReadOwnPayload: true,
    distinctTemporaryPaths: true,
    allTemporaryFilesRemoved: true,
  });
}

export function assertPartialWriteCleanup(): void {
  const failure = new Error('Synthetic partial write failure');
  const { api, world } = loadResetHarness({ partialWriteFailure: failure });
  const error = attempt(api.resetTasks);
  expect({
    originalFailurePreserved: error === failure,
    noSubprocessExecuted: !world.trace.some((entry) => entry.action === 'execute'),
    allTemporaryFilesRemoved: world.remainingFileCount === 0,
  }).toEqual({
    originalFailurePreserved: true,
    noSubprocessExecuted: true,
    allTemporaryFilesRemoved: true,
  });
}
