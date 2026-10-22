import { argsFor, fixture, indexPath, layout, names, submissionPath } from './burn4-workflow-harness';

const outputPath = 'community/layouts/dashboard/synthetic-family-board.json';

describe('layout publication file and index generation', () => {
  test('writes layout and full index before inert repository and API actions', async () => {
    const f = fixture();
    await f.run('publish');
    expect(f.files.get(outputPath)).toBe(JSON.stringify(layout(), null, 2) + '\n');
    expect(JSON.parse(f.files.get(indexPath) ?? '')).toEqual({ layouts: [{
      id: 'synthetic-family-board', file: 'dashboard/synthetic-family-board.json', name: 'Synthetic Family Board',
      description: 'Synthetic fixture only', author: 'Fixture Author', mode: 'dashboard', tags: [], screenSizes: [],
      orientation: 'landscape', widgetCount: 3, createdAt: '2026-10-21',
    }] });
    expect(f.files.get(indexPath)?.endsWith('\n')).toBe(true);
    expect(names(f).slice(0, 4)).toEqual([`read:${submissionPath}`, `read:${indexPath}`, `write:${outputPath}`, `write:${indexPath}`]);
    expect(names(f).slice(-3)).toEqual(['pull', 'remove-label', 'comment']);
  });

  test('uses documented defaults for omitted optional metadata', async () => {
    const f = fixture({ files: { [submissionPath]: '{"name":"Fixture Only"}', [indexPath]: '{"layouts":[]}' } });
    await f.run('publish');
    expect(JSON.parse(f.files.get(indexPath) ?? '').layouts[0]).toEqual({
      id: 'fixture-only', file: 'dashboard/fixture-only.json', name: 'Fixture Only', description: '',
      author: 'Community', mode: 'dashboard', tags: [], screenSizes: [], orientation: 'landscape', widgetCount: 0, createdAt: '2026-10-21',
    });
  });

  test('preserves supplied screensaver metadata and existing index entries', async () => {
    const data = layout({ name: 'Fixture Screen', mode: 'screensaver', tags: ['fixture'], screenSizes: ['large'], orientation: 'portrait' });
    const previous = { id: 'untouched', file: 'dashboard/untouched.json' };
    const f = fixture({ files: { [submissionPath]: JSON.stringify(data), [indexPath]: JSON.stringify({ layouts: [previous], schemaVersion: 2 }) } });
    await f.run('publish');
    const index = JSON.parse(f.files.get(indexPath) ?? '');
    expect(index.schemaVersion).toBe(2);
    expect(index.layouts[0]).toEqual(previous);
    expect(index.layouts[1]).toMatchObject({ mode: 'screensaver', tags: ['fixture'], screenSizes: ['large'], orientation: 'portrait' });
    expect(JSON.parse(f.files.get('community/layouts/screensaver/fixture-screen.json') ?? '')).toEqual(data);
  });

  test.each([
    ['  Fixture Room  ', 'fixture-room'], ['A_B + C', 'a-b-c'], ['UPPER 42', 'upper-42'], ['---Fixture---', 'fixture'],
  ])('generates deterministic slug for %s', async (name, id) => {
    const f = fixture({ files: { [submissionPath]: JSON.stringify(layout({ name })), [indexPath]: '{"layouts":[]}' } });
    await f.run('publish');
    expect(JSON.parse(f.files.get(indexPath) ?? '').layouts[0].id).toBe(id);
    expect(f.files.has(`community/layouts/dashboard/${id}.json`)).toBe(true);
  });

  test.each([submissionPath, indexPath])('stops before mutations when prerequisite %s is missing', async path => {
    const f = fixture(); f.files.delete(path);
    await expect(f.run('publish')).rejects.toThrow('Synthetic missing file');
    expect(argsFor(f, 'exec')).toEqual([]);
    expect(argsFor(f, 'pull')).toEqual([]);
    expect(f.calls.some(call => call.name.startsWith('write:'))).toBe(false);
  });

  test.each([submissionPath, indexPath])('stops before mutations on corrupt prerequisite %s', async path => {
    const f = fixture(); f.files.set(path, '{broken');
    await expect(f.run('publish')).rejects.toThrow();
    expect(argsFor(f, 'exec')).toEqual([]);
    expect(argsFor(f, 'pull')).toEqual([]);
  });

  test.each([outputPath, indexPath])('does not attempt repository commands after %s write failure', async path => {
    const f = fixture({ fail: { [`write:${path}`]: 'synthetic write failure' } });
    await expect(f.run('publish')).rejects.toThrow('synthetic write failure');
    expect(argsFor(f, 'exec')).toEqual([]);
    expect(argsFor(f, 'pull')).toEqual([]);
  });
});

