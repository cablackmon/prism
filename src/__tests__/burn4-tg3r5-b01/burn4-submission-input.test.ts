import { Script } from 'node:vm';
import { argsFor, block, fixture, layout, names, now, steps, submissionPath } from './burn4-workflow-harness';

describe('layout submission account and daily gates', () => {
  test.each([7, 7.001, 14, 1000])('accepts accounts at least seven days old: %s', async days => {
    const f = fixture({ createdAt: new Date(now - days * 86400000).toISOString() });
    await f.run('limits');
    expect(f.outputs).toEqual({ passed: 'true' });
    expect(f.failures).toEqual([]);
    expect(names(f)).toEqual(['user', 'list', 'output']);
  });

  test.each([0, 1, 6.999, -1])('closes too-new accounts before list lookup: %s', async days => {
    const f = fixture({ createdAt: new Date(now - days * 86400000).toISOString() });
    await f.run('limits');
    expect(names(f)).toEqual(['user', 'comment', 'update', 'failed']);
    expect(argsFor(f, 'update')).toEqual([[{ owner: 'fixture-owner', repo: 'fixture-repo', issue_number: 41, state: 'closed' }]]);
    expect(argsFor(f, 'comment')[0]?.[0]).toMatchObject({ body: expect.stringContaining('Account too new') });
    expect(f.failures).toEqual(['Account too new']);
    expect(f.outputs).toEqual({});
  });

  test.each([0, 1, 11, 12])('accepts up to twelve listed submissions: %s', async issueCount => {
    const f = fixture({ issueCount });
    await f.run('limits');
    expect(f.outputs.passed).toBe('true');
    expect(argsFor(f, 'comment')).toEqual([]);
  });

  test.each([13, 20])('closes over-limit submissions: %s', async issueCount => {
    const f = fixture({ issueCount });
    await f.run('limits');
    expect(names(f)).toEqual(['user', 'list', 'comment', 'update', 'failed']);
    expect(f.failures).toEqual(['Daily limit reached']);
    expect(argsFor(f, 'comment')[0]?.[0]).toMatchObject({ body: expect.stringContaining('12 layouts per day') });
    expect(f.outputs).toEqual({});
  });

  test('queries the author and exact UTC daily limit scope', async () => {
    const f = fixture({ repo: 'isolated-repo', issue: 77 });
    await f.run('limits');
    expect(argsFor(f, 'user')).toEqual([[{ username: 'fixture-author' }]]);
    expect(argsFor(f, 'list')).toEqual([[{
      owner: 'fixture-owner', repo: 'isolated-repo', labels: 'layout-submission',
      creator: 'fixture-author', since: '2026-10-21T00:00:00Z', state: 'all', per_page: 20,
    }]]);
  });

  test.each(['user', 'list'])('stops safely when the %s lookup rejects', async name => {
    const f = fixture({ fail: { [name]: 'synthetic lookup failure' } });
    await expect(f.run('limits')).rejects.toThrow('synthetic lookup failure');
    expect(f.outputs).toEqual({});
    expect(argsFor(f, 'update')).toEqual([]);
  });

  test.each(['comment', 'update'])('propagates a rejected account-rejection %s', async name => {
    const f = fixture({ createdAt: new Date(now).toISOString(), fail: { [name]: 'synthetic action failure' } });
    await expect(f.run('limits')).rejects.toThrow('synthetic action failure');
    expect(f.outputs).toEqual({});
    expect(argsFor(f, 'list')).toEqual([]);
    expect(f.failures).toEqual([]);
  });

  test.each(['comment', 'update'])('propagates a rejected daily-limit %s', async name => {
    const f = fixture({ issueCount: 13, fail: { [name]: 'synthetic action failure' } });
    await expect(f.run('limits')).rejects.toThrow('synthetic action failure');
    expect(f.outputs).toEqual({});
    expect(f.failures).toEqual([]);
  });
});

