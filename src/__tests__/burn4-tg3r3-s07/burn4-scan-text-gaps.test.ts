import { cleanupScannerFixtures, createScannerFixture } from './burn4-scanner-fixture';

afterEach(cleanupScannerFixtures);

describe('scan-text known defects with synthetic markers', () => {
  test.failing('KNOWN GAP: denylist diagnostics expose the matched entry despite the value-withheld contract', () => {
    const marker = 'BURN4PRIVATEFIXTURE';
    const result = createScannerFixture({ denylist: `${marker}\n` }).scan({ stdin: `Fictional context ${marker} only.` });
    expect(result.stdout + result.stderr).not.toContain(marker);
  });

  test.failing('KNOWN GAP: the final denylist entry is ignored unless it ends with a newline', () => {
    const result = createScannerFixture({ denylist: 'UNUSEDMARKER\nBURN4FINALFIXTURE' })
      .scan({ stdin: 'BURN4FINALFIXTURE' });
    expect(result.status).toBe(1);
  });

  test.failing('KNOWN GAP: a readable directory is reported clean after input reading fails', () => {
    const fixture = createScannerFixture();
    const result = fixture.scan({ file: fixture.directoryInput() });
    expect(result.status).toBe(2);
  });

  test.failing.each(['cat', 'grep'] as const)('KNOWN GAP: missing required command %s permits a clean result', (missingCommand) => {
    const result = createScannerFixture({ denylist: 'BURN4DEPENDENCYFIXTURE\n', missingCommand })
      .scan({ stdin: 'BURN4DEPENDENCYFIXTURE' });
    expect(result.status).toBe(2);
  });
});