describe('inert repository, pull request and feedback sequence', () => {
  test('records exact branch, add, commit and forced-push commands without executing them', async () => {
    const f = fixture();
    await f.run('publish');
    const commands = argsFor(f, 'exec').map(args => args[0]);
    expect(commands).toEqual([
      'git config user.name "github-actions[bot]"',
      'git config user.email "github-actions[bot]@users.noreply.github.com"',
      'git branch -D layout/synthetic-family-board-41',
      'git checkout -b layout/synthetic-family-board-41',
      `git add ${outputPath} community/layouts/index.json`,
      'git commit -m "Add community layout: Synthetic Family Board\n\nFrom #41"',
      'git push --force origin layout/synthetic-family-board-41',
    ]);
  });

  test('creates the intended PR and only then reports its inert URL', async () => {
    const f = fixture({ repo: 'other-fixture', issue: 77 });
    await f.run('publish');
    expect(argsFor(f, 'pull')).toEqual([[{
      owner: 'fixture-owner', repo: 'other-fixture', title: 'Add community layout: Synthetic Family Board',
      body: 'Adds community layout "Synthetic Family Board" by Fixture Author.\n\nCloses #77\n\n🤖 Auto-generated from layout submission.',
      head: 'layout/synthetic-family-board-77', base: 'master',
    }]]);
    expect(argsFor(f, 'remove-label')[0]?.[0]).toMatchObject({ issue_number: 77, name: 'needs-fix' });
    expect(argsFor(f, 'comment')[0]?.[0]).toMatchObject({ issue_number: 77, body: expect.stringContaining('https://example.invalid/fixture/pull/7') });
  });

  test('tolerates branch-delete failure from a first publication', async () => {
    const f = fixture({ fail: { 'exec:3': 'synthetic missing branch' } });
    await f.run('publish');
    expect(argsFor(f, 'exec')).toHaveLength(7);
    expect(argsFor(f, 'pull')).toHaveLength(1);
    expect(argsFor(f, 'comment')).toHaveLength(1);
  });

  test.each([1, 2, 4, 5, 6, 7])('stops publication after mandatory command %s fails', async command => {
    const f = fixture({ fail: { [`exec:${command}`]: 'synthetic command failure' } });
    await expect(f.run('publish')).rejects.toThrow('synthetic command failure');
    expect(argsFor(f, 'exec')).toHaveLength(command);
    expect(argsFor(f, 'pull')).toEqual([]);
    expect(argsFor(f, 'comment')).toEqual([]);
  });

  test('propagates PR rejection without announcing success', async () => {
    const f = fixture({ fail: { pull: 'synthetic PR rejection' } });
    await expect(f.run('publish')).rejects.toThrow('synthetic PR rejection');
    expect(argsFor(f, 'remove-label')).toEqual([]);
    expect(argsFor(f, 'comment')).toEqual([]);
  });

  test('tolerates a missing needs-fix label after successful PR creation', async () => {
    const f = fixture({ fail: { 'remove-label': 'synthetic missing label' } });
    await f.run('publish');
    expect(argsFor(f, 'comment')).toHaveLength(1);
    expect(names(f).slice(-3)).toEqual(['pull', 'remove-label', 'comment']);
  });

  test('propagates final comment rejection after preserving successful publication', async () => {
    const f = fixture({ fail: { comment: 'synthetic feedback rejection' } });
    await expect(f.run('publish')).rejects.toThrow('synthetic feedback rejection');
    expect(argsFor(f, 'pull')).toHaveLength(1);
    expect(f.files.has(outputPath)).toBe(true);
  });

  test('fresh concurrent fixtures use independent branches and feedback targets', async () => {
    const first = fixture({ issue: 10 }); const second = fixture({ issue: 11 });
    await Promise.all([first.run('publish'), second.run('publish')]);
    expect(argsFor(first, 'pull')[0]?.[0]).toMatchObject({ head: 'layout/synthetic-family-board-10' });
    expect(argsFor(second, 'pull')[0]?.[0]).toMatchObject({ head: 'layout/synthetic-family-board-11' });
    expect(argsFor(first, 'comment')[0]?.[0]).toMatchObject({ issue_number: 10 });
    expect(argsFor(second, 'comment')[0]?.[0]).toMatchObject({ issue_number: 11 });
    expect(JSON.parse(first.files.get(indexPath) ?? '').layouts).toHaveLength(1);
    expect(JSON.parse(second.files.get(indexPath) ?? '').layouts).toHaveLength(1);
  });

  test('rerun reaches an existing-PR rejection after issuing the same push command', async () => {
    const f = fixture();
    await f.run('publish');
    f.fail.pull = 'synthetic PR already exists';
    await expect(f.run('publish')).rejects.toThrow('synthetic PR already exists');
    expect(argsFor(f, 'exec').filter(args => String(args[0]).startsWith('git push'))).toHaveLength(2);
    expect(argsFor(f, 'comment')).toHaveLength(1);
  });
});

describe('cross-step execution using the real workflow handlers', () => {
  test('takes a valid synthetic submission through limits, extraction, validation and publication', async () => {
    const f = fixture({ body: JSON.stringify(layout()) });
    await f.run('limits');
    expect(f.outputs.passed).toBe('true');
    await f.run('extract');
    expect(f.outputs.passed).toBe('true');
    await f.run('validator');
    expect(argsFor(f, 'exit')).toEqual([]);
    await f.run('publish');
    expect(argsFor(f, 'validate')).toHaveLength(1);
    expect(argsFor(f, 'pull')).toHaveLength(1);
    expect(argsFor(f, 'comment')).toHaveLength(1);
    expect(f.files.get(outputPath)).toBe(JSON.stringify(layout(), null, 2) + '\n');
  });

  test('takes invalid validation details into failure feedback with no publication', async () => {
    const f = fixture({ body: JSON.stringify(layout()), validation: { valid: false, errors: ['Fixture validation rejection'] } });
    await f.run('limits');
    await f.run('extract');
    await f.run('validator');
    expect(argsFor(f, 'exit')).toEqual([[1]]);
    await f.run('failure');
    expect(argsFor(f, 'comment')[0]?.[0]).toMatchObject({ body: expect.stringContaining('Fixture validation rejection') });
    expect(argsFor(f, 'pull')).toEqual([]);
    expect(argsFor(f, 'exec')).toEqual([]);
  });
});
