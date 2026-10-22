import ICAL from 'ical.js';
import { previewEvent, validateCalendarIdentity, validateEvent } from '../../lib/burn4-all-day-recurrence';
import { dates, event, identity } from './burn4-fixtures';

afterEach(() => jest.restoreAllMocks());

test('copies and freezes a strict canonical event without changing caller state', () => {
  const days = Object.freeze(['WE', 'MO']);
  const input = Object.freeze(event({ title: '  Synthetic event  ', frequency: 'WEEKLY', startDate: '2026-10-19', weekdays: days,
    description: 'a\r\nb\rc\t', ending: Object.freeze({ mode: 'count', count: 2 }) }));
  const result = validateEvent(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('validation failed');
  expect(result.event).toMatchObject({ title: 'Synthetic event', description: 'a\nb\nc\t', weekdays: ['MO', 'WE'] });
  expect(Object.isFrozen(result.event)).toBe(true);
  expect(Object.isFrozen(result.event.ending)).toBe(true);
  expect(Object.isFrozen(result.event.weekdays)).toBe(true);
  expect(days).toEqual(['WE', 'MO']);
  expect(validateEvent(result.event)).toEqual(result);
});

const invalid: [string, unknown][] = [
  ['null', null], ['array', []], ['class', new Date(0)], ['unknown field', event({ extra: 1 })],
  ['empty title', event({ title: ' ' })], ['long title', event({ title: 'x'.repeat(256) })],
  ['long description', event({ description: 'x'.repeat(4001) })],
  ['description type', event({ description: 4 })], ['lone title surrogate', event({ title: '\ud800' })],
  ['lone description surrogate', event({ description: '\udfff' })],
  ...Array.from({ length: 33 }, (_, i) => i < 32 ? i : 127).map(code =>
    [`title control ${code}`, event({ title: `${String.fromCharCode(code)}Title` })] as [string, unknown]),
  ...[0, 1, 8, 11, 12, 14, 31, 127].map(code => [`description control ${code}`, event({ description: String.fromCharCode(code) })] as [string, unknown]),
  ...['2026-02-30', '1900-02-29', '2100-02-29', '2026-13-01', '2026-00-01', '2026-01-00',
    '1899-12-31', '10000-01-01', '2026-1-01', '2026-01-01Z'].map(startDate => [startDate, event({ startDate })] as [string, unknown]),
  ...[0, -1, 367, 1.5, Infinity, NaN, '2'].map(durationDays => [`duration ${durationDays}`, event({ durationDays })] as [string, unknown]),
  ...[0, -1, 100, 1.5, Infinity, '1'].map(interval => [`interval ${interval}`, event({ interval })] as [string, unknown]),
  ['unsupported cadence', event({ frequency: 'HOURLY' })], ['foreign weekdays', event({ weekdays: ['SA'] })],
  ['weekly absent', event({ frequency: 'WEEKLY' })], ['weekly empty', event({ frequency: 'WEEKLY', weekdays: [] })],
  ['weekly duplicate', event({ frequency: 'WEEKLY', weekdays: ['SA', 'SA'] })],
  ['weekly wrong start', event({ frequency: 'WEEKLY', weekdays: ['MO'] })],
  ['weekly sparse', event({ frequency: 'WEEKLY', weekdays: Object.assign(new Array(2), { 0: 'SA' }) })],
  ['ending absent', event({ ending: undefined })], ['ending both', event({ ending: { mode: 'count', count: 2, until: '2026-03-01' } })],
  ['ending stale', event({ ending: { mode: 'never', count: 2 } })], ['count zero', event({ ending: { mode: 'count', count: 0 } })],
  ['count overflow', event({ ending: { mode: 'count', count: 10001 } })], ['until before start', event({ ending: { mode: 'until', until: '2026-01-30' } })],
  ['until invalid', event({ ending: { mode: 'until', until: '2026-02-30' } })], ['exclusive end overflow', event({ startDate: '9999-12-31' })],
];
test.each(invalid)('rejects unsupported input: %s', (_name, value) => {
  expect(validateEvent(value).ok).toBe(false);
  expect(() => previewEvent(value)).toThrow();
});

test('handles unreadable property access without leaking thrown content', () => {
  const bad = Object.defineProperty({}, 'title', { enumerable: true, get() { throw new Error('private detail'); } });
  expect(validateEvent(bad)).toEqual({ ok: false, errors: { event: 'Unable to read supported event fields.' } });
});

test.each([
  ['2026-01-31', 1, ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31']],
  ['2026-01-31', 2, ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2027-01-31']],
] as const)('monthly anchor skips missing days from %s every %s months', (startDate, interval, expected) => {
  const result = previewEvent(event({ startDate, interval }));
  expect(dates(result)).toEqual(expected); expect(result.stop).toBe('count-ended');
});

test.each([
  [1, '2096-02-29', ['2096-02-29', '2104-02-29', '2108-02-29', '2112-02-29']],
  [25, '2000-02-29', ['2000-02-29', '2400-02-29', '2800-02-29', '3200-02-29']],
  [50, '2000-02-29', ['2000-02-29', '2400-02-29', '2800-02-29', '3200-02-29']],
  [99, '2000-02-29', ['2000-02-29', '2396-02-29', '2792-02-29', '3188-02-29']],
] as const)('yearly interval %s keeps leap day anchored through centuries', (interval, startDate, expected) => {
  expect(dates(previewEvent(event({ frequency: 'YEARLY', startDate, interval, ending: { mode: 'count', count: 4 } })))).toEqual(expected);
});

test('weekly interval is anchored to Monday and counts selected days', () => {
  const result = previewEvent(event({ startDate: '2026-10-25', frequency: 'WEEKLY', interval: 2, weekdays: ['MO', 'SU'] }));
  expect(dates(result)).toEqual(['2026-10-25', '2026-11-02', '2026-11-08', '2026-11-16', '2026-11-22']);
});

test('inclusive until bounds starts while duration can extend beyond until', () => {
  const result = previewEvent(event({ startDate: '2026-12-30', durationDays: 3, frequency: 'DAILY', ending: { mode: 'until', until: '2026-12-31' } }));
  expect(result).toEqual({ rows: [{ startDate: '2026-12-30', endExclusive: '2027-01-02' },
    { startDate: '2026-12-31', endExclusive: '2027-01-03' }], stop: 'until-ended' });
});

test.each([1, 20, 21, 10000])('COUNT %s uses at most 21 public next calls', count => {
  const spy = jest.spyOn(ICAL.RecurIterator.prototype, 'next');
  const result = previewEvent(event({ frequency: 'DAILY', ending: { mode: 'count', count } }));
  expect(result.rows).toHaveLength(Math.min(20, count));
  expect(result.stop).toBe(count <= 20 ? 'count-ended' : 'preview-limit');
  expect(spy.mock.calls.length).toBe(Math.min(21, count + 1));
  expect(result.rows[0]!.startDate).toBe('2026-01-31');
});

test('never ending is preview-limited and owns immutable per-date records', () => {
  const result = previewEvent(event({ frequency: 'DAILY', ending: { mode: 'never' } }));
  expect(result.rows).toHaveLength(20); expect(result.stop).toBe('preview-limit');
  expect(result.rows[0]!.startDate).toBe('2026-01-31');
  expect(result.rows[19]!.startDate).toBe('2026-02-19');
  expect(Object.isFrozen(result.rows[0])).toBe(true);
});

test('stops before unsupported future dates or exclusive-end overflow', () => {
  expect(previewEvent(event({ startDate: '9999-12-30', frequency: 'DAILY', ending: { mode: 'never' } })))
    .toEqual({ rows: [{ startDate: '9999-12-30', endExclusive: '9999-12-31' }], stop: 'date-limit' });
  expect(previewEvent(event({ startDate: '9999-02-01', frequency: 'YEARLY', interval: 99, ending: { mode: 'never' } })).stop).toBe('date-limit');
});

test.each(['null', 'throws', 'repeats', 'invalid', 'timed', 'extra-count'] as const)('reports engine %s as failure', kind => {
  const start = ICAL.Time.fromDateString('2026-01-31');
  let calls = 0;
  jest.spyOn(ICAL.Recur.prototype, 'iterator').mockReturnValue({ next() {
    calls++;
    if (kind === 'null') return null;
    if (kind === 'throws') throw new Error('library failed');
    if (kind === 'invalid') return { year: 2026, month: 2, day: 30, isDate: true };
    if (kind === 'timed') return { year: 2026, month: 1, day: 31, isDate: false };
    if (kind === 'extra-count' && calls > 1) return ICAL.Time.fromDateString('2026-03-31');
    return start;
  } } as unknown as ICAL.RecurIterator);
  expect(() => previewEvent(event({ ending: { mode: 'count', count: kind === 'extra-count' ? 1 : 5 } }))).toThrow('Unable to preview');
});

test('validates public identity independently and freezes its copy', () => {
  const result = validateCalendarIdentity(identity);
  expect(result).toEqual(identity); expect(result).not.toBe(identity); expect(Object.isFrozen(result)).toBe(true);
});

test.each([
  { ...identity, uid: '' }, { ...identity, uid: 'a'.repeat(129) }, { ...identity, uid: 'a\r\nBEGIN:VALARM' },
  { ...identity, uid: '米' }, { ...identity, uid: '-prefix' }, { ...identity, dtstamp: '2026-02-30T00:00:00Z' },
  { ...identity, dtstamp: '2026-01-01T24:00:00Z' }, { ...identity, dtstamp: '2026-01-01T00:60:00Z' },
  { ...identity, dtstamp: '2026-01-01T00:00:60Z' }, { ...identity, dtstamp: '2026-01-01T00:00:00.000Z' },
  { ...identity, dtstamp: '2026-01-01T00:00:00+00:00' }, { ...identity, extra: 'no' },
])('rejects invalid public identity %j', value => expect(() => validateCalendarIdentity(value)).toThrow('Invalid public calendar identity'));


test('weekday validation uses at most seven indexed slots and ignores a custom iterator', () => {
  const input = ['SA'];
  const iterator = jest.fn(() => { throw new Error('must not be consumed'); });
  Object.defineProperty(input, Symbol.iterator, { value: iterator });
  expect(validateEvent(event({ frequency: 'WEEKLY', weekdays: input })).ok).toBe(true);
  expect(iterator).not.toHaveBeenCalled();
});


test('an uncompleted UNTIL iterator cannot silently report premature exhaustion', () => {
  let count = 0;
  jest.spyOn(ICAL.Recur.prototype, 'iterator').mockReturnValue({ completed: false, next() {
    return count++ ? null : ICAL.Time.fromDateString('2026-01-31');
  } } as unknown as ICAL.RecurIterator);
  expect(() => previewEvent(event({ ending: { mode: 'until', until: '2026-12-31' } }))).toThrow('Unable to preview');
});


test('daily intervals carry through month boundaries with inclusive until', () => {
  expect(dates(previewEvent(event({ startDate: '2026-01-30', frequency: 'DAILY', interval: 3,
    ending: { mode: 'until', until: '2026-02-05' } })))).toEqual(['2026-01-30', '2026-02-02', '2026-02-05']);
});

test('until equal to start includes one occurrence and a between-occurrence until stops honestly', () => {
  expect(dates(previewEvent(event({ ending: { mode: 'until', until: '2026-01-31' } })))).toEqual(['2026-01-31']);
  expect(dates(previewEvent(event({ ending: { mode: 'until', until: '2026-03-01' } })))).toEqual(['2026-01-31']);
});

test('maximal calendar-day duration retains leap and year boundaries without elapsed-time arithmetic', () => {
  expect(previewEvent(event({ startDate: '2024-02-29', frequency: 'YEARLY', durationDays: 366,
    ending: { mode: 'count', count: 1 } })).rows).toEqual([{ startDate: '2024-02-29', endExclusive: '2025-03-01' }]);
});


test('a completed flag with an unchanged last candidate cannot conceal premature UNTIL exhaustion', () => {
  let count = 0;
  const last = ICAL.Time.fromDateString('2026-01-31');
  jest.spyOn(ICAL.Recur.prototype, 'iterator').mockReturnValue({ completed: true, last, next() {
    return count++ ? null : last;
  } } as unknown as ICAL.RecurIterator);
  expect(() => previewEvent(event({ ending: { mode: 'until', until: '2026-12-31' } }))).toThrow('Unable to preview');
});

test.each([
  [{ year: 10000, month: 99, day: NaN, isDate: true }, true],
  [{ year: 10000, month: 1, day: 1, isDate: true }, false],
] as const)('distinguishes malformed future calendar fields from a valid range overflow: %j', (future, invalid) => {
  let calls = 0;
  jest.spyOn(ICAL.Recur.prototype, 'iterator').mockReturnValue({ next() {
    return calls++ ? future : ICAL.Time.fromDateString('9999-01-01');
  } } as unknown as ICAL.RecurIterator);
  const input = event({ frequency: 'YEARLY', startDate: '9999-01-01', ending: { mode: 'never' } });
  if (invalid) expect(() => previewEvent(input)).toThrow('Unable to preview');
  else expect(previewEvent(input)).toEqual({
    rows: [{ startDate: '9999-01-01', endExclusive: '9999-01-02' }], stop: 'date-limit',
  });
});
