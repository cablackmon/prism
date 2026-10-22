import ICAL from 'ical.js';
import { previewEvent, serializeCalendar } from '../../lib/burn4-all-day-recurrence';
import { dates, event, identity } from './burn4-fixtures';

afterEach(() => jest.restoreAllMocks());
function component(text: string) { return new ICAL.Component(ICAL.parse(text)); }

test('builds one allowlisted portable event with typed all-day dates and explicit UTC stamp', () => {
  const text = serializeCalendar(event(), identity);
  const calendar = component(text);
  expect(calendar.name).toBe('vcalendar');
  expect(calendar.getFirstPropertyValue('version')).toBe('2.0');
  expect(calendar.getFirstPropertyValue('calscale')).toBe('GREGORIAN');
  expect(calendar.getAllSubcomponents()).toHaveLength(1);
  const value = calendar.getFirstSubcomponent('vevent')!;
  expect(value.getAllSubcomponents()).toEqual([]);
  expect(value.getAllProperties().map(property => property.name).sort()).toEqual([
    'dtend', 'dtstamp', 'dtstart', 'rrule', 'summary', 'uid',
  ]);
  expect(value.getFirstProperty('dtstart')!.type).toBe('date');
  expect(value.getFirstProperty('dtend')!.type).toBe('date');
  expect(value.getFirstProperty('dtstart')!.getParameter('tzid')).toBeUndefined();
  expect(value.getFirstPropertyValue('uid')).toBe(identity.uid);
  expect(text).toContain('DTSTAMP:20261022T083000Z\r\n');
  expect(text).toContain('DTSTART;VALUE=DATE:20260131\r\n');
  expect(text).toContain('DTEND;VALUE=DATE:20260201\r\n');
});

test.each([
  event(), event({ frequency: 'YEARLY', startDate: '2096-02-29', ending: { mode: 'count', count: 4 } }),
  event({ frequency: 'WEEKLY', startDate: '2026-10-25', weekdays: ['SU', 'MO'], interval: 2 }),
  event({ frequency: 'DAILY', startDate: '2026-12-30', ending: { mode: 'until', until: '2027-01-03' } }),
])('exported actual recurrence agrees with fixed-vector-tested preview', spec => {
  const value = component(serializeCalendar(spec, identity)).getFirstSubcomponent('vevent')!;
  const recur = value.getFirstPropertyValue('rrule') as ReturnType<typeof ICAL.Recur.fromString>;
  const start = value.getFirstPropertyValue('dtstart') as ReturnType<typeof ICAL.Time.fromDateString>;
  expect(recur.wkst).toBe(ICAL.Time.MONDAY);
  const iterator = recur.iterator(start);
  const actual: string[] = [];
  for (let i = 0; i < 20; i++) { const next = iterator.next(); if (!next) break; actual.push(next.toString()); }
  expect(actual).toEqual(dates(previewEvent(spec)));
});

test('UNTIL remains DATE and does not clip a multi-day event duration', () => {
  const text = serializeCalendar(event({ frequency: 'DAILY', startDate: '2026-12-30', durationDays: 3,
    ending: { mode: 'until', until: '2026-12-30' } }), identity);
  expect(text).toContain('DTEND;VALUE=DATE:20270102');
  expect(text).toContain('UNTIL=20261230');
  expect(text).not.toContain('COUNT=');
  const rule = component(text).getFirstSubcomponent('vevent')!.getFirstPropertyValue('rrule') as ReturnType<typeof ICAL.Recur.fromString>;
  expect(rule.until!.isDate).toBe(true);
});

test.each([74, 75, 76, 150, 255])('folds ASCII boundaries around %s without losing text', length => {
  const title = 'a'.repeat(Math.min(length, 255));
  const text = serializeCalendar(event({ title, description: 'b'.repeat(length) }), identity);
  for (const line of text.split('\r\n').slice(0, -1)) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  expect(component(text).getFirstSubcomponent('vevent')!.getFirstPropertyValue('summary')).toBe(title);
});

test('escapes injection-shaped text exactly once and folds UTF-8 without splitting code points', () => {
  const description = 'first\r\nEND:VEVENT\rBEGIN:VALARM\nATTENDEE:example\n\\comma,semicolon; ' + '米🍚'.repeat(300);
  const normalized = description.replace(/\r\n?/g, '\n');
  const title = '米🍚,;\\'.repeat(30);
  const text = serializeCalendar(event({ title, description }), identity);
  expect(text.endsWith('\r\n')).toBe(true);
  expect(text.endsWith('\r\n\r\n')).toBe(false);
  expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  const physical = text.split('\r\n').slice(0, -1);
  for (const line of physical) {
    expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(Buffer.from(line).toString('utf8')).toBe(line);
    expect(line).not.toMatch(/[\uD800-\uDFFF]/u);
  }
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32768);
  const calendar = component(text);
  expect(calendar.getAllSubcomponents()).toHaveLength(1);
  const item = calendar.getFirstSubcomponent('vevent')!;
  expect(item.getAllSubcomponents()).toEqual([]);
  expect(item.getFirstPropertyValue('summary')).toBe(title);
  expect(item.getFirstPropertyValue('description')).toBe(normalized);
});

test('serializes deterministically without changing package globals or frozen inputs', () => {
  const before = { foldLength: ICAL.foldLength, newLineChar: ICAL.newLineChar };
  const spec = Object.freeze(event({ description: 'Text\twith tab', ending: Object.freeze({ mode: 'never' }) }));
  const first = serializeCalendar(spec, Object.freeze(identity));
  expect(serializeCalendar(spec, identity)).toBe(first);
  expect({ foldLength: ICAL.foldLength, newLineChar: ICAL.newLineChar }).toEqual(before);
});

test('enforces the final byte budget and rejects malformed generated physical lines defensively', () => {
  jest.spyOn(ICAL, 'stringify').mockReturnValue('A'.repeat(32768));
  expect(() => serializeCalendar(event(), identity)).toThrow('byte limit');
  jest.mocked(ICAL.stringify).mockReturnValue('BEGIN:VCALENDAR\rX\r\n');
  expect(() => serializeCalendar(event(), identity)).toThrow('calendar line');
});

test('all legal maximal Unicode fields fit the declared finite export budget', () => {
  const text = serializeCalendar(event({ title: '米'.repeat(255), description: '米'.repeat(4000) }),
    { uid: 'a'.repeat(128), dtstamp: '9999-12-31T23:59:59Z' });
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32768);
});

test('no existing app modules are loaded by model or calendar code', () => {
  const loaded = Object.keys(require.cache).filter(path => /\/src\//.test(path) &&
    !path.includes('/src/__tests__/burn4-tg3r9-c01/') && !path.endsWith('/src/lib/burn4-all-day-recurrence.ts'));
  expect(loaded).toEqual([]);
});
