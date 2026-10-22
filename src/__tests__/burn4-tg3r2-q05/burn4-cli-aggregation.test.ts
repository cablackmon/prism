import { entry, fixtureFiles, layout, runCommand } from './burn4-cli-harness';

const success = { valid: true, errors: [], warnings: [] };

describe('community layout command validation and aggregation', () => {
  test('all validator errors and warnings are printed before a failing summary', () => {
    const result = runCommand(fixtureFiles(), () => ({
      valid: false,
      errors: ['First schema defect', 'Second schema defect'],
      warnings: ['First advisory', 'Second advisory'],
    }));
    expect(result.errors).toEqual([
      '  ERROR: First schema defect', '  ERROR: Second schema defect',
      '\nValidation FAILED. See errors above.',
    ]);
    expect(result.warnings).toEqual(['  WARN: First advisory', '  WARN: Second advisory']);
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
    expect(result.logs).not.toContain('\nAll 1 layouts valid.');
  });

  test('validator warnings alone preserve the successful exit and summary', () => {
    const result = runCommand(fixtureFiles(), () => ({ ...success, warnings: ['Sample advisory'] }));
    expect(result.warnings).toEqual(['  WARN: Sample advisory']);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.uncaught).toBeUndefined();
    expect(result.logs).toContain('\nAll 1 layouts valid.');
  });

  test.each([
    [{ mode: 'screensaver' }, 'Mode mismatch: index says "dashboard", file says "screensaver"'],
    [{ name: 'Different layout' }, 'Name mismatch: index says "Sample dashboard", file says "Different layout"'],
    [{ widgets: [] }, 'Widget count mismatch: index says 1, file has 0'],
  ])('index inconsistency %p fails even when the shared validator succeeds', (changes, message) => {
    const result = runCommand({
      ...fixtureFiles(), 'sample-dashboard.json': JSON.stringify(layout(changes)),
    });
    expect(result.errors).toEqual([`  ERROR: ${message}`, '\nValidation FAILED. See errors above.']);
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
  });

  test('schema and index defects aggregate across layouts without suppressing advisories', () => {
    const first = layout({ name: 'Wrong name', mode: 'screensaver', widgets: [] });
    const second = layout({ name: 'Second layout' });
    const files = fixtureFiles([
      entry(), entry({ id: 'second', file: 'second.json', name: 'Second layout' }),
    ]);
    files['sample-dashboard.json'] = JSON.stringify(first);
    files['second.json'] = JSON.stringify(second);
    const result = runCommand(files, (data) => data && typeof data === 'object' && 'name' in data && data.name === 'Wrong name'
      ? { valid: false, errors: ['Unsupported widget'], warnings: ['Layout advisory'] }
      : success);
    expect(result.validated).toEqual([first, second]);
    expect(result.errors).toEqual([
      '  ERROR: Unsupported widget',
      '  ERROR: Mode mismatch: index says "dashboard", file says "screensaver"',
      '  ERROR: Name mismatch: index says "Sample dashboard", file says "Wrong name"',
      '  ERROR: Widget count mismatch: index says 1, file has 0',
      '\nValidation FAILED. See errors above.',
    ]);
    expect(result.warnings).toEqual(['  WARN: Layout advisory']);
    expect(result.logs).toContain('[second] Second layout (dashboard)');
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
  });

  test('absent widgets remain a validator error without inventing a widget count mismatch', () => {
    const result = runCommand({
      ...fixtureFiles(),
      'sample-dashboard.json': JSON.stringify({ name: 'Sample dashboard', mode: 'dashboard' }),
    }, () => ({ valid: false, errors: ['Missing widgets array'], warnings: [] }));
    expect(result.errors).toEqual([
      '  ERROR: Missing widgets array', '\nValidation FAILED. See errors above.',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
  });

  test('zero widgets match a zero widgetCount', () => {
    const result = runCommand({
      ...fixtureFiles([entry({ widgetCount: 0 })]),
      'sample-dashboard.json': JSON.stringify(layout({ widgets: [] })),
    });
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.uncaught).toBeUndefined();
  });

  test('duplicate IDs are checked even when each referenced file is missing', () => {
    const result = runCommand({
      'index.json': JSON.stringify({ layouts: [
        entry({ file: 'absent-a.json' }), entry({ file: 'absent-b.json' }),
      ] }),
    });
    expect(result.errors).toEqual([
      '  ERROR: File not found: absent-a.json',
      '  ERROR: File not found: absent-b.json',
      '  ERROR: Duplicate IDs in index: sample-dashboard',
      '\nValidation FAILED. See errors above.',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
    expect(result.validated).toEqual([]);
  });

  test('multiple repeated IDs are reported after all layout validations', () => {
    const ids = ['sample-dashboard', 'second', 'sample-dashboard', 'second'];
    const result = runCommand(fixtureFiles(ids.map(id => entry({ id }))));
    expect(result.validated).toHaveLength(4);
    expect(result.errors).toEqual([
      '  ERROR: Duplicate IDs in index: sample-dashboard, second',
      '\nValidation FAILED. See errors above.',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
  });

  test('distinct IDs can reference the same valid file without a duplicate-ID error', () => {
    const result = runCommand(fixtureFiles([entry(), entry({ id: 'alternate' })]));
    expect(result.validated).toEqual([layout(), layout()]);
    expect(result.errors).toEqual([]);
    expect(result.logs).toContain('\nAll 2 layouts valid.');
    expect(result.exitCode).toBe(0);
    expect(result.uncaught).toBeUndefined();
  });

  test.failing('KNOWN GAP: null layout reported by shared validator then crashes consistency checks and aborts aggregation', () => {
    const files = fixtureFiles([entry({ id: 'null-layout', file: 'null.json' }), entry()]);
    files['null.json'] = 'null';
    const result = runCommand(files, data => data === null
      ? { valid: false, errors: ['Layout must be an object'], warnings: [] }
      : success);
    expect(result.errors).toContain('  ERROR: Layout must be an object');
    expect(result.uncaught).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(result.validated).toEqual([null, layout()]);
    expect(result.errors.at(-1)).toBe('\nValidation FAILED. See errors above.');
  });
});
