import { runHook } from './burn4-hook-harness';

// The source promises silent failures. These three cases share one defect:
// enumeration exit statuses are discarded before stdout becomes session context.
describe('GitHub activity hook existing defects', () => {
  test.failing('KNOWN GAP: two failed list queries claim there are no open items', () => {
    const result = runHook({
      prs: { status: 1, stderr: 'synthetic PR query failure' },
      issues: { status: 1, stderr: 'synthetic issue query failure' },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.calls.map((call) => call[0])).toEqual(['repo', 'pr', 'issue']);
    expect(result.stdout).toBe('');
  });

  test.failing('KNOWN GAP: failed PR query publishes partial stdout as a complete PR section', () => {
    const issue = '- #73 Successfully queried issue | @reporter';
    const partial = '- #40 Incomplete PR result | @builder';
    const result = runHook({
      prs: { status: 1, stdout: partial, stderr: 'synthetic formatter failure' },
      issues: { stdout: issue },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(issue);
    expect(result.stdout).not.toContain(partial);
  });

  test.failing('KNOWN GAP: failed issue query publishes partial stdout as a complete issue section', () => {
    const pr = '- #91 Successfully queried PR | @builder';
    const partial = '- #25 Incomplete issue result | @reporter';
    const result = runHook({
      prs: { stdout: pr },
      issues: { status: 1, stdout: partial, stderr: 'synthetic formatter failure' },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(pr);
    expect(result.stdout).not.toContain(partial);
  });
});
