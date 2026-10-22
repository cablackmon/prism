import { argsFor, errorsPath, fixture, indexPath, layout, names, submissionPath } from './burn4-workflow-harness';

describe('inline layout validator orchestration', () => {
  test('forwards the submitted layout and strict community options', async () => {
    const data = layout();
    const f = fixture();
    await f.run('validator');
    expect(argsFor(f, 'validate')).toEqual([[data, {
      communitySubmission: true, existingLayouts: [], existingWidgetSets: [],
    }]]);
    expect(argsFor(f, 'log')).toEqual([['VALID']]);
    expect(argsFor(f, 'exit')).toEqual([]);
    expect(f.files.has(errorsPath)).toBe(false);
    expect(names(f)).toEqual([`read:${submissionPath}`, `read:${indexPath}`, 'validate', 'log']);
  });

  test('reads every indexed layout in order and forwards only widget arrays', async () => {
    const entries = [{ id: 'a', file: 'dashboard/a.json' }, { id: 'b', file: 'screensaver/b.json' }];
    const widgets = [{ i: 'fixture' }];
    const f = fixture({ files: {
      [submissionPath]: JSON.stringify(layout()), [indexPath]: JSON.stringify({ layouts: entries }),
      './community/layouts/dashboard/a.json': JSON.stringify({ widgets, ignored: 'fixture' }),
      './community/layouts/screensaver/b.json': JSON.stringify({ widgets: [] }),
    } });
    await f.run('validator');
    expect(argsFor(f, 'validate')[0]?.[1]).toEqual({ communitySubmission: true, existingLayouts: entries, existingWidgetSets: [widgets, []] });
    expect(names(f).slice(0, 4)).toEqual([`read:${submissionPath}`, `read:${indexPath}`, 'read:community/layouts/dashboard/a.json', 'read:community/layouts/screensaver/b.json']);
  });

  test.each(['missing', 'corrupt', 'without-widgets'])('uses an empty widget fallback for a %s existing layout', async kind => {
    const files: Record<string, string> = {
      [submissionPath]: JSON.stringify(layout()), [indexPath]: JSON.stringify({ layouts: [{ file: 'dashboard/fixture.json' }] }),
    };
    if (kind !== 'missing') files['./community/layouts/dashboard/fixture.json'] = kind === 'corrupt' ? '{broken' : '{}';
    const f = fixture({ files });
    await f.run('validator');
    expect(argsFor(f, 'validate')[0]?.[1]).toMatchObject({ existingWidgetSets: [[]] });
    expect(argsFor(f, 'log')).toEqual([['VALID']]);
  });

  test('writes complete error details and exits before success logging', async () => {
    const f = fixture({ validation: { valid: false, errors: ['fixture overlap', 'fixture size'] } });
    await f.run('validator');
    expect(f.files.get(errorsPath)).toBe('["fixture overlap","fixture size"]');
    expect(argsFor(f, 'exit')).toEqual([[1]]);
    expect(argsFor(f, 'log')).toEqual([]);
    expect(names(f).slice(-3)).toEqual(['validate', `write:${errorsPath}`, 'exit']);
  });

  test.each([submissionPath, indexPath])('propagates missing prerequisite file %s', async path => {
    const f = fixture();
    f.files.delete(path);
    await expect(f.run('validator')).rejects.toThrow('Synthetic missing file');
    expect(argsFor(f, 'validate')).toEqual([]);
    expect(argsFor(f, 'log')).toEqual([]);
  });

  test.each([submissionPath, indexPath])('propagates malformed prerequisite file %s', async path => {
    const f = fixture();
    f.files.set(path, '{broken');
    await expect(f.run('validator')).rejects.toThrow();
    expect(argsFor(f, 'validate')).toEqual([]);
    expect(argsFor(f, 'log')).toEqual([]);
  });

  test('propagates a validator exception without false success', async () => {
    const f = fixture({ fail: { validate: 'synthetic validator failure' } });
    await expect(f.run('validator')).rejects.toThrow('synthetic validator failure');
    expect(argsFor(f, 'log')).toEqual([]);
    expect(f.files.has(errorsPath)).toBe(false);
  });

  test('propagates validation-error write failure without issuing an exit success', async () => {
    const f = fixture({ validation: { valid: false, errors: ['fixture'] }, fail: { [`write:${errorsPath}`]: 'synthetic disk failure' } });
    await expect(f.run('validator')).rejects.toThrow('synthetic disk failure');
    expect(argsFor(f, 'exit')).toEqual([]);
    expect(argsFor(f, 'log')).toEqual([]);
  });

  test('passes primitive parsed input through for structural rejection', async () => {
    const f = fixture({ files: { [submissionPath]: 'null', [indexPath]: '{"layouts":[]}' }, validation: { valid: false, errors: ['Expected object'] } });
    await f.run('validator');
    expect(argsFor(f, 'validate')[0]?.[0]).toBeNull();
    expect(argsFor(f, 'exit')).toEqual([[1]]);
  });
});

describe('validation failure feedback', () => {
  test('formats every detailed error and then applies needs-fix', async () => {
    const f = fixture({ files: { [errorsPath]: '["Fixture overlap","Fixture dimensions"]' } });
    await f.run('failure');
    expect(argsFor(f, 'comment')[0]?.[0]).toEqual({
      owner: 'fixture-owner', repo: 'fixture-repo', issue_number: 41,
      body: expect.stringContaining('**Issues found:**\n- Fixture overlap\n- Fixture dimensions'),
    });
    expect(names(f)).toEqual([`read:${errorsPath}`, 'comment', 'add-label']);
    expect(argsFor(f, 'add-label')[0]?.[0]).toMatchObject({ labels: ['needs-fix'] });
  });

  test.each([undefined, '{broken', '{}', 'null'])('uses generic feedback for unavailable details: %s', async value => {
    const f = fixture({ files: value === undefined ? {} : { [errorsPath]: value } });
    await f.run('failure');
    const comment = argsFor(f, 'comment')[0]?.[0] as { body: string };
    expect(comment.body).toContain('Layout validation failed');
    expect(comment.body).not.toContain('Issues found');
    expect(names(f).slice(-2)).toEqual(['comment', 'add-label']);
  });

  test('still reports failure for an empty error list', async () => {
    const f = fixture({ files: { [errorsPath]: '[]' } });
    await f.run('failure');
    expect(argsFor(f, 'comment')[0]?.[0]).toMatchObject({ body: expect.stringContaining('Layout validation failed') });
    expect(argsFor(f, 'add-label')).toHaveLength(1);
  });

  test.each(['comment', 'add-label'])('propagates %s failure without publishing a layout', async name => {
    const f = fixture({ fail: { [name]: 'synthetic API rejection' } });
    await expect(f.run('failure')).rejects.toThrow('synthetic API rejection');
    expect(argsFor(f, 'exec')).toEqual([]);
    expect(argsFor(f, 'pull')).toEqual([]);
  });

  test('repeat feedback execution reads current error details', async () => {
    const f = fixture({ files: { [errorsPath]: '["First fixture"]' } });
    await f.run('failure');
    f.files.set(errorsPath, '["Second fixture"]');
    await f.run('failure');
    expect(argsFor(f, 'comment')[0]?.[0]).toMatchObject({ body: expect.stringContaining('First fixture') });
    expect(argsFor(f, 'comment')[1]?.[0]).toMatchObject({ body: expect.stringContaining('Second fixture') });
  });
});
