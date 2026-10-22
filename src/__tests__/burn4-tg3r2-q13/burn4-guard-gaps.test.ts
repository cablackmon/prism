import { runGuard } from './burn4-guard-fixture';

const unquotedCases: [string, string][] = [];
for (const flag of ['title', 'body', 'notes']) {
  for (const separator of [' ', '=']) unquotedCases.push([flag, separator]);
}

const spacedFileCases: [string, string, string][] = [];
for (const flag of ['body-file', 'notes-file']) {
  for (const separator of [' ', '=']) {
    for (const quote of ['"', "'"]) spacedFileCases.push([flag, separator, quote]);
  }
}

describe('confirmed outbound metadata parsing bypasses', () => {
  test.failing.each(unquotedCases)('KNOWN GAP: unquoted --%s with separator %p bypasses a rejecting scanner', (flag, separator) => {
    const action = flag === 'notes' ? 'release create synthetic-tag' : 'pr create';
    const result = runGuard({ command: `gh ${action} --${flag}${separator}SyntheticDeniedText`, scannerExit: 1 });
    expect(result.temporaryFiles).toEqual([]);
    expect(result.proposedCommandExecuted).toBe(false);
    expect(result.status).toBe(2);
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe('SyntheticDeniedText\n');
  });

  test.failing.each(spacedFileCases)('KNOWN GAP: --%s with separator %p and quote %p truncates a path containing spaces and bypasses scanning', (flag, separator, quote) => {
    const result = runGuard({
      files: { 'burn4-metadata with spaces.md': 'SyntheticDeniedText\n' },
      command: ({ file }) => `gh ${flag === 'notes-file' ? 'release create synthetic-tag' : 'pr create'} --${flag}${separator}${quote}${file('burn4-metadata with spaces.md')}${quote}`,
      scannerExit: 1,
    });
    expect(result.temporaryFiles).toEqual([]);
    expect(result.proposedCommandExecuted).toBe(false);
    expect(result.status).toBe(2);
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe('SyntheticDeniedText\n');
  });
});
