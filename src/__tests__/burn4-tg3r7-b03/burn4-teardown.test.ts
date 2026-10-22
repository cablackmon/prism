import assert from 'node:assert/strict';
import { gapContracts, intendedRepairs, loadTeardown } from './burn4-teardown-harness';

const warning = '[global-teardown] Could not clean up E2E data (DB unavailable)';

describe('offline global E2E teardown', () => {
  test('loading the module performs no filesystem or subprocess work', () => {
    const unit = loadTeardown();
    expect(unit.trace).toEqual([]);
    expect(unit.disk.size).toBe(0);
    expect(unit.warnings).toEqual([]);
  });

  test('success writes input before execution and removes it before returning', () => {
    const unit = loadTeardown();
    expect(unit.run()).toBeUndefined();
    expect(unit.trace).toEqual(['tmpdir', 'time', 'join', 'write', 'exec', 'unlink']);
    expect(unit.executions).toHaveLength(1);
    expect(unit.executions[0]?.path).toBe(unit.writes[0]);
    expect(unit.disk.size).toBe(0);
    expect(unit.commandOptions).toEqual([{ stdio: 'pipe', shell: 'cmd.exe' }]);
    expect(unit.warnings).toEqual([]);
  });

  test('cleanup scopes every deletion and removes dependent completions first', () => {
    const unit = loadTeardown();
    unit.run();
    const sql = unit.executions[0]?.sql;
    assert.ok(sql, 'fake consumed the cleanup input');
    const statements = sql.split(';').map((text) => text.trim()).filter(Boolean);
    expect(statements).toHaveLength(6);
    expect(statements[0]).toMatch(/^DELETE FROM chore_completions WHERE chore_id IN \(SELECT id FROM chores WHERE title LIKE 'E2E %'\)$/);
    expect(statements.slice(1)).toEqual([
      "DELETE FROM chores WHERE title LIKE 'E2E %'",
      "DELETE FROM tasks WHERE title LIKE 'E2E %'",
      "DELETE FROM events WHERE title LIKE 'E2E %'",
      "DELETE FROM shopping_items WHERE name LIKE 'E2E %'",
      "DELETE FROM shopping_lists WHERE name LIKE 'E2E %'",
    ]);
  });

  test('a temporary directory containing spaces remains a single input path', () => {
    const unit = loadTeardown({ root: '/inert temp directory' });
    unit.run();
    expect(unit.executions[0]?.path).toBe('/inert temp directory/prism-e2e-teardown-1000.sql');
    expect(unit.disk.size).toBe(0);
    expect(unit.warnings).toEqual([]);
  });

  test.each(['tmpdir', 'time', 'join'] as const)('%s failure warns before writing or executing', (stage) => {
    const unit = loadTeardown({ fail: new Set([stage]) });
    expect(unit.run()).toBeUndefined();
    expect(unit.trace).not.toContain('write');
    expect(unit.trace).not.toContain('exec');
    expect(unit.trace).not.toContain('unlink');
    expect(unit.disk.size).toBe(0);
    expect(unit.warnings).toEqual([warning]);
  });

  test('a write failure prevents execution and emits only the generic warning', () => {
    const unit = loadTeardown({ fail: new Set(['write']) });
    expect(unit.run()).toBeUndefined();
    expect(unit.trace).toEqual(['tmpdir', 'time', 'join', 'write']);
    expect(unit.executions).toEqual([]);
    expect(unit.disk.size).toBe(0);
    expect(unit.warnings).toEqual([warning]);
  });

  test('execution failure still removes the written temporary input', () => {
    const unit = loadTeardown({ fail: new Set(['exec']) });
    expect(unit.run()).toBeUndefined();
    expect(unit.trace).toEqual(['tmpdir', 'time', 'join', 'write', 'exec', 'unlink']);
    expect(unit.executions).toEqual([]);
    expect(unit.disk.size).toBe(0);
    expect(unit.warnings).toEqual([warning]);
  });

  test('unlink failure after successful execution is ignored', () => {
    const unit = loadTeardown({ fail: new Set(['unlink']) });
    expect(unit.run()).toBeUndefined();
    expect(unit.executions).toHaveLength(1);
    expect(unit.disk.size).toBe(1);
    expect(unit.warnings).toEqual([]);
  });

  test('execution and unlink failure still emit one generic warning', () => {
    const unit = loadTeardown({ fail: new Set(['exec', 'unlink']) });
    expect(unit.run()).toBeUndefined();
    expect(unit.trace.at(-1)).toBe('unlink');
    expect(unit.disk.size).toBe(1);
    expect(unit.warnings).toEqual([warning]);
  });

  test('a later invocation succeeds after an earlier execution failure', () => {
    const fail = new Set<'exec'>(['exec']);
    let now = 1000;
    const unit = loadTeardown({ fail, now: () => now++ });
    unit.run();
    fail.clear();
    unit.run();
    expect(unit.writes).toHaveLength(2);
    expect(unit.writes[0]).not.toBe(unit.writes[1]);
    expect(unit.executions).toHaveLength(1);
    expect(unit.executions[0]?.path).toBe(unit.writes[1]);
    expect(unit.disk.size).toBe(0);
    expect(unit.warnings).toEqual([warning]);
  });

  test('different timestamps keep nested invocations independent', () => {
    const disk = new Map<string, string>();
    const inner = loadTeardown({ disk, now: () => 1001 });
    const outer = loadTeardown({ disk, beforeConsume: () => { inner.run(); } });
    outer.run();
    expect(outer.executions).toHaveLength(1);
    expect(inner.executions).toHaveLength(1);
    expect(outer.writes[0]).not.toBe(inner.writes[0]);
    expect(outer.warnings).toEqual([]);
    expect(inner.warnings).toEqual([]);
    expect(disk.size).toBe(0);
  });

  test('successful sequential calls can safely reuse the same-millisecond path', () => {
    const unit = loadTeardown();
    unit.run();
    unit.run();
    expect(unit.writes).toHaveLength(2);
    expect(unit.writes[0]).toBe(unit.writes[1]);
    expect(unit.executions).toHaveLength(2);
    expect(unit.disk.size).toBe(0);
    expect(unit.warnings).toEqual([]);
  });

  test.each([
    ["require('node:net');", 'Denied import: node:net'],
    ["require('fs').readFileSync('inert');", 'Denied capability: fs.readFileSync'],
    ['void process.version;', 'Denied capability: process.version'],
  ])('the harness rejects an unapproved capability: %s', (injected, message) => {
    expect(() => loadTeardown({ transform: (source) => `${injected}\n${source}` })).toThrow(message);
  });

  test('the success oracle detects removal of the cleanup call', () => {
    const unit = loadTeardown({
      transform: (source) => source.replace('unlinkSync(tmpFile);', 'void tmpFile;'),
    });
    unit.run();
    expect(unit.executions).toHaveLength(1);
    expect(() => assert.equal(unit.disk.size, 0, 'success removes the temporary input'))
      .toThrow('success removes the temporary input');
  });

  test('an unknown command cannot disappear inside the source error handler', () => {
    const unit = loadTeardown({
      transform: (source) => source.replace('docker exec -i prism-db psql', 'inert-unapproved-command'),
    });
    expect(() => unit.run()).toThrow('tested source requested only explicitly inert capabilities');
    expect(unit.denials).toEqual(['Denied unknown command']);
    expect(unit.executions).toEqual([]);
    expect(unit.trace.at(-1)).toBe('unlink');
    expect(unit.disk.size).toBe(0);
  });

  test.each(['linux', 'partial', 'concurrent'] as const)('the %s desired contract passes under its intended VM repair', (name) => {
    expect(() => gapContracts[name](intendedRepairs[name])).not.toThrow();
  });

  test.failing('KNOWN GAP: global teardown forces cmd.exe on supported Linux hosts', () => { gapContracts.linux(); });
  test.failing('KNOWN GAP: global teardown leaves a partial temporary artifact after write failure', () => { gapContracts.partial(); });
  test.failing('KNOWN GAP: global teardown reuses temporary input across same-millisecond invocations', () => { gapContracts.concurrent(); });
});
