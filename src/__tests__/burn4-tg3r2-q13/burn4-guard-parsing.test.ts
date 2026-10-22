import { runGuard } from './burn4-guard-fixture';

type GuardResult = ReturnType<typeof runGuard>;

function cleanFixture(result: GuardResult): void {
  expect(result.temporaryFiles).toEqual([]);
  expect(result.proposedCommandExecuted).toBe(false);
}

function allowed(result: GuardResult): void {
  cleanFixture(result);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
}

describe('offline outbound command metadata guard', () => {
  test.each([
    ['empty input', ''],
    ['invalid JSON', '{broken'],
    ['null JSON', 'null'],
    ['missing tool input', '{}'],
    ['missing command', '{"tool_input":{}}'],
    ['null tool input', '{"tool_input":null}'],
  ])('%s produces no publishing text or scanner call', (_name, rawInput) => {
    const result = runGuard({ rawInput, scannerExit: 1 });
    allowed(result);
    expect(result.scannerCalls).toBe(0);
    expect(result.scanned).toBeUndefined();
  });

  test.each([
    'printf "synthetic local text"',
    'gh pr view 42',
    'gh issue list --label synthetic',
    'gh release view synthetic-tag',
    'gh repo view --json name',
    'git log --format="synthetic"',
  ])('nonpublishing command metadata is ignored: %s', (command) => {
    const result = runGuard({ command, scannerExit: 1 });
    allowed(result);
    expect(result.scannerCalls).toBe(0);
  });

  const inlineCases: [string, string, string][] = [];
  for (const flag of ['title', 'body', 'notes']) {
    for (const separator of [' ', '=']) {
      for (const quote of ['"', "'"]) inlineCases.push([flag, separator, quote]);
    }
  }
  test.each(inlineCases)('extracts --%s with separator %p and quote %p', (flag, separator, quote) => {
    const text = 'Synthetic quoted metadata';
    const action = flag === 'notes' ? 'gh release create synthetic-tag' : 'gh pr create';
    const result = runGuard({ command: `${action} --${flag}${separator}${quote}${text}${quote}` });
    allowed(result);
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe(`${text}\n`);
  });

  test('collects multiple multiline fields in command order in a single scan', () => {
    const result = runGuard({
      command: 'gh pr create --title "Synthetic title" --body="Synthetic first line\nSynthetic second line" --title \'Synthetic last title\'',
    });
    allowed(result);
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe('Synthetic title\nSynthetic first line\nSynthetic second line\nSynthetic last title\n');
  });

  test('opposite quote characters remain part of quoted text', () => {
    const result = runGuard({ command: 'gh pr create --title "Synthetic \'single quotes\'" --body \'Synthetic "double quotes"\'' });
    allowed(result);
    expect(result.scanned).toBe('Synthetic \'single quotes\'\nSynthetic "double quotes"\n');
  });

  test('shell substitutions and command separators stay inert in proposed stdin text', () => {
    const result = runGuard({
      command: ({ executionMarker }) => `gh pr create --title 'Synthetic $(/usr/bin/touch ${executionMarker})' ; /usr/bin/touch ${executionMarker}`,
    });
    allowed(result);
    expect(result.scanned).toMatch(/^Synthetic \$\(\/usr\/bin\/touch \/tmp\/burn4-tg3r2-q13-[^/]+\/burn4-proposed-command-executed\.txt\)\n$/);
    expect(result.scannerCalls).toBe(1);
  });

  test('a quoted empty body is scanned as an empty line', () => {
    const result = runGuard({ command: 'gh pr create --body ""' });
    allowed(result);
    expect(result.scanned).toBe('\n');
    expect(result.scannerCalls).toBe(1);
  });

  test.each([
    'gh pr edit 42 --body "Synthetic edit"',
    'gh issue create --body "Synthetic edit"',
    'gh issue comment 42 --body "Synthetic edit"',
    'gh release edit synthetic-tag --notes "Synthetic edit"',
  ])('scans supported publishing metadata: %s', (command) => {
    const result = runGuard({ command });
    allowed(result);
    expect(result.scanned).toBe('Synthetic edit\n');
    expect(result.scannerCalls).toBe(1);
  });

  test.each(['addDiscussionComment', 'createIssue', 'updateIssue'])('extracts inline GraphQL body for %s', (mutation) => {
    const result = runGuard({ command: `gh api graphql -f query="mutation { ${mutation}(input: {body: 'Synthetic GraphQL body'}) { id } }"` });
    allowed(result);
    expect(result.scanned).toBe('Synthetic GraphQL body\n');
    expect(result.scannerCalls).toBe(1);
  });

  test.each([1, 7])('scanner rejection or error exit %i becomes a blocking guard decision', (scannerExit) => {
    const result = runGuard({
      command: 'gh pr create --body "Synthetic denied text"',
      scannerExit,
      scannerStdout: 'Synthetic scanner stdout',
      scannerStderr: 'Synthetic scanner diagnostic',
    });
    cleanFixture(result);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('BLOCKED:');
    expect(result.stderr).toContain('Synthetic scanner stdoutSynthetic scanner diagnostic');
    expect(result.scanned).toBe('Synthetic denied text\n');
    expect(result.scannerCalls).toBe(1);
  });

  test('successful scanner output is captured without being printed by the guard', () => {
    const result = runGuard({ command: 'gh pr create --title "Synthetic allowed text"', scannerStdout: 'Synthetic internal diagnostic' });
    allowed(result);
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe('Synthetic allowed text\n');
  });

  test.each([
    'Generated with Claude Code',
    'generated with [Claude Code]',
    'Co-Authored-By: Claude Synthetic',
    '🤖 generated synthetic attribution',
  ])('blocks harmless attribution fixture before scanner execution: %s', (text) => {
    const result = runGuard({ command: `gh pr create --body "${text}"` });
    cleanFixture(result);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('BLOCKED: this text contains AI attribution.');
    expect(result.stdout).toBe('');
    expect(result.scannerCalls).toBe(0);
  });

  test('ordinary fictional author text reaches the scanner', () => {
    const result = runGuard({ command: 'gh pr create --body "Synthetic author note"' });
    allowed(result);
    expect(result.scannerCalls).toBe(1);
    expect(result.scanned).toBe('Synthetic author note\n');
  });
});
