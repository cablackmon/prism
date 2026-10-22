import { attempt, loadResetHarness, ResetWorld } from './burn4-reset-harness';

describe('burn4 reset deterministic interleavings across independent VMs', () => {
  test('sequential calls in the same millisecond reuse a path without stale payloads', () => {
    const { api, world } = loadResetHarness();
    api.resetTasks();
    api.resetShoppingItems();
    const paths = world.trace.filter((entry) => entry.action === 'write').map((entry) => entry.path);
    expect(new Set(paths).size).toBe(1);
    expect(world.trace.filter((entry) => entry.action === 'read').map((entry) => entry.payload?.kind))
      .toEqual(['tasks', 'shopping']);
    expect(world.remainingFileCount).toBe(0);
  });

  test('interleaved different-timestamp resets keep their own payloads', () => {
    const world = new ResetWorld();
    const second = loadResetHarness({ world, now: () => 101 });
    let secondStarted = false;
    const first = loadResetHarness({
      world, now: () => 100,
      beforeExecute: (entry) => {
        if (entry.operation === 'sql' && !secondStarted) {
          secondStarted = true;
          second.api.resetShoppingItems();
        }
      },
    });
    expect(attempt(first.api.resetTasks)).toBeUndefined();
    expect(secondStarted).toBe(true);
    expect(world.trace.filter((entry) => entry.action === 'read').map((entry) => entry.payload?.kind))
      .toEqual(['shopping', 'tasks']);
    expect(new Set(world.trace.filter((entry) => entry.action === 'write').map((entry) => entry.path)).size)
      .toBe(2);
    expect(world.remainingFileCount).toBe(0);
  });

  test('interleaved full resets remain ordered within each independent VM', () => {
    const world = new ResetWorld();
    let tick = 1;
    let secondStarted = false;
    const second = loadResetHarness({ world, now: () => tick++ });
    const first = loadResetHarness({
      world, now: () => tick++,
      beforeExecute: () => {
        if (!secondStarted) {
          secondStarted = true;
          second.api.resetAll();
        }
      },
    });
    expect(attempt(first.api.resetAll)).toBeUndefined();
    expect(world.trace.filter((entry) => entry.operation === 'redis')).toHaveLength(2);
    expect(world.trace.filter((entry) => entry.action === 'read').map((entry) => entry.payload?.kind))
      .toEqual(['tasks', 'shopping', 'chores', 'modes', 'tasks', 'shopping', 'chores', 'modes']);
    expect(new Set(world.trace.filter((entry) => entry.action === 'write').map((entry) => entry.path)).size)
      .toBe(8);
    expect(world.remainingFileCount).toBe(0);
  });

  test('an interleaving after the first payload is consumed preserves both reset effects', () => {
    const world = new ResetWorld();
    const second = loadResetHarness({ world });
    let secondStarted = false;
    const first = loadResetHarness({
      world,
      beforeUnlink: () => {
        if (!secondStarted) {
          secondStarted = true;
          second.api.resetShoppingItems();
        }
      },
    });
    expect(attempt(first.api.resetTasks)).toBeUndefined();
    expect(world.trace.filter((entry) => entry.action === 'read').map((entry) => entry.payload?.kind))
      .toEqual(['tasks', 'shopping']);
    expect(world.trace.filter((entry) => entry.action === 'unlink')).toHaveLength(2);
    expect(world.remainingFileCount).toBe(0);
  });

  test('independent VM environments remain empty while sharing fake filesystem state', () => {
    const world = new ResetWorld();
    const first = loadResetHarness({ world });
    const second = loadResetHarness({ world });
    first.api.resetChoreCompletions();
    second.api.resetModes();
    expect(first.environmentKeys()).toEqual([]);
    expect(second.environmentKeys()).toEqual([]);
    expect(world.trace.filter((entry) => entry.action === 'read').map((entry) => entry.payload?.kind))
      .toEqual(['chores', 'modes']);
    expect(world.remainingFileCount).toBe(0);
  });
});
