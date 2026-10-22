import ICAL from 'ical.js';

type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
type Ending = Readonly<{ mode: 'never' } | { mode: 'count'; count: number } |
  { mode: 'until'; until: string }>;
export type RecurrenceEvent = Readonly<{
  title: string; description?: string; startDate: string; durationDays: number;
  interval: number; ending: Ending;
} & ({ frequency: 'WEEKLY'; weekdays: readonly Weekday[] } |
  { frequency: Exclude<Frequency, 'WEEKLY'>; weekdays?: never })>;
export type EventValidation = Readonly<{ ok: true; event: RecurrenceEvent; key: string } |
  { ok: false; errors: Readonly<Record<string, string>> }>;
export type CalendarIdentity = Readonly<{ uid: string; dtstamp: string }>;
export type RecurrencePreview = Readonly<{
  rows: readonly Readonly<{ startDate: string; endExclusive: string }>[];
  stop: 'count-ended' | 'until-ended' | 'preview-limit' | 'date-limit';
}>;
const days: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const frequencies: readonly string[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const loneSurrogate = /[\uD800-\uDFFF]/u;
const titleControls = /[\u0000-\u001F\u007F]/;
const descriptionControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
type CalendarDate = { year: number; month: number; day: number };
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function keysOnly(value: Record<string, unknown>, keys: readonly string[]) {
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key));
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}
function realParts(year: number, month: number, day: number): boolean {
  if (!Number.isSafeInteger(year) || year < 1900 || !integer(month, 1, 12)) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return integer(day, 1, [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!);
}
function realDate(year: number, month: number, day: number): boolean {
  return year <= 9999 && realParts(year, month, day);
}
function parseDate(value: unknown): CalendarDate | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) };
  return realDate(date.year, date.month, date.day) ? date : null;
}
function dateString(date: CalendarDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
function ordinal(date: CalendarDate): number {
  const y = date.year - 1;
  const leap = date.year % 4 === 0 && (date.year % 100 !== 0 || date.year % 400 === 0);
  return 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) +
    [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][date.month - 1]! +
    (leap && date.month > 2 ? 1 : 0) + date.day;
}
function endDate(date: CalendarDate, duration: number): string | null {
  const end = ICAL.Time.fromData({ ...date, isDate: true });
  end.adjust(duration, 0, 0, 0);
  const copy = { year: end.year, month: end.month, day: end.day };
  return realDate(copy.year, copy.month, copy.day) ? dateString(copy) : null;
}

