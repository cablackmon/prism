const mockInvalidateCache = jest.fn<Promise<void>, [string]>();

jest.mock('@/lib/cache/redis', () => ({
  invalidateCache: (pattern: string) => mockInvalidateCache(pattern),
}));

import {
  invalidateEntity,
  invalidateEntities,
  type CacheEntity,
} from '@/lib/cache/cacheKeys';

type Outcome =
  | { status: 'pending' }
  | { status: 'fulfilled' }
  | { status: 'rejected'; reason: unknown };

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function observe(promise: Promise<void>) {
  const observation: { state: Outcome; settled: Promise<void> } = {
    state: { status: 'pending' },
    settled: Promise.resolve(),
  };
  observation.settled = promise.then(
    () => { observation.state = { status: 'fulfilled' }; },
    (reason: unknown) => { observation.state = { status: 'rejected', reason }; },
  );
  return observation;
}

type Gate = {
  started: ReturnType<typeof deferred>;
  completion: ReturnType<typeof deferred>;
  outcome: Outcome;
};

let planned: Map<string, Gate[]>;

function gate(pattern: string): Gate {
  const next: Gate = {
    started: deferred(),
    completion: deferred(),
    outcome: { status: 'pending' },
  };
  const queue = planned.get(pattern) ?? [];
  queue.push(next);
  planned.set(pattern, queue);
  return next;
}

function calls() {
  return mockInvalidateCache.mock.calls.map(([pattern]) => pattern);
}

function count(pattern: string) {
  return calls().filter((entry) => entry === pattern).length;
}

function expectPending(observation: ReturnType<typeof observe>) {
  expect(observation.state).toEqual({ status: 'pending' });
}

function expectRejected(observation: ReturnType<typeof observe>, reason: unknown) {
  expect(observation.state.status).toBe('rejected');
  if (observation.state.status !== 'rejected') throw new Error('Expected rejection');
  expect(observation.state.reason).toBe(reason);
}

beforeEach(() => {
  planned = new Map();
  mockInvalidateCache.mockReset();
  mockInvalidateCache.mockImplementation((pattern) => {
    const next = planned.get(pattern)?.shift();
    if (!next) throw new Error(`Unplanned invalidation: ${pattern}`);
    next.started.resolve();
    return next.completion.promise.then(
      () => { next.outcome = { status: 'fulfilled' }; },
      (reason: unknown) => {
        next.outcome = { status: 'rejected', reason };
        throw reason;
      },
    );
  });
});

describe('invalidateEntity deferred traversal', () => {
  test('does not begin dependent invalidations until the root settles', async () => {
    const root = gate('chores:*');
    const points = gate('points:*');
    const goals = gate('goals:*');
    const run = observe(invalidateEntity('chores'));
    await root.started.promise;

    expect(calls()).toEqual(['chores:*']);
    expectPending(run);

    root.completion.resolve();
    await points.started.promise;
    await goals.started.promise;

    expect(calls()).toEqual(['chores:*', 'points:*', 'goals:*']);
    expectPending(run);
    points.completion.resolve();
    goals.completion.resolve();
    await run.settled;
    expect(run.state).toEqual({ status: 'fulfilled' });
  });

  test('starts sibling branches together and waits for the last transitive leaf', async () => {
    const family = gate('family:*');
    const chores = gate('chores:*');
    const tasks = gate('tasks:*');
    const points = gate('points:*');
    const goals = gate('goals:*');
    const run = observe(invalidateEntity('family'));
    family.completion.resolve();
    await chores.started.promise;

    expect(calls()).toEqual(['family:*', 'chores:*', 'tasks:*']);
    expectPending(run);

    tasks.completion.resolve();
    await points.started.promise;
    chores.completion.resolve();
    await goals.started.promise;
    goals.completion.resolve();
    await goals.completion.promise;

    expect(count('points:*')).toBe(1);
    expectPending(run);
    points.completion.resolve();
    await run.settled;
    expect(run.state).toEqual({ status: 'fulfilled' });
  });

  test('preserves root rejection identity, starts no descendants and permits a fresh retry', async () => {
    const failure = new Error('offline root failure');
    const firstRoot = gate('chores:*');
    const first = observe(invalidateEntity('chores'));
    await firstRoot.started.promise;
    firstRoot.completion.reject(failure);
    await first.settled;

    expectRejected(first, failure);
    expect(calls()).toEqual(['chores:*']);

    const retryRoot = gate('chores:*');
    const points = gate('points:*');
    const goals = gate('goals:*');
    const retry = observe(invalidateEntity('chores'));
    await retryRoot.started.promise;
    expectPending(retry);
    retryRoot.completion.resolve();
    await points.started.promise;
    await goals.started.promise;
    points.completion.resolve();
    goals.completion.resolve();
    await retry.settled;

    expect(retry.state).toEqual({ status: 'fulfilled' });
    expect(count('chores:*')).toBe(2);
    expect(count('points:*')).toBe(1);
    expect(count('goals:*')).toBe(1);
  });

  test('rejects promptly while an already-started sibling can continue into its descendants', async () => {
    const failure = new Error('offline chores failure');
    const family = gate('family:*');
    const chores = gate('chores:*');
    const tasks = gate('tasks:*');
    const points = gate('points:*');
    const run = observe(invalidateEntity('family'));
    family.completion.resolve();
    await chores.started.promise;
    await tasks.started.promise;
    chores.completion.reject(failure);
    await run.settled;

    expectRejected(run, failure);
    expect(tasks.outcome).toEqual({ status: 'pending' });
    expect(count('points:*')).toBe(0);
    expect(count('goals:*')).toBe(0);

    tasks.completion.resolve();
    await points.started.promise;
    points.completion.resolve();
    await points.completion.promise;

    expect(count('points:*')).toBe(1);
    expectRejected(run, failure);
  });

  test('contains a later sibling rejection after the public promise has already rejected', async () => {
    const firstFailure = new Error('offline first sibling failure');
    const laterFailure = new Error('offline later sibling failure');
    const root = gate('chores:*');
    const points = gate('points:*');
    const goals = gate('goals:*');
    const run = observe(invalidateEntity('chores'));
    root.completion.resolve();
    await points.started.promise;
    await goals.started.promise;
    points.completion.reject(firstFailure);
    await run.settled;

    expectRejected(run, firstFailure);
    expect(goals.outcome).toEqual({ status: 'pending' });
    goals.completion.reject(laterFailure);
    await goals.completion.promise.catch(() => undefined);

    expect(goals.outcome.status).toBe('rejected');
    if (goals.outcome.status !== 'rejected') throw new Error('Expected late rejection');
    expect(goals.outcome.reason).toBe(laterFailure);
    expectRejected(run, firstFailure);
  });

  test('converts a synchronous boundary throw to the same rejected public promise', async () => {
    const failure = new Error('offline synchronous boundary failure');
    mockInvalidateCache.mockImplementation(() => { throw failure; });

    await expect(invalidateEntity('family')).rejects.toBe(failure);
    expect(calls()).toEqual(['family:*']);
  });
});

