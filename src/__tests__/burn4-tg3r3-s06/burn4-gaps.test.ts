import { cleanupFixtures, INVALID_IP, MARKER, scannerFixture, type Scanner } from './burn4-scanner-fixture';

afterEach(cleanupFixtures);

describe.each<Scanner>(['pii', 'secrets'])('%s scanner regression contracts', (scanner) => {
  test.failing('KNOWN GAP: an indexed finding is hidden by a clean unstaged edit', () => {
    const fixture = scannerFixture({ files: { 'burn4-config.txt': scanner === 'pii' ? MARKER : INVALID_IP } });
    fixture.write('burn4-config.txt', 'clean working copy\n');
    expect(fixture.run(scanner).status).toBe(1);
  });

  test.failing('KNOWN GAP: tab-containing Git paths bypass scanning', () => {
    const fixture = scannerFixture({ files: { 'burn4-tab\tfile.txt': scanner === 'pii' ? MARKER : INVALID_IP } });
    expect(fixture.run(scanner).status).toBe(1);
  });

  test.failing('KNOWN GAP: leading-dash Git paths bypass scanning', () => {
    const fixture = scannerFixture({ files: { '-burn4-file.txt': scanner === 'pii' ? MARKER : INVALID_IP } });
    expect(fixture.run(scanner).status).toBe(1);
  });

  test.failing.each(['git', 'grep', 'xargs'])('KNOWN GAP: missing %s dependency reports a clean success', (command) => {
    const fixture = scannerFixture({
      files: { 'burn4-config.txt': scanner === 'pii' ? MARKER : INVALID_IP }, missingCommands: [command],
    });
    expect(fixture.run(scanner).status).not.toBe(0);
  });

  test.failing('KNOWN GAP: running outside a Git repository reports a clean success', () => {
    const fixture = scannerFixture({ initializeGit: false });
    expect(fixture.run(scanner).status).not.toBe(0);
  });

  test.failing('KNOWN GAP: finding diagnostics disclose unrelated text from the matching line', () => {
    const privateMarker = 'burn4-private-context-should-stay-local';
    const fixture = scannerFixture({ files: {
      'burn4-config.txt': `${scanner === 'pii' ? MARKER : INVALID_IP} ${privateMarker}`,
    } });
    expect(fixture.run(scanner).stdout).not.toContain(privateMarker);
  });
});

describe('PII scanner precision regressions', () => {
  test.failing('KNOWN GAP: example-domain prefixes allow an unrelated email domain suffix', () => {
    const fixture = scannerFixture({ files: { 'burn4-email.txt': 'burn4person@example.com.attacker.invalid' } });
    expect(fixture.run('pii').status).toBe(1);
  });

  test.failing('KNOWN GAP: placeholder local-part suffixes allow unrelated email addresses', () => {
    const fixture = scannerFixture({ files: { 'burn4-email.txt': 'burn4notyou@fixture.invalid' } });
    expect(fixture.run('pii').status).toBe(1);
  });

  test.failing('KNOWN GAP: unrelated CIDR text suppresses a private-host match on the same line', () => {
    const fixture = scannerFixture({ files: { 'burn4-network.txt': `${INVALID_IP} network 10.999.0.0/8` } });
    expect(fixture.run('pii').status).toBe(1);
  });
});
