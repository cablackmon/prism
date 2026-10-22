import { DEFAULT_CHANGELOG, runRelease } from './burn4-release-fixture';
import type { ReleaseOptions } from './burn4-release-fixture';

describe('release argument validation before document writes', () => {
  test.each([
    ['missing argument', []],
    ['multiple arguments', ['1.2.4', 'extra']],
  ])('%s prints usage and leaves every document unchanged', (_label, args) => {
    const result = runRelease(args);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Usage:');
    expect(result.after).toEqual(result.before);
    expect(result.nodeCalls).toBe(0);
    expect(result.checkerCalls).toEqual([]);
  });

  test.each([
    ['empty', ''],
    ['missing component', '1.2'],
    ['extra component', '1.2.3.4'],
    ['negative', '-1.2.3'],
    ['prerelease', '1.2.4-beta'],
    ['build metadata', '1.2.4+local'],
    ['prefix', 'v1.2.4'],
    ['surrounding whitespace', ' 1.2.4 '],
    ['newline', '1.2.4\n'],
    ['shell punctuation', '1.2.4;false'],
  ])('rejects %s version syntax', (_label, version) => {
    const result = runRelease([version], { addon: 'version: "1.2.3"\n' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('version must be N.N.N');
    expect(result.after).toEqual(result.before);
    expect(result.nodeCalls).toBe(0);
    expect(result.checkerCalls).toEqual([]);
  });
});

describe('release preflight document and tool failures', () => {
  test.each<[string, ReleaseOptions, string]>([
    ['unchanged version', {}, 'already at 1.2.3'],
    ['missing package', { packageText: null }, 'ENOENT'],
    ['invalid package JSON', { packageText: '{invalid json}\n' }, 'SyntaxError'],
    ['null package', { packageText: 'null\n' }, 'TypeError'],
    ['missing changelog', { changelog: null }, 'ENOENT'],
    ['missing Unreleased heading', { changelog: DEFAULT_CHANGELOG.replace('## Unreleased', '## Draft') }, 'no "## Unreleased" heading'],
    ['missing historical anchor', { changelog: '## Unreleased\n\n- A note.\n' }, 'no existing versioned section'],
    ['empty Unreleased notes', { changelog: '## Unreleased\n \n\t\n## [1.2.3]\n- History.\n' }, 'section is empty'],
  ])('%s halts before any document mutation', (label, options, diagnostic) => {
    const result = runRelease([label === 'unchanged version' ? '1.2.3' : '1.2.4'], {
      addon: 'version: "1.2.3"\nname: burn4-fixture\n',
      ...options,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(diagnostic);
    expect(result.after).toEqual(result.before);
    expect(result.nodeCalls).toBe(1);
    expect(result.checkerCalls).toEqual([]);
    expect(result.stdout).not.toContain('Release prep complete');
  });

  test.each(['node', 'date'] as const)('missing %s never falls back to a host command', (omitCommand) => {
    const result = runRelease(['1.2.4'], { omitCommand });
    expect(result.status).toBe(127);
    expect(result.stderr).toContain(`${omitCommand}: command not found`);
    expect(result.after).toEqual(result.before);
    expect(result.nodeCalls).toBe(0);
    expect(result.checkerCalls).toEqual([]);
  });

  test('a failed package-write phase stops the later phases', () => {
    const result = runRelease(['1.2.4'], { failNodeAt: 2, addon: 'version: "1.2.3"\n' });
    expect(result.status).toBe(73);
    expect(result.after).toEqual(result.before);
    expect(result.nodeCalls).toBe(2);
    expect(result.checkerCalls).toEqual([]);
    expect(result.stdout).not.toContain('Release prep complete');
  });

  test.each([
    ['Unreleased heading disappears', '## Draft\n\n- Notes.\n\n## [1.2.3]\n', 'no "## Unreleased" heading'],
    ['historical anchor disappears', '## Unreleased\n\n- Notes.\n', 'no existing versioned section'],
    ['release notes disappear', '## Unreleased\n\n## [1.2.3]\n- History.\n', 'section is empty'],
  ])('revalidates and preserves the competing changelog edit when %s', (_label, text, diagnostic) => {
    const result = runRelease(['1.2.4'], { concurrentChangelog: { beforeNodeCall: 3, text } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(diagnostic);
    expect(result.after.changelog).toBe(text);
    expect(result.nodeCalls).toBe(3);
    expect(result.checkerCalls).toEqual([]);
    expect(result.stdout).not.toContain('Release prep complete');
  });
});