describe('layout submission JSON extraction', () => {
  const data = layout();
  test.each([
    ['fenced', `Fixture form\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``],
    ['raw', JSON.stringify(data)],
    ['raw with surrounding prose', `Fixture preface\n${JSON.stringify(data, null, 2)}\nFixture footer`],
    ['fenced whitespace', `\`\`\`json   \n${JSON.stringify(data, null, 2)}\n  \`\`\``],
  ])('extracts %s JSON without altering data', async (_name, body) => {
    const f = fixture({ body });
    await f.run('extract');
    expect(JSON.parse(f.files.get(submissionPath) ?? '')).toEqual(data);
    expect(f.outputs).toEqual({ layout: JSON.stringify(data), passed: 'true' });
    expect(names(f)).toEqual([`write:${submissionPath}`, 'output', 'output']);
  });

  test.each([null, '', 'No fixture layout', '```text\n{"fixture":true}\n```'])('labels missing layout text: %s', async body => {
    const f = fixture({ body, files: {} });
    await f.run('extract');
    expect(f.failures).toEqual(['No JSON found']);
    expect(names(f)).toEqual(['comment', 'add-label', 'failed']);
    expect(argsFor(f, 'add-label')).toEqual([[{ owner: 'fixture-owner', repo: 'fixture-repo', issue_number: 41, labels: ['needs-fix'] }]]);
    expect(f.files.size).toBe(0);
    expect(f.outputs).toEqual({});
  });

  test.each(['```json\n{broken}\n```', '```json\n\n```', '{"type":"prism-layout",}'])('reports malformed JSON: %s', async body => {
    const f = fixture({ body, files: {} });
    await f.run('extract');
    expect(f.failures).toEqual(['Invalid JSON']);
    expect(argsFor(f, 'comment')[0]?.[0]).toMatchObject({ body: expect.stringContaining('Invalid JSON') });
    expect(names(f)).toEqual(['comment', 'add-label', 'failed']);
    expect(f.files.size).toBe(0);
  });

  test.each(['null', '[]', '42', '"fixture"'])('leaves structural validation to the validator: %s', async json => {
    const f = fixture({ body: `\`\`\`json\n${json}\n\`\`\``, files: {} });
    await f.run('extract');
    expect(f.outputs.layout).toBe(json);
    expect(f.outputs.passed).toBe('true');
  });

  test('selects the first fenced JSON block deterministically', async () => {
    const first = layout({ name: 'First Fixture' });
    const f = fixture({ body: `\`\`\`json\n${JSON.stringify(first)}\n\`\`\`\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`` });
    await f.run('extract');
    expect(JSON.parse(String(f.outputs.layout))).toEqual(first);
  });

  test.each(['comment', 'add-label'])('propagates missing-JSON %s failures', async name => {
    const f = fixture({ body: '', fail: { [name]: 'synthetic rejection' } });
    await expect(f.run('extract')).rejects.toThrow('synthetic rejection');
    expect(f.outputs).toEqual({});
    expect(f.failures).toEqual([]);
  });

  test('cannot signal success after submission write fails', async () => {
    const f = fixture({ body: JSON.stringify(data), fail: { [`write:${submissionPath}`]: 'synthetic disk failure' } });
    await expect(f.run('extract')).rejects.toThrow('synthetic disk failure');
    expect(f.outputs).toEqual({});
  });

  test('independent concurrent submissions keep files and outputs separate', async () => {
    const first = fixture({ body: JSON.stringify(layout({ name: 'First Fixture' })) });
    const second = fixture({ body: JSON.stringify(layout({ name: 'Second Fixture' })) });
    await Promise.all([first.run('extract'), second.run('extract')]);
    expect(JSON.parse(String(first.outputs.layout)).name).toBe('First Fixture');
    expect(JSON.parse(String(second.outputs.layout)).name).toBe('Second Fixture');
    expect(first.files.get(submissionPath)).not.toBe(second.files.get(submissionPath));
  });
});

describe('offline execution boundary', () => {
  test('extracts each of the five real workflow bodies', () => {
    for (const step of Object.keys(steps) as Array<keyof typeof steps>) expect(block(step).length).toBeGreaterThan(100);
    expect(block('publish')).toContain('await github.rest.pulls.create');
    expect(block('validator')).toContain('validateCommunityLayout(layout');
  });

  test('denies unknown module imports and exposes no ambient network or environment', () => {
    const f = fixture();
    expect(() => new Script("require('node:fs')").runInContext(f.sandbox)).toThrow('Denied import');
    expect(new Script('typeof fetch + ":" + typeof process.env + ":" + typeof Buffer').runInContext(f.sandbox)).toBe('undefined:undefined:undefined');
    expect(() => new Script('eval("1+1")').runInContext(f.sandbox)).toThrow();
  });
});
