import assert from 'node:assert/strict';
import { capture, loadSuite, sourceFiles, type SourceFile, type Options } from './burn4-harness';

export type Gap = { id: string; name: string; assertDesired(loader?: typeof loadSuite): Promise<void> };

async function prepared(source: SourceFile, options: Options, loader: typeof loadSuite) {
  const suite = loader(source, options);
  await suite.beforeAll();
  await suite.beforeEach();
  return suite;
}

const setupGaps: Gap[] = sourceFiles.map(source => ({
  id: `setup-${source.split('.')[0]}`,
  name: `${source}: parent discovery rejection leaks the temporary setup page`,
  async assertDesired(loader = loadSuite) {
    const injected = new Error('Synthetic parent discovery failure');
    const suite = loader(source, { parentError: injected });
    assert.equal(await capture(() => suite.beforeAll()), injected, 'Precondition: original discovery rejection propagates');
    assert.equal(suite.world.setupPage.closed, 1, `GAP setup-${source.split('.')[0]}: setup page must close after discovery failure`);
  },
}));

const cleanupGaps: Gap[] = (['task-crud.spec.ts', 'message-crud.spec.ts'] as const).map(source => ({
  id: `cleanup-${source.split('.')[0]}`,
  name: `${source}: a cleanup rejection skips later cleanup and logout`,
  async assertDesired(loader = loadSuite) {
    const suite = await prepared(source, { cleanupFailAt: 1 }, loader);
    const failure = await capture(() => suite.afterEach());
    assert.equal((failure as Error)?.message, 'Synthetic cleanup failure', 'Precondition: injected cleanup failure reaches source hook');
    assert.deepEqual([suite.world.cleanupCalls, suite.world.events.at(-1)], [2, 'logout'], `GAP cleanup-${source.split('.')[0]}: later cleanup and logout must still run`);
  },
}));

function prerequisiteGap(source: SourceFile, scenario: string, id: string): Gap {
  return {
    id,
    name: `${source}: ${scenario} consumes a rejected creation before checking status`,
    async assertDesired(loader = loadSuite) {
      const suite = await prepared(source, { fault: (call, normal) => call.method === 'POST' ? { ...normal, status: 503 } : normal }, loader);
      await capture(() => suite.run(scenario));
      assert.equal(suite.world.calls[0]?.method, 'POST', 'Precondition: original creation was attempted');
      assert.deepEqual(suite.world.calls.map(call => call.method), ['POST'], `GAP ${id}: rejected create must stop dependent mutations`);
    },
  };
}

export const gaps: Gap[] = [
  ...setupGaps,
  ...cleanupGaps,
  {
    id: 'message-child-discovery',
    name: 'Message child discovery hides infrastructure failure as an absent child',
    async assertDesired(loader = loadSuite) {
      const injected = new Error('Synthetic family transport failure');
      const suite = loader('message-crud.spec.ts', { childError: injected });
      const failure = await capture(() => suite.beforeAll());
      assert.equal(suite.world.setupPage.closed, 1, 'Precondition: source finishes temporary page cleanup');
      assert.equal(failure, injected, 'GAP message-child-discovery: infrastructure failure must not become a no-child skip');
    },
  },
  {
    id: 'goal-assertion-cleanup',
    name: 'Goal response-content assertion failure bypasses deletion of the created goal',
    async assertDesired(loader = loadSuite) {
      let createdId: string | undefined;
      const suite = await prepared('goals.spec.ts', { fault: (call, normal) => {
        if (call.method !== 'POST') return normal;
        const goal = (normal.body as { goal: { id: string } }).goal;
        createdId = goal.id;
        return { status: 201, body: { goal: { ...goal, pointCost: 11 } } };
      } }, loader);
      const failure = await capture(() => suite.run('create and delete a goal via API'));
      assert.ok((failure as { matcherResult?: unknown })?.matcherResult, 'Precondition: source content assertion rejects mismatched point cost');
      assert.ok(createdId, 'Precondition: the synthetic goal was created');
      assert.ok(suite.world.calls.some(call => call.method === 'DELETE' && call.path === `/api/goals/${createdId}`), 'GAP goal-assertion-cleanup: created goal must be deleted after its assertion fails');
    },
  },
  prerequisiteGap('task-crud.spec.ts', 'toggle task complete and incomplete', 'task-toggle-create'),
  prerequisiteGap('task-crud.spec.ts', 'delete a task', 'task-delete-create'),
  prerequisiteGap('message-crud.spec.ts', 'delete a message', 'message-delete-create'),
  prerequisiteGap('message-crud.spec.ts', 'parent can delete another user message', 'message-other-delete-create'),
];
