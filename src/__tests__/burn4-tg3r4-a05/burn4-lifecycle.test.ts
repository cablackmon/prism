import { calls, first, names, run } from './burn4-harness';
import type { EventRecord, Options } from './burn4-protocol';

const calendarUrl = 'https://calendar.example.invalid/fixture/';

describe('offline CalDAV smoke lifecycle', () => {
  test('binds the source query and completes all six stages in dependency order', () => {
    const result = run();
    const trace = first(result);
    expect(result.status).toBe(0);
    expect(trace.done).toBe(true);
    expect(trace.error).toBeUndefined();
    expect(calls(trace, 'sql:query')).toEqual([{ text: expect.stringContaining('WHERE id = ?'), values: ['fixture-source'] }]);
    expect(names(trace).filter(name => /^(sql:|dav:|timer:)/.test(name))).toEqual([
      'sql:open', 'sql:query', 'dav:connect', 'dav:calendars', 'dav:create',
      'timer:scheduled', 'timer:fired', 'dav:read1', 'dav:update',
      'timer:scheduled', 'timer:fired', 'dav:read2', 'dav:delete', 'dav:read3', 'sql:end',
    ]);
    expect(calls(trace, 'timer:scheduled')).toEqual([3000, 3000]);
    expect(trace.logs.some(line => line.includes('ALL STEPS PASSED'))).toBe(true);
    expect(trace.errors).toEqual([]);
  });

  test('never supplies environment, ciphertext or authentication values to its inert dependencies', () => {
    const trace = first(run());
    expect(trace.envReads).toEqual(['DATABASE_URL', 'ENCRYPTION_KEY', 'PIN_ENCRYPTION_KEY']);
    expect(calls(trace, 'dav:connect')).toEqual([{
      serverUrl: 'https://dav.example.invalid', credentialValuesAbsent: true,
      authMethod: 'Basic', defaultAccountType: 'caldav',
    }]);
    expect(names(trace).filter(name => name.startsWith('buffer:') || name.startsWith('crypto:'))).toEqual([
      'buffer:key', 'buffer:data', 'buffer:iv', 'buffer:tag', 'buffer:cipher',
      'crypto:create', 'crypto:tag', 'crypto:update', 'crypto:final',
    ]);
    expect(calls(trace, 'buffer:iv')).toEqual([[0, 12]]);
    expect(calls(trace, 'buffer:tag')).toEqual([[12, 28]]);
    expect(calls(trace, 'buffer:cipher')).toEqual([[28]]);
    expect(calls(trace, 'crypto:create')).toEqual(['aes-256-gcm']);
    expect(calls(trace, 'crypto:final')).toEqual(['utf8']);
  });

  test.each<[Options['config'], string | undefined]>([
    [{ serverUrl: 'https://camel.example.invalid' }, 'https://camel.example.invalid'],
    [{ server_url: 'https://snake.example.invalid' }, 'https://snake.example.invalid'],
    [{ serverUrl: 'https://first.example.invalid', server_url: 'https://second.example.invalid' }, 'https://first.example.invalid'],
    [{ serverUrl: '', server_url: 'https://fallback.example.invalid' }, 'https://fallback.example.invalid'],
    [{}, undefined],
    [null, undefined],
  ])('maps provider URL variants without requiring credential material: %j', (config, serverUrl) => {
    const connected = calls(first(run({ config })), 'dav:connect')[0] as { serverUrl?: string };
    expect(connected.serverUrl).toBe(serverUrl);
  });

  test('marshals creation and update events with UTC timestamp fields and a 30 minute duration', () => {
    const trace = first(run());
    const roots = trace.components.filter(component => component.components.length > 0);
    expect(roots).toHaveLength(2);
    const createRoot = roots[0] as EventRecord;
    const updateRoot = roots[1] as EventRecord;
    expect(createRoot.properties).toEqual({ prodid: '-//Prism//CalDAV smoke//EN', version: '2.0' });
    const created = createRoot.components[0] as EventRecord;
    const updated = updateRoot.components[0] as EventRecord;
    expect(created.properties).toEqual({
      uid: expect.stringMatching(/^prism-smoke-\d+@prism\.local$/),
      summary: 'Prism CalDAV smoke test', description: true, dtstamp: { zone: 'UTC' },
      dtstart: { milliseconds: expect.any(Number), utc: true },
      dtend: { milliseconds: expect.any(Number), utc: true },
    });
    expect(updated.properties).toEqual({ ...created.properties, summary: 'Prism CalDAV smoke test (UPDATED)', description: undefined });
    const dateCalls = calls(trace, 'ical:date') as { milliseconds: number; utc: boolean; localHour: number; localMinute: number }[];
    expect(dateCalls).toHaveLength(4);
    expect(dateCalls[0]).toEqual(expect.objectContaining({ utc: true, localHour: 23, localMinute: 0 }));
    expect((dateCalls[1]?.milliseconds ?? 0) - (dateCalls[0]?.milliseconds ?? 0)).toBe(1800000);
    expect(dateCalls.slice(2)).toEqual(dateCalls.slice(0, 2));
  });

  test.each([false, true])('handles optional description and location in the original event helper: %s', optionalFields => {
    const trace = first(run({ helper: 'event', optionalFields }));
    const event = trace.components.find(component => component.components.length === 0);
    expect(event?.properties).toEqual(expect.objectContaining({ uid: 'fixture-event', summary: 'Fixture title' }));
    expect(event?.properties.description).toBe(optionalFields ? true : undefined);
    expect(event?.properties.location).toBe(optionalFields ? true : undefined);
    expect(trace.helper).toContain('SUMMARY:Fixture title');
    expect(names(trace)).not.toContain('sql:open');
  });

  test('executes the original decrypt helper with only inert objects and an unusable numeric result', () => {
    const trace = first(run({ helper: 'decrypt' }));
    expect(trace.helper).toBe('NaN');
    expect(trace.envReads).toEqual(['ENCRYPTION_KEY', 'PIN_ENCRYPTION_KEY']);
    expect(names(trace)).not.toContain('sql:open');
  });

  test.each(['url', 'data'] as const)('finds created and updated events through the %s match', readback => {
    const trace = first(run({ readback }));
    const update = calls(trace, 'dav:update')[0] as { calendarObject: { url: string; etag: string; data: string } };
    const deletion = calls(trace, 'dav:delete')[0] as { calendarObject: { url: string; etag: string; data: string } };
    expect(trace.done).toBe(true);
    expect(update.calendarObject.url).toContain(readback === 'data' ? 'opaque.ics' : 'prism-smoke-');
    expect(update.calendarObject.etag).toBe('revision-1');
    expect(update.calendarObject.data).toContain('SUMMARY:Prism CalDAV smoke test (UPDATED)');
    expect(deletion.calendarObject).toEqual({ url: update.calendarObject.url, etag: 'revision-2', data: '' });
  });

  test.each([undefined, null, ''] as const)('uses the reported create href or its calendar-relative fallback: %s', location => {
    const trace = first(run({ location }));
    const create = calls(trace, 'dav:create')[0] as { filename: string };
    const href = location === undefined ? `${calendarUrl}assigned.ics` : `${calendarUrl}${create.filename}`;
    expect(trace.logs).toContain(`[smoke]   href:   ${href}`);
    expect(calls(trace, 'create:header')).toEqual(['Location']);
  });

  test.each(['sql:query', 'dav:connect', 'dav:calendars', 'dav:create', 'dav:read1', 'dav:update', 'dav:read2', 'dav:delete', 'dav:read3'])('does not advance past unresolved %s', defer => {
    const trace = first(run({ defer }));
    const pause = trace.pauses[0];
    expect(trace.done).toBe(true);
    expect(trace.pauses).toHaveLength(1);
    expect(pause?.stage).toBe(defer);
    expect(pause?.calls.at(-1)).toBe(defer);
    const allNames = names(trace);
    expect(pause?.calls).toEqual(allNames.slice(0, allNames.indexOf(defer) + 1));
  });

  test('keeps two concurrent runs independent when their clocks differ by one millisecond', () => {
    const result = run({ copies: 2, timeOffset: 1, defer: 'dav:create' });
    expect(result.runs).toHaveLength(2);
    expect(result.collisions).toBe(0);
    for (const trace of result.runs) {
      expect(trace.done).toBe(true);
      expect(calls(trace, 'sql:end')).toHaveLength(1);
      expect(calls(trace, 'dav:create')).toHaveLength(1);
      expect(calls(trace, 'dav:update')).toHaveLength(1);
      expect(calls(trace, 'dav:delete')).toHaveLength(1);
    }
  });
});
