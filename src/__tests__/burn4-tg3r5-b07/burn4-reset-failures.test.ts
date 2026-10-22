import { attempt, loadResetHarness, type ResetName } from './burn4-reset-harness';

const names: Exclude<ResetName, 'resetAll'>[] = [
  'resetTasks', 'resetShoppingItems', 'resetChoreCompletions', 'resetModes',
];

describe('burn4 reset errors and cleanup', () => {
  test.each(names)('%s stops immediately when writing fails before creating a file', (name) => {
    const failure = new Error('Synthetic write failure');
    const { api, world } = loadResetHarness({ beforeWrite: () => { throw failure; } });
    expect(attempt(api[name])).toBe(failure);
    expect(world.trace).toEqual([]);
    expect(world.remainingFileCount).toBe(0);
  });

  test.each(names)('%s removes its file and preserves the original execution failure', (name) => {
    const failure = new Error('Synthetic subprocess failure');
    const { api, world } = loadResetHarness({ beforeExecute: () => { throw failure; } });
    expect(attempt(api[name])).toBe(failure);
    expect(world.trace.map((entry) => entry.action)).toEqual(['write', 'execute', 'unlink']);
    expect(world.remainingFileCount).toBe(0);
  });

  test.each(names)('%s tolerates a failed cleanup after successful execution', (name) => {
    const { api, world } = loadResetHarness({
      beforeUnlink: () => { throw new Error('Synthetic unlink failure'); },
    });
    expect(attempt(api[name])).toBeUndefined();
    expect(world.trace.map((entry) => entry.action)).toEqual(['write', 'execute', 'read', 'unlink']);
    expect(world.remainingFileCount).toBe(1);
  });

  test('a failed cleanup never replaces the original subprocess failure', () => {
    const executionFailure = new Error('Synthetic execution failure');
    const { api, world } = loadResetHarness({
      beforeExecute: () => { throw executionFailure; },
      beforeUnlink: () => { throw new Error('Synthetic cleanup failure'); },
    });
    expect(attempt(api.resetTasks)).toBe(executionFailure);
    expect(world.trace.map((entry) => entry.action)).toEqual(['write', 'execute', 'unlink']);
  });

  test('resetAll stops before writing any data payload when cache clearing fails', () => {
    const failure = new Error('Synthetic cache failure');
    const { api, world } = loadResetHarness({ beforeExecute: () => { throw failure; } });
    expect(attempt(api.resetAll)).toBe(failure);
    expect(world.trace).toHaveLength(1);
    expect(world.trace[0]?.operation).toBe('redis');
    expect(world.remainingFileCount).toBe(0);
  });

  test.each([1, 2, 3, 4])('resetAll stops and cleans up at SQL step %i', (failureStep) => {
    let sqlCount = 0;
    const failure = new Error('Synthetic selected reset failure');
    const { api, world } = loadResetHarness({
      beforeExecute: (entry) => {
        if (entry.operation === 'sql' && ++sqlCount === failureStep) throw failure;
      },
    });
    expect(attempt(api.resetAll)).toBe(failure);
    expect(sqlCount).toBe(failureStep);
    expect(world.trace.filter((entry) => entry.action === 'read').map((entry) => entry.payload?.kind))
      .toEqual(['tasks', 'shopping', 'chores', 'modes'].slice(0, failureStep - 1));
    expect(world.trace.filter((entry) => entry.action === 'unlink')).toHaveLength(failureStep);
    expect(world.trace.at(-1)?.action).toBe('unlink');
    expect(world.remainingFileCount).toBe(0);
  });

  test('resetAll continues later steps after ignored unlink failures', () => {
    let tick = 0;
    const { api, world } = loadResetHarness({
      now: () => ++tick,
      beforeUnlink: () => { throw new Error('Synthetic cleanup failure'); },
    });
    expect(attempt(api.resetAll)).toBeUndefined();
    expect(world.trace.filter((entry) => entry.action === 'read')).toHaveLength(4);
    expect(world.trace.filter((entry) => entry.action === 'unlink')).toHaveLength(4);
    expect(world.remainingFileCount).toBe(4);
  });

});
