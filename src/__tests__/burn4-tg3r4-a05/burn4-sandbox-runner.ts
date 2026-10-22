import { readFileSync, writeFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import type { CalendarObject, EventRecord, Options, RunTrace } from './burn4-protocol';

type Input = { source: string; options: Options };
const { source, options } = JSON.parse(readFileSync(0, 'utf8')) as Input;
const runs: RunTrace[] = [];
const names = new Set<string>();
let collisions = 0;
let emitted = false;
function emit(): void {
  if (emitted) return;
  emitted = true;
  writeFileSync(1, JSON.stringify({ runs, collisions }));
}

const imports = [
  "import postgres from 'postgres';",
  "import { createDAVClient } from 'tsdav';",
  "import ICAL from 'ical.js';",
  "import { createDecipheriv } from 'node:crypto';",
];
let body = source.replace(/^#![^\n]*\n/, '');
for (const declaration of imports) {
  if (body.split(declaration).length !== 2) throw new Error('Import boundary changed');
  body = body.replace(declaration, '');
}
if (/^\s*import\b|\brequire\s*\(/m.test(body)) throw new Error('Unexpected module access');
if (options.helper) {
  const marker = 'const sql = postgres(process.env.DATABASE_URL);';
  if (body.split(marker).length !== 2) throw new Error('Helper boundary changed');
  body = body.split(marker)[0] + (options.helper === 'decrypt'
    ? '\nreturn String(decrypt(undefined));'
    : '\nreturn buildVEventICalString(__helperArgs);');
}

async function execute(index: number): Promise<void> {
  const trace: RunTrace = { calls: [], logs: [], errors: [], envReads: [], components: [], pauses: [] };
  runs.push(trace);
  function record(name: string, detail?: unknown): void {
    trace.calls.push(detail === undefined ? { name } : { name, detail });
    if (options.fail === name) throw new Error(`fixture failure: ${name}`);
  }
  async function stage<T>(name: string, detail: unknown, response: () => T): Promise<T> {
    record(name, detail);
    if (options.defer === name) {
      await Promise.resolve();
      trace.pauses.push({ stage: name, calls: trace.calls.map(call => call.name) });
    }
    return response();
  }
  const forbidden = (name: string): (() => never) => function blockedBoundary(): never { throw new Error(`Forbidden boundary: ${name}`); };
  const safeLog = (args: unknown[]): string => args.map(arg => String(arg).replace(/[^\x20-\x7e\n]/g, '?')).join(' ');
  const env = new Proxy(Object.create(null) as Record<string, undefined>, {
    get: (_target, property: string) => {
      if (!['DATABASE_URL', 'ENCRYPTION_KEY', 'PIN_ENCRYPTION_KEY'].includes(property)) throw new Error('Unexpected environment lookup');
      trace.envReads.push(property);
      return undefined;
    },
    ownKeys: forbidden('environment enumeration'),
    set: forbidden('environment write'),
  });
  const fakeProcess = Object.freeze({
    argv: Object.freeze(options.missingArg ? ['node', 'offline-script'] : ['node', 'offline-script', 'fixture-source']),
    env,
    exit: (code: number): never => {
      trace.exit = code;
      emit();
      process.exit(code);
    },
  });
  let fromCalls = 0;
  const inertKey = Object.freeze({ kind: 'inert' });
  const inertIv = Object.freeze({ kind: 'inert' });
  const inertTag = Object.freeze({ kind: 'inert' });
  const inertCipher = Object.freeze({ kind: 'inert' });
  const fakeBuffer = Object.freeze({
    from: (value: unknown, encoding: string): unknown => {
      if (value !== undefined) throw new Error('Material must be absent');
      fromCalls += 1;
      if (fromCalls === 1) {
        if (encoding !== 'hex') throw new Error('Unexpected key encoding');
        record('buffer:key');
        return inertKey;
      }
      if (fromCalls !== 2 || encoding !== 'base64') throw new Error('Unexpected buffer conversion');
      record('buffer:data');
      return Object.freeze({
        subarray: (start: number, end?: number): unknown => {
          if (start === 0 && end === 12) { record('buffer:iv', [start, end]); return inertIv; }
          if (start === 12 && end === 28) { record('buffer:tag', [start, end]); return inertTag; }
          if (start === 28 && end === undefined) { record('buffer:cipher', [start]); return inertCipher; }
          throw new Error('Unexpected cipher slice');
        },
      });
    },
  });
  const createDecipheriv = (algorithm: string, key: unknown, iv: unknown): unknown => {
    if (key !== inertKey || iv !== inertIv) throw new Error('Unexpected inert inputs');
    record('crypto:create', algorithm);
    return Object.freeze({
      setAuthTag: (tag: unknown): void => { if (tag !== inertTag) throw new Error('Unexpected tag'); record('crypto:tag'); },
      update: (cipher: unknown): undefined => { if (cipher !== inertCipher) throw new Error('Unexpected cipher'); record('crypto:update'); return undefined; },
      final: (encoding: string): undefined => { record('crypto:final', encoding); return undefined; },
    });
  };
  const millis = Date.UTC(2026, 9, 21, 12, 34, 56) + index * (options.timeOffset ?? 0);
  class FixedDate extends Date {
    constructor(value: number = millis) { super(value); }
    static now(): number { return millis; }
  }
  class Component {
    record: EventRecord = { properties: {}, components: [] };
    constructor(kind: unknown) {
      record('ical:component', Array.isArray(kind) ? kind[0] : kind);
      trace.components.push(this.record);
    }
    updatePropertyWithValue(name: string, value: unknown): void {
      if (name === 'description' || name === 'location') this.record.properties[name] = Boolean(value);
      else this.record.properties[name] = value;
    }
    addSubcomponent(component: Component): void { this.record.components.push(component.record); }
    toString(): string {
      const event = this.record.components[0];
      if (!event) throw new Error('Expected event component');
      return `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${String(event.properties.uid)}\r\nSUMMARY:${String(event.properties.summary)}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    }
  }
  const ICAL = Object.freeze({
    Component,
    Timezone: Object.freeze({ utcTimezone: 'UTC' }),
    Time: Object.freeze({
      now: () => { record('ical:now'); return { zone: 'fixture-zone' }; },
      fromJSDate: (date: Date, utc: boolean) => { record('ical:date', { milliseconds: date.getTime(), utc, localHour: date.getHours(), localMinute: date.getMinutes() }); return { milliseconds: date.getTime(), utc }; },
    }),
  });
  const calendarUrl = options.calendarUrl ?? 'https://calendar.example.invalid/fixture/';
  const calendar = Object.freeze({ url: calendarUrl });
  let filename = '';
  let uid = '';
  let readCount = 0;
  const eventUrl = (): string => options.readback === 'data' ? `${calendarUrl}opaque.ics` : `${calendarUrl}${filename}`;
  function objectForRead(): CalendarObject[] {
    readCount += 1;
    if (readCount === options.missingRead) return [];
    if (readCount === 3) {
      if (options.finalRead === 'present-url') return [{ url: `${calendarUrl}${filename}` }];
      if (options.finalRead === 'present-data') return [{ url: `${calendarUrl}opaque.ics`, data: `UID:${uid}` }];
      return [];
    }
    let data = `UID:${uid}\r\nSUMMARY:Prism CalDAV smoke test${readCount === 2 ? ' (UPDATED)' : ''}\r\n`;
    if (readCount === 2) {
      if (options.readData === 'no-summary') data = `UID:${uid}\r\n`;
      if (options.readData === 'stale') data = `UID:${uid}\r\nSUMMARY:Prism CalDAV smoke test\r\n`;
      if (options.readData === 'unrelated') data = `UID:${uid}\r\nSUMMARY:NOT UPDATED\r\n`;
      if (options.readData === 'folded') data = `UID:${uid}\r\nSUMMARY:Prism CalDAV smoke test (UP\r\n DATED)\r\n`;
    }
    return [{ url: eventUrl(), etag: `revision-${readCount}`, ...((options.readData === 'missing' && readCount === 2) || (options.firstDataMissing && readCount === 1) ? {} : { data }) }];
  }
  const response = (operation: string): unknown => ({
    ok: options.responseFailure !== operation,
    status: options.responseFailure === operation ? 500 : 200,
    statusText: 'Fixture response',
    headers: { get: (name: string) => { record('create:header', name); return options.location === undefined ? `${calendarUrl}assigned.ics` : options.location; } },
  });
  const client = Object.freeze({
    fetchCalendars: () => stage('dav:calendars', undefined, () => options.noCalendar ? [{ url: `${calendarUrl}different` }] : [calendar]),
    createCalendarObject: (args: { calendar: unknown; iCalString: string; filename: string }) => stage('dav:create', args, () => {
      filename = args.filename;
      uid = filename.slice(0, -4);
      if (names.has(filename)) collisions += 1;
      names.add(filename);
      return response('create');
    }),
    fetchCalendarObjects: (args: unknown) => stage(`dav:read${readCount + 1}`, args, () => {
      const objects = objectForRead();
      record('readback:result', objects);
      return objects;
    }),
    updateCalendarObject: (args: unknown) => stage('dav:update', args, () => response('update')),
    deleteCalendarObject: (args: unknown) => stage('dav:delete', args, () => response('delete')),
  });
  const createDAVClient = (args: { serverUrl?: string; credentials: { username?: unknown; password: unknown }; authMethod: string; defaultAccountType: string }) => {
    if (args.credentials.username !== undefined || !Number.isNaN(args.credentials.password)) throw new Error('Authentication material forbidden');
    return stage('dav:connect', { serverUrl: args.serverUrl, credentialValuesAbsent: true, authMethod: args.authMethod, defaultAccountType: args.defaultAccountType }, () => client);
  };
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => stage('sql:query', { text: strings.join('?'), values }, () => options.noSource ? [] : [{
      display_name: 'Fixture calendar',
      source_calendar_id: calendarUrl,
      provider_config: options.config === undefined ? { serverUrl: 'https://dav.example.invalid' } : options.config,
    }]),
    { end: async (): Promise<void> => { record('sql:end'); if (options.endFails) throw new Error('fixture failure: sql:end'); } },
  );
  const postgres = (value: unknown): typeof sql => {
    if (value !== undefined) throw new Error('Database environment value forbidden');
    record('sql:open');
    return sql;
  };
  const timer = (callback: () => void, delay: number): number => {
    record('timer:scheduled', delay);
    Promise.resolve().then(() => { record('timer:fired', delay); callback(); });
    return 1;
  };
  const context = createContext({
    process: fakeProcess, Buffer: fakeBuffer, postgres, createDAVClient, ICAL, createDecipheriv,
    Date: FixedDate, URL, setTimeout: timer,
    console: Object.freeze({ log: (...args: unknown[]) => trace.logs.push(safeLog(args)), error: (...args: unknown[]) => trace.errors.push(safeLog(args)) }),
    fetch: forbidden('fetch'), XMLHttpRequest: forbidden('XMLHttpRequest'), WebSocket: forbidden('WebSocket'), require: forbidden('require'),
    __helperArgs: { uid: 'fixture-event', title: 'Fixture title', startTime: new FixedDate(millis), endTime: new FixedDate(millis + 1800000), ...(options.optionalFields ? { description: 'Fixture description', location: 'Fixture room' } : {}) },
  }, { codeGeneration: { strings: false, wasm: false } });
  try {
    if (options.forbiddenProbe) new Script(options.forbiddenProbe).runInContext(context, { timeout: 1000 });
    const value: unknown = await new Script(`(async () => {${body}\n})()`, { filename: 'offline-caldav-smoke.js' }).runInContext(context, { timeout: 1000 });
    if (options.helper) trace.helper = String(value);
    trace.done = true;
  } catch (error) {
    trace.error = error instanceof Error ? error.message : String(error);
  }
}
Promise.all(Array.from({ length: options.copies ?? 1 }, (_, index) => execute(index)))
  .then(emit, error => { writeFileSync(2, String(error)); process.exit(2); });
