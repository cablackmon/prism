import { archive, merge, publication } from './burn4-harness';

// Direct inverse probes temporarily change only test.failing to test.
// Every setup assertion must pass before the named intended assertion fails.
describe('KNOWN GAP traffic history regressions', () => {
  test.failing.each(['missing', 'malformed', 'error-object'] as const)('KNOWN GAP: %s referrer input clears the latest successful referrer table', kind => {
    const previous = archive();
    const result = merge({ history: previous,
      ...(kind === 'missing' ? { missing: ['referrers'] as 'referrers'[] } : {}),
      ...(kind === 'malformed' ? { raw: { referrers: '{broken' } } : {}),
      ...(kind === 'error-object' ? { referrers: { message: 'synthetic endpoint unavailable' } } : {}),
    });
    expect(result.error).toBeNull();
    expect(result.history?.referrer_history).toEqual(previous.referrer_history);
    expect(result.history?.referrers).toEqual(previous.referrers);
  });

  test.failing.each([
    ['views', null], ['views', []], ['views', false], ['views', 7], ['views', 'invalid'],
    ['clones', null], ['clones', []], ['clones', false], ['clones', 7], ['clones', 'invalid'],
  ] as const)('KNOWN GAP: non-object %s API JSON %p aborts all history merging', (endpoint, value) => {
    const previous = archive();
    const result = merge({ history: previous, [endpoint]: value });
    expect(result.error).toBeNull();
    expect(result.history?.views).toEqual(previous.views);
    expect(result.history?.clones).toEqual(previous.clones);
  });

  test.failing('KNOWN GAP: an interrupted JSON write truncates the only valid history archive', () => {
    const previous = archive();
    const result = merge({ history: previous, faults: { write_after_chars: 20 } });
    expect(result.error).toEqual({ type: 'OSError', message: 'synthetic interrupted write' });
    expect(result.historyText).toBe(JSON.stringify(previous));
  });

  test.failing('KNOWN GAP: staged diff errors are treated as changes and still commit and push', () => {
    const result = publication({ fail: 'diff', failureCode: 2 });
    expect(result.status).toBe(2);
    expect(result.calls.some(call => call[0] === 'commit' || call[0] === 'push')).toBe(false);
  });
});
