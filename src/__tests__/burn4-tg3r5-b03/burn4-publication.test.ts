import { publication } from './burn4-harness';

const expected = [
  ['config', 'user.name', 'github-actions[bot]'],
  ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'],
  ['checkout', '--orphan', 'traffic-data'],
  ['rm', '-rf', '--cached', '.'],
  ['add', 'traffic/'],
  ['diff', '--staged', '--quiet'],
  ['commit', '-m', 'traffic stats 2026-10-22'],
  ['push', '--force', 'origin', 'traffic-data'],
];

describe('isolated publication shell stage with inert git and date', () => {
  test('records the intended publication sequence without invoking a real git process', () => {
    const result = publication();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.calls).toEqual(expected);
  });

  test('unchanged staged content exits successfully before commit and push', () => {
    const result = publication({ diff: 0 });
    expect(result.status).toBe(0);
    expect(result.calls).toEqual(expected.slice(0, 6));
  });

  test.each([
    ['config:user.name', 0], ['config:user.email', 1], ['checkout', 2], ['rm', 3], ['add', 4], ['commit', 6], ['push', 7],
  ] as const)('%s failure stops immediately without later publication commands', (fail, index) => {
    const result = publication({ fail });
    expect(result.status).toBe(23);
    expect(result.calls).toEqual(expected.slice(0, index + 1));
  });
});
