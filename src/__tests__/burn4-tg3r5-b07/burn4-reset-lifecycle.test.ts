import { loadResetHarness, type PayloadKind, type ResetName } from './burn4-reset-harness';

const cases: [Exclude<ResetName, 'resetAll'>, PayloadKind][] = [
  ['resetTasks', 'tasks'],
  ['resetShoppingItems', 'shopping'],
  ['resetChoreCompletions', 'chores'],
  ['resetModes', 'modes'],
];

describe('burn4 reset helper lifecycle with inert dependencies', () => {
  test.each(cases)('%s dispatches its intended reset and removes its payload', (name, kind) => {
    const { api, world } = loadResetHarness();
    expect(api[name]()).toBeUndefined();
    expect(world.trace.map((entry) => entry.action)).toEqual(['write', 'execute', 'read', 'unlink']);
    expect(world.trace[0]?.payload).toEqual({
      kind, nonempty: true, oneStatement: true, expectedMutation: true,
    });
    expect(world.trace[2]?.payload).toEqual(world.trace[0]?.payload);
    expect(world.trace[0]?.encoding).toBe('utf-8');
    expect(new Set(world.trace.map((entry) => entry.path)).size).toBe(1);
    expect(world.remainingFileCount).toBe(0);
  });

  test.each(cases)('%s chooses the Docker branch under an empty environment', (name) => {
    const { api, world, environmentKeys } = loadResetHarness();
    api[name]();
    expect(world.trace.find((entry) => entry.action === 'execute')).toMatchObject({
      operation: 'sql', pipe: true, docker: true, windowsShell: true,
    });
    expect(environmentKeys()).toEqual([]);
  });

  test('resetAll flushes cache before each data reset in the documented order', () => {
    const { api, world } = loadResetHarness();
    expect(api.resetAll()).toBeUndefined();
    expect(world.trace[0]).toEqual({
      action: 'execute', operation: 'redis', pipe: true, docker: true, windowsShell: false,
    });
    expect(world.trace.filter((entry) => entry.action === 'read').map((entry) => entry.payload?.kind))
      .toEqual(['tasks', 'shopping', 'chores', 'modes']);
    expect(world.trace.map((entry) => entry.action)).toEqual([
      'execute',
      'write', 'execute', 'read', 'unlink',
      'write', 'execute', 'read', 'unlink',
      'write', 'execute', 'read', 'unlink',
      'write', 'execute', 'read', 'unlink',
    ]);
    expect(world.remainingFileCount).toBe(0);
  });

  test('resetAll keeps its supplied environment empty throughout execution', () => {
    const { api, world, environmentKeys } = loadResetHarness();
    expect(environmentKeys()).toEqual([]);
    api.resetAll();
    expect(environmentKeys()).toEqual([]);
    expect(world.trace.filter((entry) => entry.action === 'execute')).toHaveLength(5);
  });

  test('each reset obtains a fresh clock reading for its temporary path', () => {
    let tick = 201;
    const now = jest.fn(() => tick++);
    const { api, world } = loadResetHarness({ now });
    api.resetAll();
    expect(now).toHaveBeenCalledTimes(4);
    expect(world.trace.filter((entry) => entry.action === 'write').map((entry) => entry.path))
      .toEqual([201, 202, 203, 204].map((value) => `/burn4-memory/prism-e2e-${value}.sql`));
  });

  test('importing the unchanged helper performs no resets or filesystem effects', () => {
    const { api, world } = loadResetHarness();
    expect(Object.keys(api).sort()).toEqual([
      'resetAll', 'resetChoreCompletions', 'resetModes', 'resetShoppingItems', 'resetTasks',
    ]);
    expect(world.trace).toEqual([]);
  });

  test('repeating a full reset leaves no in-memory payloads behind', () => {
    const { api, world } = loadResetHarness();
    api.resetAll();
    api.resetAll();
    expect(world.trace.filter((entry) => entry.action === 'execute')).toHaveLength(10);
    expect(world.trace.filter((entry) => entry.action === 'read').map((entry) => entry.payload?.kind))
      .toEqual(['tasks', 'shopping', 'chores', 'modes', 'tasks', 'shopping', 'chores', 'modes']);
    expect(world.remainingFileCount).toBe(0);
  });
});