describe('invalidateEntities overlapping deferred roots', () => {
  test.each(['chores', 'tasks'] as const)(
    'deduplicates pending points when %s reaches the shared leaf first',
    async (firstOwner) => {
      const family = gate('family:*');
      const chores = gate('chores:*');
      const tasks = gate('tasks:*');
      const points = gate('points:*');
      const goals = gate('goals:*');
      const run = observe(invalidateEntities('family', 'chores', 'tasks'));

      expect(calls()).toEqual(['family:*', 'chores:*', 'tasks:*']);
      (firstOwner === 'chores' ? chores : tasks).completion.resolve();
      await points.started.promise;
      family.completion.resolve();
      (firstOwner === 'chores' ? tasks : chores).completion.resolve();
      await goals.started.promise;
      goals.completion.resolve();
      await goals.completion.promise;

      expect(count('points:*')).toBe(1);
      expect(count('chores:*')).toBe(1);
      expect(count('tasks:*')).toBe(1);
      expectPending(run);
      points.completion.resolve();
      await run.settled;
      expect(run.state).toEqual({ status: 'fulfilled' });
    },
  );

  test('propagates a failed root while an independent root remains pending and can finish', async () => {
    const failure = new Error('offline aggregate root failure');
    const chores = gate('chores:*');
    const meals = gate('meals:*');
    const run = observe(invalidateEntities('chores', 'meals'));
    await meals.started.promise;
    chores.completion.reject(failure);
    await run.settled;

    expectRejected(run, failure);
    expect(calls()).toEqual(['chores:*', 'meals:*']);
    expect(meals.outcome).toEqual({ status: 'pending' });
    meals.completion.resolve();
    await meals.completion.promise;

    expect(meals.outcome).toEqual({ status: 'fulfilled' });
    expectRejected(run, failure);
  });

  test.each([
    ['single entity', () => invalidateEntity('task-lists')],
    ['multiple entities', () => invalidateEntities('task-lists', 'photos')],
  ] as const)('preserves a transitive leaf rejection through %s', async (label, invoke) => {
    const failure = new Error('offline transitive points failure');
    const root = gate('task-lists:*');
    const tasks = gate('tasks:*');
    const sources = gate('task-sources:*');
    const points = gate('points:*');
    const photos = label === 'multiple entities' ? gate('photos:*') : undefined;
    const run = observe(invoke());
    root.completion.resolve();
    await tasks.started.promise;
    await sources.started.promise;
    tasks.completion.resolve();
    await points.started.promise;
    points.completion.reject(failure);
    await run.settled;

    expectRejected(run, failure);
    expect(sources.outcome).toEqual({ status: 'pending' });
    if (photos) expect(photos.outcome).toEqual({ status: 'pending' });
    sources.completion.resolve();
    photos?.completion.resolve();
    await sources.completion.promise;
    if (photos) await photos.completion.promise;

    expect(sources.outcome).toEqual({ status: 'fulfilled' });
    expectRejected(run, failure);
  });

  test('retries a failed descendant with fresh traversal state in a new aggregate call', async () => {
    const firstRoot = gate('tasks:*');
    const firstPoints = gate('points:*');
    const failure = new Error('offline points first attempt');
    const first = observe(invalidateEntities('tasks', 'tasks'));
    firstRoot.completion.resolve();
    await firstPoints.started.promise;
    firstPoints.completion.reject(failure);
    await first.settled;
    expectRejected(first, failure);

    const retryRoot = gate('tasks:*');
    const retryPoints = gate('points:*');
    const retry = observe(invalidateEntities('tasks', 'tasks'));
    retryRoot.completion.resolve();
    await retryPoints.started.promise;

    expect(count('tasks:*')).toBe(2);
    expect(count('points:*')).toBe(2);
    expectPending(retry);
    retryPoints.completion.resolve();
    await retry.settled;
    expect(retry.state).toEqual({ status: 'fulfilled' });
  });
});

