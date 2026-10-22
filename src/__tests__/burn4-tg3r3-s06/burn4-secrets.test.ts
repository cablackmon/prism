import { cleanupFixtures, INVALID_IP, scannerFixture } from './burn4-scanner-fixture';

afterEach(cleanupFixtures);

describe('repository secret scanner with unusable synthetic markers', () => {
  test('empty index reports no targets', () => {
    const result = scannerFixture().run('secrets');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No files to scan.');
    expect(result.stderr).toBe('');
  });

  test('untracked markers are outside the scan', () => {
    expect(scannerFixture({ files: { 'burn4-untracked.yml': INVALID_IP }, tracked: [] }).run('secrets').status).toBe(0);
  });

  test('staged files with spaces are checked and findings include rule, line and accurate count', () => {
    const result = scannerFixture({ files: { 'burn4 spaced config.yml': `clean\n${INVALID_IP}\n${INVALID_IP}\n` } }).run('secrets');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[private-lan-ipv4] burn4 spaced config.yml:2:');
    expect(result.stdout).toContain('[private-lan-ipv4] burn4 spaced config.yml:3:');
    expect(result.stdout).toContain('FAIL: 2 match(es).');
  });

  test('multiple markers on one line count as one matching line', () => {
    const result = scannerFixture({ files: { 'burn4-config.yml': `${INVALID_IP} ${INVALID_IP}` } }).run('secrets');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL: 1 match(es).');
  });

  test('working-tree changes to tracked files are checked', () => {
    const fixture = scannerFixture({ files: { 'burn4-config.yml': 'clean' } });
    fixture.write('burn4-config.yml', INVALID_IP);
    expect(fixture.run('secrets').status).toBe(1);
  });

  test.each([
    'scripts/scan-pii.sh', 'scripts/scan-examples.sh', 'scripts/scan-hostnames.sh',
    'scripts/scan-secrets.sh', 'scripts/prism-pii-denylist.example.txt',
    'docs/code-review-modalities.md', 'package-lock.json', 'burn4-dependencies.lock', 'burn4-output.snap',
  ])('intentional repository exclusion: %s', (path) => {
    expect(scannerFixture({ files: { [path]: INVALID_IP } }).run('secrets').status).toBe(0);
  });

  test.each(['src/burn4-config.ts', 'src/__tests__/burn4-config.test.ts'])('private IP scope excludes %s', (path) => {
    expect(scannerFixture({ files: { [path]: INVALID_IP } }).run('secrets').status).toBe(0);
  });

  test('source-like path outside src remains eligible', () => {
    expect(scannerFixture({ files: { 'src-copy/burn4-config.ts': INVALID_IP } }).run('secrets').status).toBe(1);
  });

  test('binary files are ignored', () => {
    expect(scannerFixture({ files: { 'burn4-binary.bin': `\u0000${INVALID_IP}` } }).run('secrets').status).toBe(0);
  });

  test('placeholder documentation remains clean without creating credential-shaped fixtures', () => {
    const result = scannerFixture({ files: {
      'burn4-example.txt': '192.168.x.x\n10.x.x.x\n172.16.x.x\nhttps://hc-ping.com/your-own-uuid-here\nREDACTED\n',
    } }).run('secrets');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Clean: no secret-shaped values in tracked files.');
  });

  test('same basename as a scanner outside the exact scripts exclusion is scanned', () => {
    expect(scannerFixture({ files: { 'burn4-copy/scan-secrets.sh': INVALID_IP } }).run('secrets').status).toBe(1);
  });
});
