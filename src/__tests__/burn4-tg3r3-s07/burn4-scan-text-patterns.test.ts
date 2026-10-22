import { cleanupScannerFixtures, createScannerFixture } from './burn4-scanner-fixture';

afterEach(cleanupScannerFixtures);

describe('scan-text built-in patterns and exemptions', () => {
  test.each([
    ['private IP', '10.22.33.44'],
    ['private IP', '192.168.22.33'],
    ['private IP', '172.16.22.33'],
    ['private IP', '172.31.22.33'],
    ['private IP', '100.64.22.33'],
    ['private IP', '100.127.22.33'],
    ['email address', 'burn4-fixture@scanner.invalid'],
    ['US postal code', 'ZZ 00000'],
    ['US postal code', 'ZZ, 00000-0000'],
    ['GPS coordinates', '0.1234, 0.5678'],
    ['GPS coordinates', '-0.12345, -0.56789'],
  ])('rejects synthetic %s shape %j', (label, stdin) => {
    const result = createScannerFixture().scan({ stdin });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`[scan-text] ${label}:`);
    expect(result.stdout).toContain('1:');
    expect(result.stderr).toContain('Do NOT publish.');
  });

  test.each([
    '192.0.2.10',
    '172.15.22.33',
    '172.32.22.33',
    '100.63.22.33',
    '100.128.22.33',
    'Coordinates have only 0.123, 0.567 precision.',
    'ZZ 0000',
  ])('does not flag synthetic text outside protected pattern ranges %j', (stdin) => {
    const result = createScannerFixture().scan({ stdin });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  test.each([
    'burn4-fixture@example.com',
    'burn4-fixture@example.org',
    'burn4-fixture@example.net',
    'BURN4-FIXTURE@EXAMPLE.COM',
    'burn4-fixture@users.noreply.github.com',
    'burn4-fixture@synthetic.users.noreply.github.com',
  ])('exempts a documented example or GitHub noreply address %j', (stdin) => {
    expect(createScannerFixture().scan({ stdin }).status).toBe(0);
  });

  test('retains email rejection when an exempt example appears on an earlier line', () => {
    const result = createScannerFixture().scan({ stdin: 'burn4-fixture@example.com\nburn4-fixture@scanner.invalid' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[scan-text] email address:');
    expect(result.stdout).toContain('2:');
  });

  test('reports every matching built-in category with original line numbers', () => {
    const result = createScannerFixture().scan({ stdin: 'intro\n10.22.33.44\nburn4-fixture@scanner.invalid\nZZ 00000\n0.1234, 0.5678' });
    expect(result.status).toBe(1);
    for (const label of ['private IP', 'email address', 'US postal code', 'GPS coordinates']) {
      expect(result.stdout).toContain(`[scan-text] ${label}:`);
    }
    for (const line of [2, 3, 4, 5]) expect(result.stdout).toContain(`    ${line}:`);
  });

  test('caps each built-in category at three matching input lines', () => {
    const result = createScannerFixture().scan({ stdin: Array.from({ length: 5 }, () => '10.22.33.44').join('\n') });
    expect(result.status).toBe(1);
    expect(result.stdout.match(/    [0-9]+:/g)).toHaveLength(3);
    expect(result.stdout).not.toContain('    4:');
  });
});
