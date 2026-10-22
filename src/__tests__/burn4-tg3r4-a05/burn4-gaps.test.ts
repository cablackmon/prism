import { calls, first, run } from './burn4-harness';
import type { CalendarObject } from './burn4-protocol';

// Inverse probes replace only test.failing with test in a disposable owned copy.
describe('KNOWN GAP: CalDAV smoke command regressions', () => {
  test.failing('KNOWN GAP: a successful create is abandoned when a later update throws', () => {
    const trace = first(run({ fail: 'dav:update', defer: 'dav:update' }));
    expect(trace.error).toBe('fixture failure: dav:update');
    expect(calls(trace, 'dav:create')).toHaveLength(1);
    expect(calls(trace, 'dav:delete')).toHaveLength(1);
  });

  test.failing('KNOWN GAP: deletion verification ignores an event whose UID exists only in data', () => {
    const result = run({ readback: 'data', finalRead: 'present-data' });
    const trace = first(result);
    expect(calls(trace, 'dav:delete')).toHaveLength(1);
    expect(calls(trace, 'dav:read3')).toHaveLength(1);
    const finalObjects = calls(trace, 'readback:result')[2] as CalendarObject[];
    expect(finalObjects[0]?.url).toContain('opaque.ics');
    expect(finalObjects[0]?.data).toContain('UID:prism-smoke-');
    expect(trace.exit).toBe(1);
  });

  test.failing('KNOWN GAP: same-millisecond concurrent runs create the same event filename', () => {
    const result = run({ copies: 2, defer: 'dav:create' });
    const filenames = result.runs.map(trace => {
      expect(trace.done).toBe(true);
      expect(calls(trace, 'dav:create')).toHaveLength(1);
      return (calls(trace, 'dav:create')[0] as { filename: string }).filename;
    });
    expect(new Set(filenames).size).toBe(2);
  });

  test.failing('KNOWN GAP: update verification accepts an unrelated title containing UPDATED', () => {
    const trace = first(run({ readData: 'unrelated' }));
    expect(calls(trace, 'dav:update')).toHaveLength(1);
    expect(calls(trace, 'dav:read2')).toHaveLength(1);
    expect(trace.exit).toBe(1);
  });

  test.failing('KNOWN GAP: update verification rejects a valid folded iCalendar SUMMARY', () => {
    const trace = first(run({ readData: 'folded' }));
    expect(calls(trace, 'dav:update')).toHaveLength(1);
    expect(calls(trace, 'dav:read2')).toHaveLength(1);
    const updatedObjects = calls(trace, 'readback:result')[1] as CalendarObject[];
    const unfolded = updatedObjects[0]?.data?.replace(/\r\n[ \t]/g, '');
    expect(unfolded).toContain('SUMMARY:Prism CalDAV smoke test (UPDATED)');
    expect(trace.done).toBe(true);
  });
});
