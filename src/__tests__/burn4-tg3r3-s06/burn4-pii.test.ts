import { cleanupFixtures, EMAIL, INVALID_IP, MARKER, scannerFixture } from './burn4-scanner-fixture';

afterEach(cleanupFixtures);

describe('repository PII scanner in synthetic repositories', () => {
  test('empty repository is clean with an explicit synthetic denylist', () => {
    const result = scannerFixture().run('pii');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Clean: no built-in-rule or denylist matches.');
    expect(result.stderr).toBe('');
  });

  test('untracked marker files are outside the scan', () => {
    expect(scannerFixture({ files: { 'burn4-untracked.md': MARKER }, tracked: [] }).run('pii').status).toBe(0);
  });

  test('a staged file with spaces is scanned and reports its line', () => {
    const result = scannerFixture({ files: { 'burn4 spaced file.md': `clean\n${MARKER}\n` } }).run('pii');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('burn4 spaced file.md:2:');
    expect(result.stdout).toContain('DENYLIST MATCHES');
  });

  test('working-tree changes to tracked files are inspected', () => {
    const fixture = scannerFixture({ files: { 'burn4-tracked.md': 'clean' } });
    fixture.write('burn4-tracked.md', MARKER);
    expect(fixture.run('pii').status).toBe(1);
  });

  test('gitignore cannot hide a file already added to the index', () => {
    const fixture = scannerFixture({ files: { 'burn4-tracked.md': MARKER } });
    fixture.write('burn4-ignore.txt', 'burn4-tracked.md\n');
    fixture.git('config', 'core.excludesFile', `${fixture.repo}/burn4-ignore.txt`);
    expect(fixture.run('pii').status).toBe(1);
  });

  test.each([
    'scripts/scan-pii.sh', 'scripts/scan-examples.sh', 'scripts/scan-hostnames.sh',
    'scripts/scan-secrets.sh', 'scripts/prism-pii-denylist.example.txt',
    'docs/code-review-modalities.md', 'package-lock.json', 'burn4-dependencies.lock',
  ])('intentional repository exclusion: %s', (path) => {
    expect(scannerFixture({ files: { [path]: `${MARKER} ${EMAIL}` } }).run('pii').status).toBe(0);
  });

  test('snapshot files remain eligible for the PII scanner', () => {
    expect(scannerFixture({ files: { 'burn4-output.snap': MARKER } }).run('pii').status).toBe(1);
  });

  test('denylist trims CRLF, blanks and comment entries and matches case independently', () => {
    const result = scannerFixture({
      denylist: `  # burn4ignored\r\n\r\n  ${MARKER.toUpperCase()}  \r\n`,
      files: { 'burn4-text.md': `burn4ignored\n${MARKER}\n` },
    }).run('pii');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('burn4-text.md:2:');
    expect(result.stdout).not.toContain('burn4-text.md:1:');
  });

  test('denylist entries are literal strings and require whole words', () => {
    const fixture = scannerFixture({
      denylist: 'burn4.literal\n', files: { 'burn4-text.md': 'burn4Xliteral\npreburn4.literalpost\n' },
    });
    expect(fixture.run('pii').status).toBe(0);
    fixture.write('burn4-text.md', 'burn4.literal\n');
    expect(fixture.run('pii').status).toBe(1);
  });

  test('empty or comment-only denylist still runs built-in email rules', () => {
    const result = scannerFixture({ denylist: '# burn4 comment\n\n', files: { 'burn4-email.md': EMAIL } }).run('pii');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('BUILT-IN RULE MATCHES');
    expect(result.stdout).not.toContain('DENYLIST MATCHES');
  });

  test('missing explicit denylist warns while built-in rules still reject findings', () => {
    const result = scannerFixture({ missingDenylist: true, files: { 'burn4-email.md': EMAIL } }).run('pii');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('maintainer denylist not found');
  });

  test('missing explicit denylist allows clean built-in-only results', () => {
    const result = scannerFixture({ missingDenylist: true, files: { 'burn4-clean.md': 'clean fixture text' } }).run('pii');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Clean (built-in rules): no matches.');
  });

  test('documented example and placeholder email addresses are allowed', () => {
    expect(scannerFixture({ files: { 'burn4-email.md': 'burn4@example.com\nyou@fixture.invalid\n' } }).run('pii').status).toBe(0);
  });

  test('built-in email scan also checks test source files', () => {
    expect(scannerFixture({ files: { 'src/__tests__/burn4-example.test.ts': EMAIL } }).run('pii').status).toBe(1);
  });

  test.each([
    'src/__tests__/burn4-ip.ts', 'burn4-ip.test.ts', 'burn4-ip.spec.ts', 'e2e/burn4-ip.ts',
    'src/app/api/recipes/import-url/route.ts', 'src/lib/integrations/caldav.ts',
    'src/lib/integrations/carddav.ts', 'src/lib/integrations/immich.ts',
    'src/lib/utils/safeFetch.ts', 'docs/audit-burn4.md',
  ])('private-IP examples are allowed in documented IP exemption %s', (path) => {
    expect(scannerFixture({ files: { [path]: INVALID_IP } }).run('pii').status).toBe(0);
  });

  test('IP exemptions do not suppress the synthetic denylist layer', () => {
    expect(scannerFixture({ files: { 'src/__tests__/burn4-ip.ts': MARKER } }).run('pii').status).toBe(1);
  });

  test('built-in private-IP patterns reject impossible-octet fixture markers outside exemptions', () => {
    expect(scannerFixture({ files: { 'burn4-config.yml': INVALID_IP } }).run('pii').status).toBe(1);
  });

  test('denylist layer ignores binary files', () => {
    expect(scannerFixture({ files: { 'burn4-binary.bin': `\u0000${MARKER}` } }).run('pii').status).toBe(0);
  });

  test('both layers aggregate findings instead of stopping at the first layer', () => {
    const result = scannerFixture({ files: { 'burn4-values.txt': `${EMAIL}\n${MARKER}\n` } }).run('pii');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('BUILT-IN RULE MATCHES');
    expect(result.stdout).toContain('DENYLIST MATCHES');
    expect(result.stdout).not.toContain('Clean:');
  });
});
