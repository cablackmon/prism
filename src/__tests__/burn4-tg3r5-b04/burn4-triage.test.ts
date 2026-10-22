import { expression, render, runTriage, stepsFor, WorkflowFixture, type Event } from './burn4-workflow-harness';

let fixture: WorkflowFixture;
beforeEach(() => { fixture = new WorkflowFixture(); });
afterEach(() => { fixture.dispose(); });

const labelCommand = (number: string, operation: string) => [
  'issue', 'edit', number, '--repo', 'sample/project', operation, 'needs-reply',
];

describe('needs-reply inline event computation and source conditions', () => {
  const events: [string, Event, string, string][] = [
    ['issue opened', { sender: { login: 'alex' }, issue: { number: 41 } }, 'alex', '41'],
    ['PR opened', { sender: { login: 'robin' }, pull_request: { number: 52 } }, 'robin', '52'],
    ['issue comment', { comment: { user: { login: 'taylor' } }, sender: { login: 'sender' }, issue: { number: 63 } }, 'taylor', '63'],
    ['PR issue comment', { comment: { user: { login: 'casey' } }, issue: { number: 74 } }, 'casey', '74'],
    ['review submitted', { review: { user: { login: 'morgan' } }, pull_request: { number: 85 } }, 'morgan', '85'],
    ['review comment', { comment: { user: { login: 'sam' } }, pull_request: { number: 96 } }, 'sam', '96'],
  ];
  it.each(events)('%s resolves actor/target and adds exactly one label', (_name, event, actor, number) => {
    const result = runTriage(fixture, event);
    expect(result.compute.status).toBe(0);
    expect(result.compute.outputs).toEqual({ actor, number, is_owner: 'false', is_bot: 'false' });
    expect(result.compute.commands).toEqual([]);
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0]?.status).toBe(0);
    expect(result.labels[0]?.commands).toEqual([labelCommand(number, '--add-label')]);
  });

  it('prefers comment over review and sender, and issue over pull request', () => {
    const result = runTriage(fixture, {
      comment: { user: { login: 'commenter' } }, review: { user: { login: 'reviewer' } },
      sender: { login: 'sender' }, issue: { number: 12 }, pull_request: { number: 34 },
    });
    expect(result.compute.outputs).toMatchObject({ actor: 'commenter', number: '12' });
    expect(result.labels[0]?.commands).toEqual([labelCommand('12', '--add-label')]);
  });

  it('falls back from an empty comment to review before sender', () => {
    const result = runTriage(fixture, {
      comment: { user: { login: '' } }, review: { user: { login: 'reviewer' } },
      sender: { login: 'sender' }, pull_request: { number: 13 },
    });
    expect(result.compute.outputs.actor).toBe('reviewer');
    expect(result.labels[0]?.commands).toEqual([labelCommand('13', '--add-label')]);
  });

  it.each(['comment', 'review', 'sender'] as const)('owner through %s selects removal only', (field) => {
    const event: Event = { issue: { number: 101 }, [field]: field === 'sender' ? { login: 'sandydargoport' } : { user: { login: 'sandydargoport' } } };
    const result = runTriage(fixture, event);
    expect(result.compute.outputs).toMatchObject({ actor: 'sandydargoport', is_owner: 'true', is_bot: 'false' });
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0]?.commands).toEqual([labelCommand('101', '--remove-label')]);
  });

  it.each(['renovate[bot]', 'github-actions', 'dependabot', 'renovate', 'codecov', 'codecov-bot'])('%s is filtered without a gh call', (login) => {
    const result = runTriage(fixture, { sender: { login }, issue: { number: 102 } });
    expect(result.compute.outputs).toMatchObject({ is_bot: 'true', is_owner: 'false' });
    expect(result.labels).toEqual([]);
  });

  it.each(['github-actions-user', 'dependabot-user', 'renovate-user', 'friendly-bot', 'Sandydargoport'])('%s remains an external human under the source policy', (login) => {
    const result = runTriage(fixture, { sender: { login }, issue: { number: 103 } });
    expect(result.compute.outputs).toMatchObject({ is_bot: 'false', is_owner: 'false' });
    expect(result.labels[0]?.commands).toEqual([labelCommand('103', '--add-label')]);
  });

  it.each(['sandydargoport', 'alex', 'dependabot'])('missing target prevents every label command for %s', (login) => {
    const result = runTriage(fixture, { sender: { login } });
    expect(result.compute.outputs.number).toBe('');
    expect(result.labels).toEqual([]);
  });

  it('zero issue number falls back to the PR number using source OR semantics', () => {
    const result = runTriage(fixture, { sender: { login: 'alex' }, issue: { number: 0 }, pull_request: { number: 17 } });
    expect(result.compute.outputs.number).toBe('17');
    expect(result.labels[0]?.commands).toEqual([labelCommand('17', '--add-label')]);
  });

  it.each(['alex', 'sandydargoport'])('records the source failure suppression for %s without retry', (login) => {
    const result = runTriage(fixture, { sender: { login }, issue: { number: 104 } }, 23);
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0]?.status).toBe(0);
    expect(result.labels[0]?.commands).toEqual([
      labelCommand('104', login === 'alex' ? '--add-label' : '--remove-label'),
    ]);
  });
});

describe('offline extraction and fixture safety boundaries', () => {
  it('loads exactly the five allowed shell steps without loading an action', () => {
    expect(stepsFor('needs-reply').map((step) => step.name)).toEqual([
      'Compute actor and target', 'Add needs-reply (external activity)', 'Remove needs-reply (owner replied)',
    ]);
    expect(stepsFor('release').map((step) => step.name)).toEqual([
      'Extract tag + version', 'Verify ha-app/config.yaml version matches tag',
    ]);
  });

  it('rejects unrecognized context paths and expression syntax', () => {
    expect(() => expression('github.unavailable', {})).toThrow('Unsupported ordinary context path');
    expect(() => expression('always()', {})).toThrow('Unsupported ordinary context path');
  });

  it('rejects shell syntax before a synthetic value reaches Bash', () => {
    expect(() => render('${{ github.repository }}', { github: { repository: 'sample/$(command)' } }))
      .toThrow('Unsafe synthetic shell interpolation');
  });

  it('rejects objects as shell values instead of coercing them', () => {
    expect(() => render('${{ github.repository }}', { github: { repository: {} } }))
      .toThrow('ordinary primitive');
  });
});
