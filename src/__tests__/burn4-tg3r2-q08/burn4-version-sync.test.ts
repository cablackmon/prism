import { join } from 'node:path';
import { cleanupFixtures, createFixture, runScript, writeFixture } from './burn4-shell-fixture';

function releaseFixture(changelog = '## Unreleased\n\n## [2.4.6] - release\n'): string {
  const root = createFixture();
  writeFixture(root, 'package.json', JSON.stringify({ name: 'local-fixture', version: '2.4.6' }));
  writeFixture(root, 'docs/CHANGELOG.md', changelog);
  return root;
}

afterEach(cleanupFixtures);

describe('check-version-sync disposable release metadata', () => {
  test('accepts matching package and changelog without an optional addon', () => {
    const root = releaseFixture();
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('package.json (2.4.6) matches');
  });

  test.each(['2.4.6', '"2.4.6"', "'2.4.6'", '"2.4.6" # local fixture'])('accepts addon version form %s', (version) => {
    const root = releaseFixture();
    writeFixture(root, 'ha-app/config.yaml', `name: Local fixture\nversion: ${version}\n`);
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('matches CHANGELOG.md + ha-app/config.yaml');
  });

  test('anchors repository lookup to the copied script instead of the caller directory', () => {
    const root = releaseFixture();
    writeFixture(root, 'nested/package.json', JSON.stringify({ version: '9.9.9' }));
    const result = runScript(root, 'check-version-sync.sh', [], join(root, 'nested'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('package.json (2.4.6)');
  });

  test('compares the first versioned heading rather than the greatest version', () => {
    const root = releaseFixture('## Unreleased\n## [2.4.6] - release\n## [9.0.0] - older entry\n');
    expect(runScript(root, 'check-version-sync.sh').status).toBe(0);
  });

  test('ignores unreleased text, third-level headings and unbracketed dates', () => {
    const root = releaseFixture('## Unreleased\n### [9.0.0] ignored\n## 2026.10.21\n## [2.4.6] - release\n');
    expect(runScript(root, 'check-version-sync.sh').status).toBe(0);
  });

  test('does not accidentally match a prefix of a longer version', () => {
    const root = releaseFixture('## [2.4.60] - release\n');
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('version drift detected');
    expect(result.stdout).toContain('CHANGELOG.md (top):  2.4.60');
  });

  test.each(['', '## Unreleased\n', '### [2.4.6]\n', '## [2.4]\n', ' ## [2.4.6]\n'])('rejects missing or malformed version heading: %j', (changelog) => {
    const result = runScript(releaseFixture(changelog), 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('has no versioned section heading');
    expect(result.stdout).not.toContain('matches CHANGELOG');
  });

  test('reports changelog drift and both compared values before checking the addon', () => {
    const root = releaseFixture('## [2.4.5] - release\n');
    writeFixture(root, 'ha-app/config.yaml', 'name: no version\n');
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('package.json:        2.4.6');
    expect(result.stdout).toContain('CHANGELOG.md (top):  2.4.5');
    expect(result.stdout).toContain('scripts/release.sh');
    expect(result.stdout).not.toContain('no parseable version');
  });

  test('rejects a missing changelog with diagnostics and a nonzero exit', () => {
    const root = createFixture();
    writeFixture(root, 'package.json', JSON.stringify({ version: '2.4.6' }));
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/CHANGELOG.md');
    expect(result.stdout).toContain('has no versioned section heading');
  });

  test('rejects a missing package instead of reporting synchronization', () => {
    const root = createFixture();
    writeFixture(root, 'docs/CHANGELOG.md', '## [2.4.6]\n');
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Cannot find module');
    expect(result.stdout).toBe('');
  });

  test('rejects malformed package JSON before reading changelog versions', () => {
    const root = releaseFixture();
    writeFixture(root, 'package.json', '{ broken JSON');
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ERR_INVALID_PACKAGE_CONFIG|SyntaxError/);
    expect(result.stderr).toContain('package.json');
    expect(result.stdout).toBe('');
  });

  test('rejects an absent package version rather than accepting a changelog match', () => {
    const root = releaseFixture();
    writeFixture(root, 'package.json', JSON.stringify({ name: 'local-fixture' }));
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('package.json:        undefined');
    expect(result.stdout).toContain('version drift detected');
  });

  test.each(['', 'name: Local fixture\n', 'version:\n', '# version: 2.4.6\n'])('rejects an existing addon without a parseable version: %j', (config) => {
    const root = releaseFixture();
    writeFixture(root, 'ha-app/config.yaml', config);
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ha-app/config.yaml has no parseable version: field');
  });

  test('reports addon drift and both compared versions', () => {
    const root = releaseFixture();
    writeFixture(root, 'ha-app/config.yaml', 'version: "2.4.5"\n');
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('package.json:           2.4.6');
    expect(result.stdout).toContain('ha-app/config.yaml:     2.4.5');
    expect(result.stdout).toContain('bump all three in lockstep');
  });

  test('uses the first addon version field without accepting a later matching value', () => {
    const root = releaseFixture();
    writeFixture(root, 'ha-app/config.yaml', 'version: 2.4.5\nversion: 2.4.6\n');
    const result = runScript(root, 'check-version-sync.sh');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ha-app/config.yaml:     2.4.5');
  });
});