describe('separate invocations and supplied traversal state', () => {
  test('keeps two simultaneous single-entity invocations independent through completion', async () => {
    const firstRoot = gate('tasks:*');
    const secondRoot = gate('tasks:*');
    const firstPoints = gate('points:*');
    const secondPoints = gate('points:*');
    const first = observe(invalidateEntity('tasks'));
    const second = observe(invalidateEntity('tasks'));
    await secondRoot.started.promise;

    expect(count('tasks:*')).toBe(2);
    firstRoot.completion.resolve();
    await firstPoints.started.promise;
    firstPoints.completion.resolve();
    await first.settled;

    expect(first.state).toEqual({ status: 'fulfilled' });
    expectPending(second);
    secondRoot.completion.resolve();
    await secondPoints.started.promise;
    expect(count('points:*')).toBe(2);
    secondPoints.completion.resolve();
    await second.settled;
    expect(second.state).toEqual({ status: 'fulfilled' });
  });

  test('isolates simultaneous aggregate calls while deduplicating within each call', async () => {
    const firstTasks = gate('tasks:*');
    const secondTasks = gate('tasks:*');
    const firstPoints = gate('points:*');
    const secondPoints = gate('points:*');
    const first = observe(invalidateEntities('tasks', 'points', 'tasks'));
    const second = observe(invalidateEntities('tasks', 'points', 'tasks'));

    expect(calls()).toEqual(['tasks:*', 'points:*', 'tasks:*', 'points:*']);
    firstTasks.completion.resolve();
    firstPoints.completion.resolve();
    await first.settled;

    expect(first.state).toEqual({ status: 'fulfilled' });
    expectPending(second);
    secondTasks.completion.resolve();
    secondPoints.completion.resolve();
    await second.settled;

    expect(second.state).toEqual({ status: 'fulfilled' });
    expect(count('tasks:*')).toBe(2);
    expect(count('points:*')).toBe(2);
  });

  test('does not let a failed concurrent invocation poison a successful overlapping invocation', async () => {
    const singleRoot = gate('tasks:*');
    const aggregateRoot = gate('tasks:*');
    const points = gate('points:*');
    const failure = new Error('offline isolated root failure');
    const single = observe(invalidateEntity('tasks'));
    const aggregate = observe(invalidateEntities('tasks', 'points'));
    singleRoot.completion.reject(failure);
    await single.settled;

    expectRejected(single, failure);
    expectPending(aggregate);
    aggregateRoot.completion.resolve();
    points.completion.resolve();
    await aggregate.settled;

    expect(aggregate.state).toEqual({ status: 'fulfilled' });
    expect(count('tasks:*')).toBe(2);
    expect(count('points:*')).toBe(1);
  });

  test('returns without boundary work for an empty aggregate and an explicitly previsited root', async () => {
    const visited = new Set<CacheEntity>(['family']);

    await invalidateEntities();
    await invalidateEntity('family', visited);

    expect(mockInvalidateCache).not.toHaveBeenCalled();
    expect([...visited]).toEqual(['family']);
  });

  test('skips a previsited leaf while still awaiting an unvisited sibling', async () => {
    const visited = new Set<CacheEntity>(['points']);
    const chores = gate('chores:*');
    const goals = gate('goals:*');
    const run = observe(invalidateEntity('chores', visited));
    chores.completion.resolve();
    await goals.started.promise;

    expect(calls()).toEqual(['chores:*', 'goals:*']);
    expect([...visited].sort()).toEqual(['chores', 'goals', 'points']);
    expectPending(run);
    goals.completion.resolve();
    await run.settled;
    expect(run.state).toEqual({ status: 'fulfilled' });
  });
});
