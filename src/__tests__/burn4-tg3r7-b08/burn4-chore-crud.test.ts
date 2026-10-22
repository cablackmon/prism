import {
  CHILD, CHILD_COMPLETE, childReplies, completionReply, CREATE, createReply, DISABLE,
  load, MODAL, PARENT, PARENT_COMPLETE, Reply, TITLE,
} from './burn4-harness';

async function ready() {
  const run = load('chore-crud');
  await run.hook('beforeAll');
  await run.hook('beforeEach');
  return run;
}

describe('Original chore CRUD callbacks', () => {
  test('creation sends the required approval settings and validates the response', async () => {
    const run = await ready();
    run.replies.push(createReply());
    await run.run(CREATE);
    run.assertConsumed();
    expect(run.events.find(event => event.kind === 'post')).toEqual({
      kind: 'post', page: 'test', target: '/api/chores', role: 'parent',
      data: { title: TITLE, category: 'cleaning', frequency: 'weekly', pointValue: 5, requiresApproval: true },
    });
  });

  test.each([
    ['wrong status', createReply(undefined, 500)],
    ['wrong title', createReply({ title: 'Other', pointValue: 5, frequency: 'weekly' })],
    ['wrong points', createReply({ title: TITLE, pointValue: 0, frequency: 'weekly' })],
    ['wrong frequency', createReply({ title: TITLE, pointValue: 5, frequency: 'daily' })],
  ] as [string, Reply][])('creation rejects %s at its actual assertion', async (_name, reply) => {
    const run = await ready();
    run.replies.push(reply);
    await expect(run.run(CREATE)).rejects.toHaveProperty('matcherResult');
    run.assertConsumed();
  });

  test.each(['request', 'json'] as const)('creation propagates %s failure', async stage => {
    const error = new Error(`synthetic ${stage} failure`);
    const run = await ready();
    run.replies.push({ ...createReply(), ...(stage === 'request' ? { error } : { jsonError: error }) });
    await expect(run.run(CREATE)).rejects.toBe(error);
  });

  test('modal creation opens, fills, submits, closes and checks the new title', async () => {
    const run = await ready();
    await run.run(MODAL);
    expect(run.events.filter(event => ['goto', 'load', 'click', 'fill'].includes(event.kind))).toEqual([
      { kind: 'goto', page: 'test', target: '/chores' },
      { kind: 'load', page: 'test', target: 'networkidle' },
      { kind: 'click', target: 'add' },
      { kind: 'fill', target: 'input', data: TITLE },
      { kind: 'click', target: 'submit' },
    ]);
    expect(run.events.filter(event => event.kind === 'assert-visible').map(event => [event.target, event.data])).toEqual([
      ['add', true], ['modal', true], ['modal', false], ['title', true],
    ]);
  });

  test.each([
    ['missing add control', { visibility: { add: false } }],
    ['missing modal', { visibility: { modal: false } }],
    ['submit leaves modal open', { holdModalOpen: true }],
    ['created title absent', { hideCreatedTitle: true }],
  ] as const)('modal rejects %s', async (_name, options) => {
    const run = load('chore-crud', options);
    await expect(run.run(MODAL)).rejects.toHaveProperty('matcherResult');
  });

  test('parent completion uses parent id and validates autoapproval and points', async () => {
    const run = await ready();
    run.replies.push(createReply(), completionReply({ approved: true, pointsAwarded: 3, requiresApproval: false }));
    await run.run(PARENT_COMPLETE);
    run.assertConsumed();
    expect(run.events.find(event => event.target?.endsWith('/complete'))).toMatchObject({ role: 'parent', data: { completedBy: PARENT.id } });
    expect(run.events.find(event => event.target === '/api/chores')?.data).toMatchObject({ pointValue: 3, requiresApproval: false, frequency: 'daily' });
  });

  test.each([
    ['unapproved', { approved: false, pointsAwarded: 3, requiresApproval: false }, 201],
    ['wrong points', { approved: true, pointsAwarded: 0, requiresApproval: false }, 201],
    ['approval required', { approved: true, pointsAwarded: 3, requiresApproval: true }, 201],
    ['wrong status', { approved: true, pointsAwarded: 3, requiresApproval: false }, 500],
  ] as const)('parent completion rejects %s', async (_name, body, status) => {
    const run = await ready();
    run.replies.push(createReply(), completionReply(body, status));
    await expect(run.run(PARENT_COMPLETE)).rejects.toHaveProperty('matcherResult');
  });

  test('child payload, pending flags and approval request are actually asserted', async () => {
    const run = await ready();
    run.replies.push(...childReplies());
    await run.run(CHILD_COMPLETE);
    run.assertConsumed();
    expect(run.events.find(event => event.target?.endsWith('/complete'))?.data).toEqual({ completedBy: CHILD.id });
    expect(run.events.find(event => event.target?.endsWith('/approve'))?.data).toEqual({ completionId: 'synthetic-completion' });
  });

  test.each([
    ['already approved', { approved: true, requiresApproval: true, isChildCompletion: true }],
    ['no approval required', { approved: false, requiresApproval: false, isChildCompletion: true }],
    ['not a child completion', { approved: false, requiresApproval: true, isChildCompletion: false }],
  ] as const)('child case rejects %s before approval', async (_name, body) => {
    const run = await ready();
    run.replies.push(createReply(), completionReply(body));
    await expect(run.run(CHILD_COMPLETE)).rejects.toHaveProperty('matcherResult');
    expect(run.events.some(event => event.target?.endsWith('/approve'))).toBe(false);
  });

  test.each([
    ['failed approval response', 500, { completion: { pointsAwarded: 5 } }],
    ['wrong awarded points', 200, { completion: { pointsAwarded: 0 } }],
  ] as const)('child case rejects %s', async (_name, status, body) => {
    const run = await ready();
    run.replies.push(...childReplies().slice(0, 2), { method: 'post', path: '/api/chores/synthetic-chore/approve', status, body });
    await expect(run.run(CHILD_COMPLETE)).rejects.toHaveProperty('matcherResult');
    run.assertConsumed();
  });

  test('disabled chore sends patch before completion and requires the disabled response', async () => {
    const run = await ready();
    run.replies.push(createReply(), { method: 'patch', path: '/api/chores/synthetic-chore', status: 200, body: {} }, completionReply({ error: 'This chore is disabled' }, 400));
    await run.run(DISABLE);
    run.assertConsumed();
    const mutations = run.events.filter(event => ['post', 'patch'].includes(event.kind));
    expect(mutations.map(event => event.target)).toEqual(['/api/chores', '/api/chores/synthetic-chore', '/api/chores/synthetic-chore/complete']);
    expect(mutations[1]?.data).toEqual({ enabled: false });
    expect(mutations[2]?.data).toEqual({ completedBy: PARENT.id });
  });

  test.each([
    ['patch rejected', 500, 400, { error: 'disabled' }],
    ['completion accepted', 200, 201, { error: 'disabled' }],
    ['different failure', 200, 400, { error: 'Other problem' }],
  ] as const)('disable case rejects %s', async (_name, patchStatus, completeStatus, body) => {
    const run = await ready();
    run.replies.push(createReply(), { method: 'patch', path: '/api/chores/synthetic-chore', status: patchStatus, body: {} }, completionReply(body, completeStatus));
    await expect(run.run(DISABLE)).rejects.toHaveProperty('matcherResult');
    if (patchStatus === 500) expect(run.events.some(event => event.target?.endsWith('/complete'))).toBe(false);
  });
});
