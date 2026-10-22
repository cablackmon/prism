import { join } from 'node:path';
import {
  communityDirectory,
  entry,
  fixtureFiles,
  indexPath,
  layout,
  runCommand,
} from './burn4-cli-harness';

const valid = { valid: true, errors: [], warnings: [] };

describe('community layout command input and process contract', () => {
  test('missing index reports the resolved path, exits once, and performs no reads', () => {
    const result = runCommand({});
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
    expect(result.errors).toEqual([`Index file not found: ${indexPath}`]);
    expect(result.checkedPaths).toEqual([indexPath]);
    expect(result.reads).toEqual([]);
    expect(result.validated).toEqual([]);
  });

  test.each(['{', '', 'not JSON'])('invalid index JSON %p stops before layout access', (raw) => {
    const result = runCommand({ 'index.json': raw });
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
    expect(result.errors).toEqual(['Invalid JSON in index.json']);
    expect(result.reads).toEqual([{ filename: indexPath, encoding: 'utf-8' }]);
    expect(result.validated).toEqual([]);
  });

  test.each([{}, { layouts: null }, { layouts: {} }, { layouts: 'array' }, []])(
    'index without a layouts array is rejected: %p', (index) => {
      const result = runCommand({ 'index.json': JSON.stringify(index) });
      expect(result.exitCode).toBe(1);
      expect(result.uncaught).toBeUndefined();
      expect(result.errors).toEqual(['index.json missing "layouts" array']);
      expect(result.validated).toEqual([]);
    },
  );

  test('empty catalog exits successfully without invoking the layout validator', () => {
    const result = runCommand(fixtureFiles([]));
    expect(result.exitCode).toBe(0);
    expect(result.uncaught).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.logs).toContain('Found 0 layouts in index.\n');
    expect(result.logs).toContain('\nAll 0 layouts valid.');
    expect(result.checkedPaths).toEqual([indexPath]);
    expect(result.validated).toEqual([]);
  });

  test('valid JSON is passed unchanged to the fake validator through allowlisted dependencies', () => {
    const payload = layout({ extra: { nested: ['sample'] } });
    const files = { ...fixtureFiles(), 'sample-dashboard.json': JSON.stringify(payload) };
    const result = runCommand(files, () => valid);
    expect(result.validated).toEqual([payload]);
    expect(result.dependencies).toEqual(['fs', 'path', '../src/lib/community/validateLayout']);
    expect(result.reads).toEqual([
      { filename: indexPath, encoding: 'utf-8' },
      { filename: join(communityDirectory, 'sample-dashboard.json'), encoding: 'utf-8' },
    ]);
    expect(result.logs).toContain('[sample-dashboard] Sample dashboard (dashboard)');
    expect(result.logs).toContain('\nAll 1 layouts valid.');
    expect(result.exitCode).toBe(0);
    expect(result.uncaught).toBeUndefined();
  });

  test('missing layout is reported and later layouts still reach the validator', () => {
    const result = runCommand(fixtureFiles([
      entry({ id: 'missing', file: 'absent.json' }), entry(),
    ]));
    expect(result.errors).toEqual([
      '  ERROR: File not found: absent.json', '\nValidation FAILED. See errors above.',
    ]);
    expect(result.validated).toEqual([layout()]);
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
  });

  test.each([
    ['malformed JSON', '{'],
    ['read failure', new Error('Memory read failed')],
  ])('%s in one layout does not abort validation of the next', (_label, contents) => {
    const files = fixtureFiles([entry({ id: 'broken', file: 'broken.json' }), entry()]);
    files['broken.json'] = contents;
    const result = runCommand(files);
    expect(result.errors).toEqual([
      '  ERROR: Invalid JSON in broken.json', '\nValidation FAILED. See errors above.',
    ]);
    expect(result.validated).toEqual([layout()]);
    expect(result.exitCode).toBe(1);
    expect(result.uncaught).toBeUndefined();
  });

  test('new invocations do not inherit a previous invocation error flag', () => {
    expect(runCommand(fixtureFiles([entry({ file: 'absent.json' })])).exitCode).toBe(1);
    const next = runCommand(fixtureFiles());
    expect(next.exitCode).toBe(0);
    expect(next.errors).toEqual([]);
    expect(next.uncaught).toBeUndefined();
  });

  test.failing('KNOWN GAP: JSON null index crashes instead of exiting through the validation error path', () => {
    const result = runCommand({ 'index.json': 'null' });
    expect(result.uncaught).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual(['index.json missing "layouts" array']);
  });

  test.failing('KNOWN GAP: unreadable index escapes the CLI error and exit contract', () => {
    const result = runCommand({ 'index.json': new Error('Memory index read failed') });
    expect(result.uncaught).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.validated).toEqual([]);
  });

  test.failing('KNOWN GAP: null index entry aborts before remaining layouts can be validated', () => {
    const result = runCommand(fixtureFiles([null, entry()]));
    expect(result.uncaught).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(result.validated).toEqual([layout()]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
