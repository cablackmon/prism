import { readdirSync } from 'node:fs';
import { assertSafeShell, executeShell, extractStep, sourceStep } from './burn4-workflow-harness';

describe('shell source boundary and inert execution safety', () => {
  test('rejects a missing named workflow step', () => {
    expect(() => extractStep('      - name: Other\n        run: npm ci\n', 'Wanted')).toThrow('found 0');
  });

  test('rejects ambiguous duplicate named steps', () => {
    const step = '      - name: Wanted\n        run: npm ci\n';
    expect(() => extractStep(step + step, 'Wanted')).toThrow('found 2');
  });

  test('rejects an action-only step instead of taking the next step run command', () => {
    const text = '      - name: Wanted\n        uses: vendor/action\n      - name: Other\n        run: npm ci\n';
    expect(() => extractStep(text, 'Wanted')).toThrow('No shell run');
  });

  test('extracts a literal inline command without adjacent configuration', () => {
    expect(extractStep('      - name: Wanted\n        run: npm ci\n        unrelated: ignore\n', 'Wanted')).toBe('npm ci\n');
  });

  test('preserves block shell and stops before adjacent step configuration', () => {
    const text = '      - name: Wanted\n        run: |\n          npm ci\n          npm run lint\n        unrelated: ignore\n';
    expect(extractStep(text, 'Wanted')).toBe('npm ci\nnpm run lint\n');
  });

  test.each([
    '/usr/bin/curl http://invalid.local', 'curl http://invalid.local', 'echo "$(npm ci)"',
    'echo "`npm ci`"', 'echo "literal"; npm ci', 'export OTHER=value', 'npm ci > /tmp/global-log',
    'echo "${{ unsafe.expression }}"',
  ])('rejects unreviewed shell before execution: %s', shell => {
    expect(() => executeShell(shell, {})).toThrow('outside reviewed execution boundary');
  });

  test('runs only the screenshot polling slice', () => {
    const shell = sourceStep('screenshots', 'Boot app and capture screenshots');
    expect(shell.startsWith('echo "Waiting for the app to come up..."\n')).toBe(true);
    expect(shell.endsWith('fi\n')).toBe(true);
    expect(shell).not.toContain('npm');
    expect(shell).not.toContain('PRISM_URL');
    expect(shell).not.toContain('> /tmp/dev.log');
  });

  test('allows the reviewed commands and inert comments', () => {
    expect(() => assertSafeShell('# comment\n\nnpm ci\n')).not.toThrow();
  });

  test('rejects an unplanned command call and removes the fixture directory', () => {
    const before = readdirSync(__dirname).filter(name => name.startsWith('burn4-runtime-'));
    expect(() => executeShell('npm ci\n', {})).toThrow('Unplanned inert command');
    expect(readdirSync(__dirname).filter(name => name.startsWith('burn4-runtime-'))).toEqual(before);
  });

  test('rejects an argument mismatch from an inert command', () => {
    expect(() => executeShell('npm ci\n', { npm: [{ args: ['run', 'build'] }] })).toThrow('Unexpected arguments');
  });

  test('rejects extra planned-command calls even if their diagnostics are redirected', () => {
    const shell = sourceStep('screenshots', 'Boot app and capture screenshots');
    expect(() => executeShell(shell, { curl: [{}], tail: [{}] })).toThrow('Unplanned inert command call: curl');
  });
});
