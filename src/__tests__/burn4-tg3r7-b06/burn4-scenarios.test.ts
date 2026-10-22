import { capture, loadSuite, ready, SkipSignal, sourceFiles, type Options, type SourceFile } from './burn4-harness';

const scenarios: Array<[SourceFile, string, string[]]> = [
  ['task-crud.spec.ts', 'create a task via modal', ['POST /api/tasks']],
  ['task-crud.spec.ts', 'edit a task title', ['POST /api/tasks', 'PATCH /api/tasks/tasks-1']],
  ['task-crud.spec.ts', 'toggle task complete and incomplete', ['POST /api/tasks', 'PATCH /api/tasks/tasks-1', 'PATCH /api/tasks/tasks-1']],
  ['task-crud.spec.ts', 'delete a task', ['POST /api/tasks', 'DELETE /api/tasks/tasks-1', 'GET /api/tasks/tasks-1']],
  ['task-crud.spec.ts', 'created task appears in API listing', ['POST /api/tasks', 'GET /api/tasks']],
  ['message-crud.spec.ts', 'post a message via API', ['POST /api/messages']],
  ['message-crud.spec.ts', 'message appears in listing after creation', ['POST /api/messages', 'GET /api/messages']],
  ['message-crud.spec.ts', 'toggle pin on a message', ['POST /api/messages', 'PATCH /api/messages/messages-1', 'PATCH /api/messages/messages-1']],
  ['message-crud.spec.ts', 'delete a message', ['POST /api/messages', 'DELETE /api/messages/messages-1', 'GET /api/messages']],
  ['message-crud.spec.ts', 'parent can delete another user message', ['POST /api/messages', 'DELETE /api/messages/messages-1']],
  ['goals.spec.ts', 'goals page loads with header', []],
  ['goals.spec.ts', 'goals list renders when data exists', ['GET /api/goals']],
  ['goals.spec.ts', 'point counters display for children', ['GET /api/goals']],
  ['goals.spec.ts', 'add goal button visible for parent', []],
  ['goals.spec.ts', 'add goal modal opens and closes', []],
  ['goals.spec.ts', 'goals API returns expected shape', ['GET /api/goals']],
  ['goals.spec.ts', 'create and delete a goal via API', ['POST /api/goals', 'DELETE /api/goals/goals-2']],
];

