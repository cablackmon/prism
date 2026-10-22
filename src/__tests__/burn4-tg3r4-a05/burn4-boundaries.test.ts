import { calls, first, names, run } from './burn4-harness';
import type { Options } from './burn4-protocol';

describe('offline CalDAV smoke failure boundaries', () => {
  test('rejects a missing source argument before any database or environment access', () => {
    const result = run({ missingArg: true });
    const trace = first(result);
    expect(result.status).toBe(1);
    expect(trace.exit).toBe(1);
    expect(trace.errors).toEqual(['Usage: node smoke-caldav-write.mjs <sourceId>']);
    expect(trace.envReads).toEqual([]);
    expect(trace.calls).toEqual([]);
  });

  test.each<[Options, string, string]>([
    [{ noSource: true }, 'Source not found', 'sql:query'],
    [{ noCalendar: true }, 'Calendar not found on server', 'dav:calendars'],
    [{ responseFailure: 'create' }, 'CREATE FAILED', 'dav:create'],
    [{ missingRead: 1 }, 'CREATE READ-BACK FAILED', 'dav:read1'],
    [{ firstDataMissing: true, readback: 'data' }, 'CREATE READ-BACK FAILED', 'dav:read1'],
    [{ responseFailure: 'update' }, 'UPDATE FAILED', 'dav:update'],
    [{ missingRead: 2 }, 'UPDATE READ-BACK FAILED', 'dav:read2'],
    [{ readData: 'missing' }, 'UPDATE READ-BACK FAILED', 'dav:read2'],
    [{ readData: 'no-summary' }, 'UPDATE READ-BACK FAILED', 'dav:read2'],
    [{ readData: 'stale' }, 'UPDATE READ-BACK FAILED', 'dav:read2'],
    [{ responseFailure: 'delete' }, 'DELETE FAILED', 'dav:delete'],
    [{ finalRead: 'present-url' }, 'DELETE READ-BACK FAILED', 'dav:read3'],
  ])('exits immediately on %j and never runs finally or a later stage', (options, diagnostic, lastStage) => {
    const result = run(options);
    const trace = first(result);
    expect(result.status).toBe(1);
    expect(trace.exit).toBe(1);
    expect(trace.errors.join('\n')).toContain(diagnostic);
    expect(names(trace).filter(name => /^(dav:|sql:)/.test(name)).at(-1)).toBe(lastStage);
    expect(names(trace)).not.toContain('sql:end');
    expect(trace.done).toBeUndefined();
    expect(trace.logs.some(line => line.includes('ALL STEPS PASSED'))).toBe(false);
  });

  test('retains only a bounded preview when an update readback has a stale summary', () => {
    const trace = first(run({ readData: 'stale' }));
    expect(trace.errors).toHaveLength(2);
    expect(trace.errors[1]).toContain('raw vcard preview: UID:prism-smoke-');
    expect(trace.errors[1]?.length).toBeLessThanOrEqual('[smoke]   raw vcard preview: '.length + 400);
  });

  test.each([
    'sql:query', 'buffer:key', 'buffer:data', 'crypto:create', 'crypto:tag', 'crypto:update', 'crypto:final',
    'dav:connect', 'dav:calendars', 'ical:component', 'ical:now', 'ical:date', 'dav:create', 'create:header',
    'dav:read1', 'dav:update', 'dav:read2', 'dav:delete', 'dav:read3',
  ])('closes SQL exactly once and preserves a thrown %s failure', fail => {
    const trace = first(run({ fail }));
    expect(trace.error).toBe(`fixture failure: ${fail}`);
    expect(calls(trace, 'sql:end')).toHaveLength(1);
    expect(names(trace).at(-1)).toBe('sql:end');
    expect(trace.done).toBeUndefined();
    expect(trace.exit).toBeUndefined();
  });

  test('does not attempt SQL cleanup when its constructor itself throws', () => {
    const trace = first(run({ fail: 'sql:open' }));
    expect(trace.error).toBe('fixture failure: sql:open');
    expect(names(trace)).toEqual(['sql:open']);
  });

  test('propagates URL resolution failure when no Location header exists', () => {
    const trace = first(run({ calendarUrl: 'not-a-url', location: null }));
    expect(trace.error).toContain('Invalid URL');
    expect(names(trace).at(-1)).toBe('sql:end');
    expect(names(trace)).not.toContain('dav:read1');
  });

  test('propagates SQL shutdown failure after the lifecycle succeeds', () => {
    const trace = first(run({ endFails: true }));
    expect(trace.error).toBe('fixture failure: sql:end');
    expect(calls(trace, 'dav:delete')).toHaveLength(1);
    expect(calls(trace, 'sql:end')).toHaveLength(1);
  });

  test('records the current masking behavior when shutdown and a DAV operation both reject', () => {
    const trace = first(run({ fail: 'dav:update', endFails: true }));
    expect(trace.error).toBe('fixture failure: sql:end');
    expect(names(trace)).toContain('dav:update');
    expect(names(trace).at(-1)).toBe('sql:end');
  });

  test.each([
    ["fetch('https://never.example.invalid')", 'Forbidden boundary: fetch'],
    ["require('node:fs')", 'Forbidden boundary: require'],
    ['new WebSocket()', 'Forbidden boundary: WebSocket'],
    ['new XMLHttpRequest()', 'Forbidden boundary: XMLHttpRequest'],
    ['Object.keys(process.env)', 'Forbidden boundary: environment enumeration'],
    ['process.env.UNEXPECTED', 'Unexpected environment lookup'],
    ["Function('return 1')()", 'Code generation from strings disallowed'],
  ])('blocks prohibited escape %s before running source', (forbiddenProbe, diagnostic) => {
    const trace = first(run({ forbiddenProbe }));
    expect(trace.error).toContain(diagnostic);
    expect(names(trace)).not.toContain('sql:open');
  });
});
