import { runHook } from './burn4-hook-harness';

const empty = '## GitHub activity\n\nNo open PRs or issues.\n';
const pr = '- #41 (draft) Repair calendar ordering | @builder';
const issue = '- #72 Missing image placeholder | @reporter';

function prSection(rows: string[]): string {
  return `**Open PRs (${rows.length}):**\n${rows.join('\n')}\n\n`;
}

function issueSection(rows: string[]): string {
  return `**Open issues (${rows.length}):**\n${rows.join('\n')}\n`;
}

describe('offline GitHub activity hook session output', () => {
  test('a missing gh executable exits silently without invoking any list', () => {
    expect(runHook({ ghAvailable: false })).toEqual({
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      calls: [],
      injectedFileExists: false,
    });
  });

  test('failed repository binding suppresses its output and stops before lists', () => {
    const result = runHook({ repo: { status: 1, stdout: 'unbound repository\n', stderr: 'cannot resolve\n' } });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.calls).toEqual([['repo', 'view', '--json', 'name']]);
  });

  test('successful repository binding does not expose its JSON or diagnostics', () => {
    const result = runHook({ repo: { stdout: '{"name":"synthetic-repo"}\n', stderr: 'synthetic warning\n' } });
    expect(result.stdout).toBe(empty);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  test('successful empty lists explicitly report no open items', () => {
    const result = runHook();
    expect(result.stdout).toBe(empty);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
  });

  test('blank lines in successful empty stdout do not become items', () => {
    expect(runHook({ prs: { stdout: '\n\n' }, issues: { stdout: '\n' } }).stdout).toBe(empty);
  });

  test('PR-only activity includes draft and open rows with the correct count', () => {
    const rows = [pr, '- #42 Recheck repeat events | @contributor'];
    const result = runHook({ prs: { stdout: rows.join('\n') } });
    expect(result.stdout).toBe(`## GitHub activity\n\n${prSection(rows)}`);
    expect(result.stdout).not.toContain('Open issues');
    expect(result.status).toBe(0);
  });

  test('issue-only activity excludes the empty PR section', () => {
    const rows = [issue, '- #73 Improve error wording | @tester'];
    const result = runHook({ issues: { stdout: rows.join('\n') } });
    expect(result.stdout).toBe(`## GitHub activity\n\n${issueSection(rows)}`);
    expect(result.stdout).not.toContain('Open PRs');
    expect(result.status).toBe(0);
  });

  test('mixed activity renders PRs before issues with independent counts', () => {
    const issues = [issue, '- #73 Duplicate calendar entry | @tester'];
    const result = runHook({ prs: { stdout: pr }, issues: { stdout: issues.join('\n') } });
    expect(result.stdout).toBe(`## GitHub activity\n\n${prSection([pr])}${issueSection(issues)}`);
  });

  test('binding and enumeration run once each in dependency order', () => {
    const result = runHook();
    expect(result.calls.map((call) => call.slice(0, 2))).toEqual([
      ['repo', 'view'],
      ['pr', 'list'],
      ['issue', 'list'],
    ]);
    // The fake rejects unknown flags and requires explicit open state, a limit,
    // projected fields and one --jq expression. Its formatter is not executed.
    expect(result.calls[1]?.slice(2, 9)).toEqual([
      '--state', 'open', '--limit', '20', '--json', 'number,title,author,isDraft,createdAt', '--jq',
    ]);
    expect(result.calls[2]?.slice(2, 9)).toEqual([
      '--state', 'open', '--limit', '20', '--json', 'number,title,author,createdAt', '--jq',
    ]);
  });

  test('the hook preserves the order already returned by the gh formatter', () => {
    const rows = ['- #90 Newest | @recent', '- #4 Older | @earlier'];
    expect(runHook({ prs: { stdout: rows.join('\n') } }).stdout)
      .toBe(`## GitHub activity\n\n${prSection(rows)}`);
  });

  test('backslashes and printf placeholders in formatted rows are literal', () => {
    const row = '- #12 Retain %s and \\n and \\t | @author';
    expect(runHook({ prs: { stdout: row } }).stdout).toBe(`## GitHub activity\n\n${prSection([row])}`);
  });

  test('non-ASCII titles survive the shell round trip', () => {
    const row = '- #18 Fix café and 家族 calendar | @contributor';
    expect(runHook({ issues: { stdout: row } }).stdout).toBe(`## GitHub activity\n\n${issueSection([row])}`);
  });

  test('command substitution and quotes in row text are never executed', () => {
    const row = '- #19 Preserve \'quotes\' $(printf marker > burn4-injected) `printf another` | @author';
    const result = runHook({ prs: { stdout: row } });
    expect(result.stdout).toBe(`## GitHub activity\n\n${prSection([row])}`);
    expect(result.injectedFileExists).toBe(false);
    expect(result.stderr).toBe('');
  });

  test('terminal newlines from gh do not create extra rows or blank output sections', () => {
    const result = runHook({ prs: { stdout: `${pr}\n\n` }, issues: { stdout: `${issue}\n` } });
    expect(result.stdout).toBe(`## GitHub activity\n\n${prSection([pr])}${issueSection([issue])}`);
  });

  test('the configured maximum response size is counted independently for both lists', () => {
    const prs = Array.from({ length: 20 }, (_, n) => `- #${n + 1} Synthetic PR | @builder`);
    const issues = Array.from({ length: 20 }, (_, n) => `- #${n + 101} Synthetic issue | @reporter`);
    const result = runHook({ prs: { stdout: prs.join('\n') }, issues: { stdout: issues.join('\n') } });
    expect(result.stdout).toBe(`## GitHub activity\n\n${prSection(prs)}${issueSection(issues)}`);
    expect(result.status).toBe(0);
  });

  test('successful list stderr is hidden from session context', () => {
    const result = runHook({
      prs: { stdout: pr, stderr: 'PR warning\n' },
      issues: { stdout: issue, stderr: 'issue warning\n' },
    });
    expect(result.stdout).toBe(`## GitHub activity\n\n${prSection([pr])}${issueSection([issue])}`);
    expect(result.stderr).toBe('');
  });

  test('an empty failed PR listing still permits a successful issue listing', () => {
    const result = runHook({ prs: { status: 1, stderr: 'PR query failed\n' }, issues: { stdout: issue } });
    expect(result.stdout).toBe(`## GitHub activity\n\n${issueSection([issue])}`);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.calls.map((call) => call[0])).toEqual(['repo', 'pr', 'issue']);
  });

  test('an empty failed issue listing still permits a successful PR listing', () => {
    const result = runHook({ prs: { stdout: pr }, issues: { status: 2, stderr: 'issue query failed\n' } });
    expect(result.stdout).toBe(`## GitHub activity\n\n${prSection([pr])}`);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  test('hook input from a startup event does not contaminate activity output', () => {
    const result = runHook({ stdin: '{"hook_event_name":"SessionStart","source":"startup"}\n', prs: { stdout: pr } });
    expect(result.stdout).toBe(`## GitHub activity\n\n${prSection([pr])}`);
    expect(result.stderr).toBe('');
  });

  test('repeated sessions do not retain the previous invocation rows or errors', () => {
    const first = runHook({ prs: { stdout: pr }, issues: { stdout: issue } });
    const second = runHook({ repo: { status: 1, stderr: 'later repository unavailable' } });
    const third = runHook();
    expect(first.stdout).toContain(pr);
    expect(first.stdout).toContain(issue);
    expect(second.stdout).toBe('');
    expect(second.calls).toHaveLength(1);
    expect(third.stdout).toBe(empty);
    expect(third.calls).toHaveLength(3);
    expect(third.stderr).toBe('');
  });
});