describe('Original task, message and goal callbacks with local state', () => {
  test.each(scenarios)('%s: %s', async (source, scenario, expectedRequests) => {
    const suite = await ready(source);
    await suite.run(scenario);
    expect(suite.world.calls.map(call => `${call.method} ${call.path}`)).toEqual(expectedRequests);
    expect(suite.world.setupPage.closed).toBe(1);
    expect(suite.world.events.slice(0, 2)).toEqual(['newPage', 'discover:parent']);
    expect(suite.world.events).toContain('login:Synthetic Parent');
    if (scenario === 'toggle task complete and incomplete') {
      expect(suite.world.calls.filter(call => call.method === 'PATCH').map(call => call.data)).toEqual([{ completed: true }, { completed: false }]);
      expect(suite.world.tasks.get('tasks-1')?.completed).toBe(false);
    }
    if (scenario === 'edit a task title') {
      expect(suite.world.events.filter(event => event === 'reload')).toHaveLength(1);
      expect(suite.world.tasks.get('tasks-1')?.title).toMatch(/\(edited\)$/);
    }
    if (scenario === 'toggle pin on a message') {
      expect(suite.world.messages.get('messages-1')?.pinned).toBe(false);
      expect(suite.world.calls.filter(call => call.method === 'PATCH').map(call => call.data)).toEqual([{ pinned: true }, { pinned: false }]);
    }
    if (scenario === 'parent can delete another user message') {
      expect(suite.world.calls[0]?.data?.authorId).toBe('child-synthetic');
      expect(suite.world.events.filter(event => event.startsWith('login:'))).toEqual(['login:Synthetic Parent']);
    }
    if (scenario === 'add goal modal opens and closes') {
      expect(suite.world.events).toEqual(expect.arrayContaining(['click:add-goal', 'key:Escape']));
      expect(suite.world.page.modal).toBe(false);
    }
    if (scenario === 'create a task via modal') {
      expect(suite.world.events.indexOf('fill:task')).toBeLessThan(suite.world.events.indexOf('click:task-submit'));
      expect(suite.world.page.modal).toBe(false);
    }
    await suite.afterEach();
    expect(suite.world.events.at(-1)).toBe('logout');
    if (source !== 'goals.spec.ts') {
      const cleanups = suite.world.events.filter(event => event.startsWith('cleanup:'));
      expect(cleanups).toHaveLength(2);
      expect(cleanups[1]).toBe(`${cleanups[0]} (edited)`);
    }
    expect(suite.world.tasks.size).toBe(0);
    expect(suite.world.messages.size).toBe(0);
    expect(suite.world.goals.size).toBe(1);
  });

  test.each(sourceFiles)('%s registers exactly its covered scenarios and three hooks', source => {
    const suite = loadSuite(source);
    expect(suite.scenarios).toEqual(scenarios.filter(item => item[0] === source).map(item => item[1]));
    expect(suite.hookCounts).toEqual([1, 1, 1]);
  });

  test('missing optional child stops the other-user callback before API access', async () => {
    const suite = await ready('message-crud.spec.ts', { childPresent: false });
    await expect(suite.run('parent can delete another user message')).rejects.toBeInstanceOf(SkipSignal);
    expect(suite.world.calls).toEqual([]);
    expect(suite.world.setupPage.closed).toBe(1);
    await suite.afterEach();
    expect(suite.world.events.at(-1)).toBe('logout');
  });

  test.each(sourceFiles)('%s propagates login failure without API mutations', async source => {
    const error = new Error('Synthetic login transport failure');
    const suite = loadSuite(source, { loginError: error });
    await suite.beforeAll();
    await expect(suite.beforeEach()).rejects.toBe(error);
    expect(suite.world.calls).toEqual([]);
  });

  test.each(['task-crud.spec.ts', 'message-crud.spec.ts'] as const)('%s accepts its explicit legacy array listing branch', async source => {
    const suite = await ready(source, { listAsArray: true });
    await suite.run(source === 'task-crud.spec.ts' ? 'created task appears in API listing' : 'message appears in listing after creation');
    await suite.afterEach();
    expect(suite.world.tasks.size + suite.world.messages.size).toBe(0);
  });

  test('goal list and child counters support empty arrays without fake UI rows', async () => {
    const suite = await ready('goals.spec.ts', { emptyGoals: true, childPresent: false });
    await suite.run('goals list renders when data exists');
    await suite.run('point counters display for children');
    expect(suite.world.page.texts.size).toBe(0);
    expect(suite.world.calls).toHaveLength(2);
  });

  test('isolated source loads do not retain a previous child or created records', async () => {
    const first = await ready('message-crud.spec.ts');
    await first.run('post a message via API');
    const second = await ready('message-crud.spec.ts', { childPresent: false });
    expect(second.world.messages.size).toBe(0);
    await expect(second.run('parent can delete another user message')).rejects.toBeInstanceOf(SkipSignal);
    expect(first.world.messages.size).toBe(1);
  });
});

