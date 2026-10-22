import { load, Source } from './burn4-harness';

const scenarios: [Source, string][] = [
  ['chores', 'chores page loads with header'],
  ['chores', 'history button toggles completion history view'],
  ['chores', 'group by person view shows user columns'],
  ['chores', 'add chore button is visible for parents'],
  ['tasks', 'tasks page loads with header'],
  ['tasks', 'status filter buttons are visible'],
  ['tasks', 'group by person toggle switches view mode'],
  ['tasks', 'add task button is visible for parents'],
];

describe('Original chore and task smoke callbacks', () => {
  test.each(scenarios)('%s executes %s with strict controls and header', async (source, title) => {
    const run = load(source);
    await run.run(title);
    expect(run.events.slice(0, 2)).toEqual([
      { kind: 'goto', page: 'test', target: `/${source}` },
      { kind: 'load', page: 'test', target: 'networkidle' },
    ]);
    if (title.includes('header')) expect(run.events).toContainEqual({ kind: 'assert-text', target: 'header', data: source === 'tasks' ? 'Tasks' : 'Chores' });
    if (title.includes('history')) {
      expect(run.history).toBe(true);
      expect(run.events).toContainEqual({ kind: 'assert-visible', target: 'history-heading', data: true });
    }
    if (title.includes('toggle switches')) {
      expect(run.events.filter(event => event.kind === 'click').map(event => event.target)).toEqual(['group', 'group']);
      expect(run.grouped).toBe(true);
    }
    if (title.includes('filter buttons')) {
      expect(run.events.filter(event => event.kind === 'click').map(event => event.target)).toEqual(['active']);
      expect(run.filter).toBe('active');
    }
    if (title.includes('user columns')) expect(run.events).toContainEqual({ kind: 'count', target: 'columns' });
    if (title.includes('add ')) expect(run.events).toContainEqual({ kind: 'assert-visible', target: 'add', data: true });
  });

  test.each<Source>(['chores', 'tasks'])('%s database smoke checks populated and empty response branches', async source => {
    for (const populated of [false, true]) {
      const run = load(source);
      run.replies.push({ method: 'get', path: `/api/${source}`, status: 200, body: { [source]: populated ? [{ id: 'synthetic-row' }] : [] } });
      await run.run(`${source} are displayed from database`);
      run.assertConsumed();
      const visibility = run.events.filter(event => event.kind === 'assert-visible');
      expect(visibility).toEqual(populated ? [{ kind: 'assert-visible', target: source === 'tasks' ? 'main' : 'badge', data: true }] : []);
    }
  });

  test.each<Source>(['chores', 'tasks'])('%s database smoke rejects populated data with missing rendered content', async source => {
    const run = load(source, { visibility: source === 'tasks' ? { main: false } : { badge: false } });
    run.replies.push({ method: 'get', path: `/api/${source}`, status: 200, body: { [source]: [{ id: 'synthetic-row' }] } });
    await expect(run.run(`${source} are displayed from database`)).rejects.toHaveProperty('matcherResult');
  });

  test.each<Source>(['chores', 'tasks'])('%s database smoke propagates invalid JSON', async source => {
    const error = new Error('synthetic invalid JSON');
    const run = load(source);
    run.replies.push({ method: 'get', path: `/api/${source}`, status: 200, body: null, jsonError: error });
    await expect(run.run(`${source} are displayed from database`)).rejects.toBe(error);
  });

  test.each<Source>(['chores', 'tasks'])('%s header mismatch fails the original header assertion', async source => {
    const run = load(source, { header: 'Synthetic server error' });
    await expect(run.run(`${source} page loads with header`)).rejects.toHaveProperty('matcherResult');
  });

  test.each<Source>(['chores', 'tasks'])('%s missing add control fails the parent visibility assertion', async source => {
    const run = load(source, { visibility: { add: false } });
    await expect(run.run(`add ${source === 'tasks' ? 'task' : 'chore'} button is visible for parents`)).rejects.toHaveProperty('matcherResult');
  });

  test('history view requires its heading after the click', async () => {
    const run = load('chores', { visibility: { 'history-heading': false } });
    await expect(run.run('history button toggles completion history view')).rejects.toHaveProperty('matcherResult');
    expect(run.history).toBe(true);
  });

  test('grouped chores require at least one user column when group control exists', async () => {
    const run = load('chores', { columns: 0 });
    await expect(run.run('group by person view shows user columns')).rejects.toHaveProperty('matcherResult');
  });

  test.each<Source>(['chores', 'tasks'])('%s optional hidden grouping control avoids unsafe clicks', async source => {
    const run = load(source, { visibility: { group: false } });
    await run.run(source === 'chores' ? 'group by person view shows user columns' : 'group by person toggle switches view mode');
    expect(run.events.filter(event => ['click', 'count'].includes(event.kind))).toEqual([]);
  });

  test('hidden mobile filters take the header-only branch', async () => {
    const run = load('tasks', { visibility: { active: false, completed: false } });
    await run.run('status filter buttons are visible');
    expect(run.events.filter(event => event.kind === 'click')).toEqual([]);
    expect(run.events.filter(event => event.kind === 'visible-query').map(event => event.target)).toEqual(['active', 'completed']);
  });

  test.each<Source>(['chore-crud', 'chores', 'tasks'])('%s navigation errors stop callbacks before rendering assertions', async source => {
    const error = new Error('synthetic navigation failure');
    const run = load(source, { navigationError: error });
    await expect(run.run(source === 'chore-crud' ? 'create chore via modal UI' : `${source} page loads with header`)).rejects.toBe(error);
    expect(run.events.map(event => event.kind)).toEqual(['goto']);
  });

  test.each<Source>(['chore-crud', 'chores', 'tasks'])('%s load errors propagate before rendering assertions', async source => {
    const error = new Error('synthetic loading failure');
    const run = load(source, { loadError: error });
    await expect(run.run(source === 'chore-crud' ? 'create chore via modal UI' : `${source} page loads with header`)).rejects.toBe(error);
    expect(run.events.map(event => event.kind)).toEqual(['goto', 'load']);
  });
});
