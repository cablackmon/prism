import assert from 'node:assert/strict';
import { CHILD_COMPLETE, childReplies, load, Source } from './burn4-harness';

type Gap = { id: string; name: string; probe: () => Promise<void> };
async function caught(action: () => Promise<void>): Promise<unknown> {
  try { await action(); return undefined; } catch (error) { return error; }
}

export const gaps: Gap[] = [
  {
    id: 'G01', name: 'child approval case never authenticates the child before completion',
    probe: async () => {
      const run = load('chore-crud');
      await run.hook('beforeAll');
      await run.hook('beforeEach');
      run.replies.push(...childReplies());
      await run.run(CHILD_COMPLETE);
      run.assertConsumed();
      const complete = run.events.find(event => event.target?.endsWith('/complete'));
      const approve = run.events.find(event => event.target?.endsWith('/approve'));
      assert.ok(complete && approve, 'Prerequisite: callback must make both completion and approval requests');
      assert.deepEqual([complete.role, approve.role], ['child', 'parent'], '[B08 G01] completion must use child session and approval parent session');
    },
  },
  {
    id: 'G02', name: 'child discovery transport failure is swallowed as absent child',
    probe: async () => {
      const error = new Error('synthetic child transport failure');
      const run = load('chore-crud', { childError: error });
      const actual = await caught(() => run.hook('beforeAll'));
      assert.equal(run.events.filter(event => event.kind === 'child-lookup').length, 1, 'Prerequisite: child discovery attempted');
      assert.equal(actual, error, '[B08 G02] setup must propagate child transport failure');
    },
  },
  ...(['chores', 'tasks'] as Source[]).map((source, index): Gap => ({
    id: `G0${index + 3}`, name: `${source} database smoke callback accepts HTTP500 error document`,
    probe: async () => {
      const run = load(source);
      run.replies.push({ method: 'get', path: `/api/${source}`, status: 500, body: { error: 'synthetic server failure' } });
      const actual = await caught(() => run.run(`${source} are displayed from database`));
      run.assertConsumed();
      assert.equal(run.events.filter(event => event.kind === 'get').length, 1, 'Prerequisite: data API called');
      assert.ok(actual, `[B08 G0${index + 3}] HTTP500 must fail the data smoke callback`);
    },
  })),
  ...(['chore-crud', 'chores', 'tasks'] as Source[]).map((source, index): Gap => ({
    id: `G0${index + 5}`, name: `${source} parent discovery failure leaks setup page`,
    probe: async () => {
      const error = new Error('synthetic parent transport failure');
      const run = load(source, { parentError: error });
      const actual = await caught(() => run.hook('beforeAll'));
      assert.equal(actual, error, 'Prerequisite: original discovery error propagates');
      assert.equal(run.events.filter(event => event.kind === 'new-page').length, 1, 'Prerequisite: page allocated');
      assert.equal(run.events.filter(event => event.kind === 'close').length, 1, `[B08 G0${index + 5}] discovery failure must close setup page`);
    },
  })),
  {
    id: 'G08', name: 'chore deletion failure prevents logout during teardown',
    probe: async () => {
      const error = new Error('synthetic deletion failure');
      const run = load('chore-crud', { cleanupError: error });
      await run.hook('beforeAll');
      await run.hook('beforeEach');
      const actual = await caught(() => run.hook('afterEach'));
      assert.equal(actual, error, 'Prerequisite: original cleanup error propagates');
      assert.equal(run.events.filter(event => event.kind === 'cleanup').length, 1, 'Prerequisite: cleanup attempted');
      assert.equal(run.events.filter(event => event.kind === 'logout').length, 1, '[B08 G08] logout must be attempted after deletion failure');
    },
  },
  {
    id: 'G09', name: 'task filter callback clicks hidden Active when only Completed is visible',
    probe: async () => {
      const run = load('tasks', { visibility: { active: false, completed: true } });
      const actual = await caught(() => run.run('status filter buttons are visible'));
      assert.equal(actual, undefined, '[B08 G09] completed-only filter view must succeed by clicking its visible control');
      assert.deepEqual(run.events.filter(event => event.kind === 'click').map(event => event.target), ['completed']);
    },
  },
];