const faultCases: Array<[string, SourceFile, string, Options]> = [
  ['task result hidden', 'task-crud.spec.ts', 'create a task via modal', { uiFault: 'hide-title' }],
  ['task modal stays open', 'task-crud.spec.ts', 'create a task via modal', { uiFault: 'sticky-modal' }],
  ['edited title hidden', 'task-crud.spec.ts', 'edit a task title', { uiFault: 'hide-title' }],
  ['goal dialog ignores Escape', 'goals.spec.ts', 'add goal modal opens and closes', { uiFault: 'escape-stuck' }],
  ['goal row hidden', 'goals.spec.ts', 'goals list renders when data exists', { uiFault: 'hide-title' }],
  ['child point label hidden', 'goals.spec.ts', 'point counters display for children', { uiFault: 'hide-title' }],
  ['task creation unsuccessful', 'task-crud.spec.ts', 'edit a task title', { fault: (call, normal) => call.method === 'POST' ? { ...normal, status: 500 } : normal }],
  ['task patch unsuccessful', 'task-crud.spec.ts', 'edit a task title', { fault: (call, normal) => call.method === 'PATCH' ? { ...normal, status: 500 } : normal }],
  ['task completion response lies', 'task-crud.spec.ts', 'toggle task complete and incomplete', { fault: (call, normal) => call.method === 'PATCH' ? { status: 200, body: { completed: false } } : normal }],
  ['deleted task still exists', 'task-crud.spec.ts', 'delete a task', { fault: (call, normal) => call.method === 'GET' ? { status: 200, body: {} } : normal }],
  ['task listing loses priority', 'task-crud.spec.ts', 'created task appears in API listing', { fault: (call, normal) => call.method === 'GET' ? { status: 200, body: { tasks: [{ id: 'tasks-1', title: 'E2E Task 1700000000000', priority: 'low' }] } } : normal }],
  ['message creation unsuccessful', 'message-crud.spec.ts', 'post a message via API', { fault: (call, normal) => ({ ...normal, status: call.method === 'POST' ? 500 : normal.status }) }],
  ['message listing omits created id', 'message-crud.spec.ts', 'message appears in listing after creation', { fault: (call, normal) => call.method === 'GET' ? { status: 200, body: { messages: [] } } : normal }],
  ['message pin response lies', 'message-crud.spec.ts', 'toggle pin on a message', { fault: (call, normal) => call.method === 'PATCH' ? { status: 200, body: { pinned: false } } : normal }],
  ['message deletion unsuccessful', 'message-crud.spec.ts', 'delete a message', { fault: (call, normal) => call.method === 'DELETE' ? { ...normal, status: 500 } : normal }],
  ['goals request unsuccessful', 'goals.spec.ts', 'goals list renders when data exists', { fault: (_call, normal) => ({ ...normal, status: 500 }) }],
  ['goals shape missing progress', 'goals.spec.ts', 'goals API returns expected shape', { fault: () => ({ status: 200, body: { goals: [], children: [] } }) }],
];

describe('Failure oracles exercise source assertions', () => {
  test.each(faultCases)('%s', async (_label, source, scenario, options) => {
    const suite = await ready(source, options);
    const error = await capture(() => suite.run(scenario));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('Error');
    expect((error as { matcherResult?: unknown }).matcherResult).toBeDefined();
    await suite.afterEach();
  });

  test('transport rejection aborts before any dependent task mutation', async () => {
    const error = new Error('Synthetic POST transport failure');
    const suite = await ready('task-crud.spec.ts', { fault: () => { throw error; } });
    await expect(suite.run('delete a task')).rejects.toBe(error);
    expect(suite.world.calls.map(call => call.method)).toEqual(['POST']);
  });

  test('rejected checked creation stops edit before PATCH and navigation', async () => {
    const suite = await ready('task-crud.spec.ts', { fault: (_call, normal) => ({ ...normal, status: 500 }) });
    await expect(suite.run('edit a task title')).rejects.toThrow();
    expect(suite.world.calls.map(call => call.method)).toEqual(['POST']);
    expect(suite.world.events.some(event => event.startsWith('goto:'))).toBe(false);
  });

  test('unknown API paths, UI selectors, sources and scenario names are denied', async () => {
    const suite = await ready('goals.spec.ts');
    await expect(suite.world.page.request.get('/api/unplanned')).rejects.toThrow('Denied API path');
    expect(() => suite.world.page.locator('unplanned')).toThrow('Unexpected selector');
    expect(() => loadSuite('not-allowlisted.ts' as SourceFile)).toThrow('Denied source');
    await expect(suite.run('missing callback')).rejects.toThrow('Unknown scenario');
  });
});
