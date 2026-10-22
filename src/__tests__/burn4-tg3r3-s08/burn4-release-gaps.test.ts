import { DEFAULT_CHANGELOG, runRelease } from './burn4-release-fixture';
import type { ReleaseOptions } from './burn4-release-fixture';

describe('release safeguards that are currently missing', () => {
  test.failing('KNOWN GAP: a version already present in changelog history is accepted and duplicated', () => {
    const changelog = DEFAULT_CHANGELOG + '\n## [2.0.0] - 2040-01-01\n\n- Existing target release.\n';
    const result = runRelease(['2.0.0'], { changelog });
    expect({ status: result.status, documents: result.after }).toEqual({ status: 1, documents: result.before });
  });

  test.failing('KNOWN GAP: a duplicate Unreleased heading is moved into the published release notes', () => {
    const changelog = DEFAULT_CHANGELOG.replace('### Fixed', '## Unreleased\n\n### Fixed');
    const result = runRelease(['1.2.4'], { changelog });
    expect({ status: result.status, documents: result.after }).toEqual({ status: 1, documents: result.before });
  });

  test.failing('KNOWN GAP: malformed historical version headings qualify as valid release anchors', () => {
    const result = runRelease(['1.2.4'], { changelog: '## Unreleased\n\n- A local note.\n\n## [1broken\n\n- Malformed history.\n' });
    expect({ status: result.status, documents: result.after }).toEqual({ status: 1, documents: result.before });
  });

  test.failing('KNOWN GAP: a package without a current version is accepted as releasable', () => {
    const result = runRelease(['1.2.4'], { packageText: '{"name":"burn4-fixture","private":true}\n' });
    expect({ status: result.status, documents: result.after }).toEqual({ status: 1, documents: result.before });
  });

  test.failing.each<[string, ReleaseOptions]>([
    ['invalid addon manifest', { addon: 'name: burn4-fixture\n' }],
    ['addon update process failure', { addon: 'version: "1.2.3"\n', failNodeAt: 3 }],
    ['changelog update process failure', { addon: 'version: "1.2.3"\n', failNodeAt: 4 }],
    ['final checker rejection', { addon: 'version: "1.2.3"\n', checkerStatus: 64 }],
  ])('KNOWN GAP: release document writes are not atomic after %s', (_label, options) => {
    const result = runRelease(['1.2.4'], options);
    expect(result.after).toEqual(result.before);
  });

  test.failing.each([
    ['Unreleased heading disappears', '## Draft\n\n- Notes.\n\n## [1.2.3]\n'],
    ['historical anchor disappears', '## Unreleased\n\n- Notes.\n'],
    ['release notes disappear', '## Unreleased\n\n## [1.2.3]\n- History.\n'],
  ])('KNOWN GAP: package version is not restored when %s between preflight and changelog write', (_label, text) => {
    const result = runRelease(['1.2.4'], { concurrentChangelog: { beforeNodeCall: 3, text } });
    expect(result.after.packageText).toBe(result.before.packageText);
  });
});