/** Validate and copy the supported form into a frozen, deterministic event. */
export function validateEvent(input: unknown): EventValidation {
  const errors: Record<string, string> = {};
  try {
    if (!record(input) || !keysOnly(input, ['title', 'description', 'startDate', 'durationDays', 'frequency', 'interval', 'weekdays', 'ending'])) {
      return { ok: false, errors: { event: 'Use only supported event fields.' } };
    }
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (typeof input.title !== 'string' || input.title.length > 255 || !title ||
      titleControls.test(input.title) || loneSurrogate.test(input.title)) errors.title = 'Enter a single-line title of 1 to 255 characters.';
    let description: string | undefined;
    if (input.description !== undefined) {
      if (typeof input.description !== 'string' || input.description.length > 4000 || loneSurrogate.test(input.description)) {
        errors.description = 'Description must contain at most 4000 valid characters.';
      } else {
        description = input.description.replace(/\r\n?/g, '\n');
        if (descriptionControls.test(description)) errors.description = 'Description contains unsupported controls.';
      }
    }
    const start = parseDate(input.startDate);
    if (!start) errors.startDate = 'Enter a real date from 1900 through 9999.';
    if (!integer(input.durationDays, 1, 366)) errors.durationDays = 'Duration must be an integer from 1 to 366 days.';
    if (!integer(input.interval, 1, 99)) errors.interval = 'Interval must be an integer from 1 to 99.';
    if (typeof input.frequency !== 'string' || !frequencies.includes(input.frequency)) errors.frequency = 'Choose a supported cadence.';
    let selected: Weekday[] = [];
    if (input.frequency === 'WEEKLY') {
      const provided = input.weekdays;
      const length = Array.isArray(provided) ? provided.length : 0;
      const requested: unknown[] = [];
      if (integer(length, 1, 7)) {
        // Index a bounded snapshot so sparse arrays and custom iterators cannot
        // erase a missing weekday or expand work beyond seven positions.
        for (let index = 0; index < length; index++) requested.push((provided as unknown[])[index]);
      }
      if (!requested.length || requested.some(day => !days.includes(day as Weekday)) || new Set(requested).size !== requested.length) {
        errors.weekdays = 'Choose unique weekdays, including the start weekday.';
      } else {
        selected = days.filter(day => requested.includes(day));
        if (start && !selected.includes(days[(ordinal(start) - 1) % 7]!)) errors.weekdays = 'Include the start date weekday.';
      }
    } else if ('weekdays' in input) errors.weekdays = 'Weekdays apply only to weekly events.';
    let ending: Ending | undefined;
    if (record(input.ending)) {
      const e = input.ending;
      if (e.mode === 'never' && keysOnly(e, ['mode'])) ending = { mode: 'never' };
      if (e.mode === 'count' && keysOnly(e, ['mode', 'count']) && integer(e.count, 1, 10000)) ending = { mode: 'count', count: e.count };
      if (e.mode === 'until' && keysOnly(e, ['mode', 'until']) && parseDate(e.until) && start &&
        (e.until as string) >= (input.startDate as string)) ending = { mode: 'until', until: e.until as string };
    }
    if (!ending) errors.ending = 'Choose never, a count from 1 to 10000, or an ending date on or after start.';
    if (start && integer(input.durationDays, 1, 366) && !endDate(start, input.durationDays)) errors.durationDays = 'The exclusive end exceeds year 9999.';
    if (Object.keys(errors).length) return { ok: false, errors: Object.freeze(errors) };
    const common = { title, ...(description === undefined ? {} : { description }), startDate: input.startDate as string,
      durationDays: input.durationDays as number, interval: input.interval as number, ending: Object.freeze(ending!) };
    const event: RecurrenceEvent = Object.freeze(input.frequency === 'WEEKLY'
      ? { ...common, frequency: 'WEEKLY', weekdays: Object.freeze(selected) }
      : { ...common, frequency: input.frequency as Exclude<Frequency, 'WEEKLY'> });
    return Object.freeze({ ok: true, event, key: JSON.stringify(event) });
  } catch {
    return { ok: false, errors: { event: 'Unable to read supported event fields.' } };
  }
}
function accepted(input: unknown): RecurrenceEvent {
  const result = validateEvent(input);
  if (!result.ok) throw new Error('Invalid recurrence event');
  return result.event;
}
function ruleFor(event: RecurrenceEvent) {
  const start = parseDate(event.startDate)!;
  return ICAL.Recur.fromData({
    freq: event.frequency, interval: event.interval, wkst: ICAL.Time.MONDAY,
    ...(event.frequency === 'WEEKLY' ? { byday: [...event.weekdays] } : {}),
    ...(event.frequency === 'MONTHLY' || event.frequency === 'YEARLY' ? { bymonthday: [start.day] } : {}),
    ...(event.frequency === 'YEARLY' ? { bymonth: [start.month] } : {}),
    ...(event.ending.mode === 'count' ? { count: event.ending.count } : {}),
    ...(event.ending.mode === 'until' ? { until: ICAL.Time.fromDateString(event.ending.until) } : {}),
  });
}
function matches(date: CalendarDate, start: CalendarDate, event: RecurrenceEvent) {
  if (event.frequency === 'DAILY') return (ordinal(date) - ordinal(start)) % event.interval === 0;
  if (event.frequency === 'MONTHLY') return date.day === start.day &&
    ((date.year - start.year) * 12 + date.month - start.month) % event.interval === 0;
  if (event.frequency === 'YEARLY') return date.month === start.month && date.day === start.day &&
    (date.year - start.year) % event.interval === 0;
  return event.weekdays?.includes(days[(ordinal(date) - 1) % 7]!) === true &&
    (Math.floor((ordinal(date) - 1) / 7) - Math.floor((ordinal(start) - 1) / 7)) % event.interval === 0;
}
/** First dates only: twenty visible rows and at most one iterator lookahead. */
export function previewEvent(input: unknown): RecurrencePreview {
  const event = accepted(input);
  const start = parseDate(event.startDate)!;
  const rows: { startDate: string; endExclusive: string }[] = [];
  const done = (stop: RecurrencePreview['stop']): RecurrencePreview => Object.freeze({ rows: Object.freeze(rows), stop });
  try {
    const iterator = ruleFor(event).iterator(ICAL.Time.fromDateString(event.startDate));
    let previous = '';
    for (let calls = 0; calls < 21; calls++) {
      const next = iterator.next();
      if (!next) {
        if (!iterator.completed) throw new Error('Unexpected recurrence exhaustion');
        if (event.ending.mode === 'count' && rows.length === event.ending.count) return done('count-ended');
        if (event.ending.mode === 'until' && rows.length) {
          const boundary = parseDate(event.ending.until)!;
          // A completed flag alone can conceal premature exhaustion. The public
          // last candidate must have actually crossed the inclusive bound.
          const last = iterator.last;
          const stopped = { year: last?.year, month: last?.month, day: last?.day };
          if (last?.isDate === true && realParts(stopped.year, stopped.month, stopped.day) &&
            ordinal(stopped) > ordinal(boundary)) return done('until-ended');
        }
        throw new Error('Unexpected recurrence exhaustion');
      }
      if (event.ending.mode === 'count' && rows.length >= event.ending.count) throw new Error('Count exceeded');
      // The iterator reuses a mutable Time. Never retain that object.
      const date = { year: next.year, month: next.month, day: next.day };
      const isDate = next.isDate;
      if (!realParts(date.year, date.month, date.day) || isDate !== true) throw new Error('Invalid recurrence date');
      if (date.year > 9999) return done('date-limit');
      if (!realDate(date.year, date.month, date.day)) throw new Error('Invalid recurrence date');
      const text = dateString(date);
      if (text < event.startDate || text <= previous || (!rows.length && text !== event.startDate) ||
        !matches(date, start, event) || (event.ending.mode === 'until' && text > event.ending.until)) throw new Error('Invalid recurrence progression');
      const end = endDate(date, event.durationDays);
      if (!end) return done('date-limit');
      if (rows.length === 20) return done('preview-limit');
      rows.push(Object.freeze({ startDate: text, endExclusive: end }));
      previous = text;
    }
    throw new Error('Recurrence work limit');
  } catch {
    throw new Error('Unable to preview the supported recurrence');
  }
}
/** Validate an explicit public UID and UTC-second stamp without generating either. */
export function validateCalendarIdentity(input: unknown): CalendarIdentity {
  if (!record(input) || !keysOnly(input, ['uid', 'dtstamp']) || typeof input.uid !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/.test(input.uid) || typeof input.dtstamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.dtstamp) || !parseDate(input.dtstamp.slice(0, 10)) ||
    !integer(Number(input.dtstamp.slice(11, 13)), 0, 23) || !integer(Number(input.dtstamp.slice(14, 16)), 0, 59) ||
    !integer(Number(input.dtstamp.slice(17, 19)), 0, 59)) throw new Error('Invalid public calendar identity');
  return Object.freeze({ uid: input.uid, dtstamp: input.dtstamp });
}
function byteLength(value: string): number {
  let length = 0;
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    length += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
  }
  return length;
}
function foldFile(text: string): string {
  // Only own typed, bounded output is unfolded. No arbitrary ICS is accepted.
  const logical = text.replace(/\r\n[ \t]/g, '').replace(/\r\n$/, '').split('\r\n');
  const physical: string[] = [];
  for (const line of logical) {
    if (!line || /[\r\n]/.test(line)) throw new Error('Invalid calendar line');
    let current = '';
    let bytes = 0;
    for (const character of line) {
      const width = byteLength(character);
      if (bytes + width > 75) { physical.push(current); current = ' '; bytes = 1; }
      current += character;
      bytes += width;
    }
    physical.push(current);
  }
  const output = physical.join('\r\n') + '\r\n';
  if (byteLength(output) > 32 * 1024) throw new Error('Calendar exceeds byte limit');
  return output;
}
/** One portable all-day event. Identity and time are explicit public inputs. */
export function serializeCalendar(input: unknown, publicIdentity: unknown): string {
  const event = accepted(input);
  const identity = validateCalendarIdentity(publicIdentity);
  const calendar = new ICAL.Component('vcalendar');
  calendar.addPropertyWithValue('version', '2.0');
  calendar.addPropertyWithValue('prodid', '-//Prism//All Day Recurrence Builder//EN');
  calendar.addPropertyWithValue('calscale', 'GREGORIAN');
  const component = new ICAL.Component('vevent');
  component.addPropertyWithValue('uid', identity.uid);
  component.addPropertyWithValue('dtstamp', ICAL.Time.fromDateTimeString(identity.dtstamp));
  component.addPropertyWithValue('summary', event.title);
  if (event.description !== undefined) component.addPropertyWithValue('description', event.description);
  for (const [name, value] of [['dtstart', event.startDate], ['dtend', endDate(parseDate(event.startDate)!, event.durationDays)!]]) {
    const property = new ICAL.Property(name!);
    property.resetType('date');
    property.setValue(ICAL.Time.fromDateString(value!));
    component.addProperty(property);
  }
  component.addPropertyWithValue('rrule', ruleFor(event));
  calendar.addSubcomponent(component);
  return foldFile(ICAL.stringify(calendar.toJSON()));
}
