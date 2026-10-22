import { cleanupScannerFixtures, createScannerFixture } from './burn4-scanner-fixture';

afterEach(cleanupScannerFixtures);

describe('scan-text input and denylist contracts', () => {
  test.each(['', 'A fictional project update with no matched values.'])('accepts clean stdin %j', (stdin) => {
    const result = createScannerFixture().scan({ stdin });
    expect(result).toEqual({ status: 0, stdout: '[scan-text] Clean: safe to publish.\n', stderr: '' });
  });

  test('reads a file whose path contains spaces', () => {
    const fixture = createScannerFixture({ denylist: 'SYNTHETICMARKER\n' });
    const file = fixture.writeInput('SYNTHETICMARKER\n', 'burn4-message with spaces.txt');
    const result = fixture.scan({ file });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('DENYLIST MATCH: entry #1 (value withheld)');
    expect(result.stderr).toContain('Do NOT publish.');
    expect(result.stdout).not.toContain('Clean:');
  });

  test('scans the named file instead of piped stdin', () => {
    const fixture = createScannerFixture({ denylist: 'SYNTHETICMARKER\n' });
    const file = fixture.writeInput('A fictional update.');
    expect(fixture.scan({ file, stdin: 'SYNTHETICMARKER' }).status).toBe(0);
  });

  test('reports a missing file on stderr with usage-error status', () => {
    const fixture = createScannerFixture();
    const file = fixture.missingInput();
    const result = fixture.scan({ file });
    expect(result).toEqual({ status: 2, stdout: '', stderr: `[scan-text] cannot read: ${file}\n` });
  });

  test('warns and still runs built-in checks when the explicit fixture denylist is missing', () => {
    const fixture = createScannerFixture({ denylist: null });
    const result = fixture.scan({ stdin: '10.22.33.44' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`WARNING: no denylist at ${fixture.denylist}`);
    expect(result.stderr).toContain('layer 1 skipped');
    expect(result.stdout).toContain('private IP:');
  });

  test('makes the missing-denylist warning visible even for clean input', () => {
    const fixture = createScannerFixture({ denylist: null });
    const result = fixture.scan({ stdin: 'A fictional update.' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('WARNING: no denylist');
    expect(result.stdout).toContain('Clean: safe to publish.');
  });

  test.each([
    ['SYNTHETICMARKER', 'syntheticmarker'],
    ['SYNTHETICMARKER', '(SYNTHETICMARKER).'],
    ['424242', 'marker 424242;'],
    ['fixture.invalid', 'prefixfixture.invalidsuffix'],
    ['fictional marker', 'FICTIONAL MARKER appears here'],
    ['fixture[marker]', 'fixture[marker]'],
    ['--fixture', 'a --fixture marker'],
    ['fixture\\marker', 'a fixture\\marker value'],
  ])('matches a literal synthetic entry %j in %j', (entry, stdin) => {
    const result = createScannerFixture({ denylist: `${entry}\n` }).scan({ stdin });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('DENYLIST MATCH: entry #1 (value withheld)');
    expect(result.stderr).toContain('Do NOT publish.');
  });

  test.each([
    ['SYNTHETICMARKER', 'presyntheticmarker'],
    ['SYNTHETICMARKER', 'syntheticmarkers'],
    ['SYNTHETICMARKER', '_SYNTHETICMARKER_'],
    ['fixture.invalid', 'fixtureXinvalid'],
    ['fixture[marker]', 'fixturem'],
  ])('avoids a false match for synthetic entry %j in %j', (entry, stdin) => {
    expect(createScannerFixture({ denylist: `${entry}\n` }).scan({ stdin }).status).toBe(0);
  });

  test('ignores empty and comment lines when assigning diagnostic positions', () => {
    const result = createScannerFixture({ denylist: '# burn4 synthetic list\n\nUNUSEDMARKER\n# another comment\nSYNTHETICMARKER\n' })
      .scan({ stdin: 'SYNTHETICMARKER' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('entry #2 (value withheld)');
    expect(result.stdout).not.toContain('entry #1');
  });

  test('reports multiple matching entries independently with source line numbers', () => {
    const result = createScannerFixture({ denylist: 'FIRSTFIXTURE\nSECONDFIXTURE\n' })
      .scan({ stdin: 'intro\nFIRSTFIXTURE and SECONDFIXTURE\n\nSECONDFIXTURE\n' });
    expect(result.status).toBe(1);
    expect(result.stdout.match(/DENYLIST MATCH:/g)).toHaveLength(2);
    expect(result.stdout).toContain('line 2:');
    expect(result.stdout).toContain('line 4:');
  });

  test('caps each denylist diagnostic at three matching input lines', () => {
    const result = createScannerFixture({ denylist: 'SYNTHETICMARKER\n' })
      .scan({ stdin: Array.from({ length: 5 }, (_, index) => `SYNTHETICMARKER fixture ${index + 1}`).join('\n') });
    expect(result.status).toBe(1);
    expect(result.stdout.match(/    line /g)).toHaveLength(3);
    expect(result.stdout).toContain('line 3:');
    expect(result.stdout).not.toContain('line 4:');
  });
});
