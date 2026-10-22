import { runGuard } from './burn4-guard-fixture';

describe('offline outbound guard file metadata', () => {
  const fileCases: [string, string, string][] = [];
  for (const flag of ['body-file', 'notes-file']) {
    for (const separator of [' ', '=']) {
      for (const quote of ['', '"', "'"]) fileCases.push([flag, separator, quote]);
    }
  }
  test.each(fileCases)('reads --%s with separator %p and quote %p', (flag, separator, quote) => {
    const result = runGuard({
      files: { 'burn4-metadata.md': 'Synthetic file metadata\n' },
      command: ({ file }) => `gh ${flag === 'notes-file' ? 'release create synthetic-tag' : 'pr create'} --${flag}${separator}${quote}${file('burn4-metadata.md')}${quote}`,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe('Synthetic file metadata\n');
    expect(result.temporaryFiles).toEqual([]);
    expect(result.proposedCommandExecuted).toBe(false);
  });

  test('concatenates inline text before body-file and notes-file contents', () => {
    const result = runGuard({
      files: { 'burn4-body.md': 'Synthetic body file\n', 'burn4-notes.md': 'Synthetic notes file\n' },
      command: 'gh release create synthetic-tag --notes-file burn4-notes.md --title "Synthetic inline" --body-file burn4-body.md',
    });
    expect(result.status).toBe(0);
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe('Synthetic inline\nSynthetic notes file\nSynthetic body file\n');
    expect(result.temporaryFiles).toEqual([]);
  });

  test('a missing referenced file contributes no text or scanner invocation', () => {
    const result = runGuard({ command: 'gh pr create --body-file burn4-missing.md', scannerExit: 1 });
    expect(result.status).toBe(0);
    expect(result.scannerCalls).toBe(0);
    expect(result.scanned).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.temporaryFiles).toEqual([]);
  });

  test('an empty referenced file contributes no text or scanner invocation', () => {
    const result = runGuard({ files: { 'burn4-empty.md': '' }, command: 'gh pr create --body-file burn4-empty.md' });
    expect(result.status).toBe(0);
    expect(result.scannerCalls).toBe(0);
    expect(result.temporaryFiles).toEqual([]);
  });

  test('extracts a markdown reference from process-substitution text without running awk', () => {
    const result = runGuard({
      files: { 'burn4-notes.md': 'Synthetic process reference\n' },
      command: "gh release create synthetic-tag --notes-file <(awk '1' burn4-notes.md)",
    });
    expect(result.status).toBe(0);
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe('Synthetic process reference\n');
    expect(result.stderr).toBe('');
    expect(result.temporaryFiles).toEqual([]);
    expect(result.proposedCommandExecuted).toBe(false);
  });

  test('file metadata rejected by the fake scanner blocks the guard and removes its temp file', () => {
    const result = runGuard({
      files: { 'burn4-denied.md': 'Synthetic denied file\n' },
      command: 'gh pr create --body-file burn4-denied.md',
      scannerExit: 1,
      scannerStderr: 'Synthetic file rejection',
    });
    expect(result.status).toBe(2);
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe('Synthetic denied file\n');
    expect(result.stderr).toContain('Synthetic file rejection');
    expect(result.temporaryFiles).toEqual([]);
  });
});
