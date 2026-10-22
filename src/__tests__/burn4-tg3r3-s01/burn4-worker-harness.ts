import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';

export const fixedNow = '2026-03-18T12:34:56.000Z';
export const defaultReleaseUrl = 'https://api.github.com/repos/sandydargoport/prism/releases/latest';

type DbCall = { sql: string; bindings: unknown[]; operation: 'run' | 'first' | 'all'; column?: string };
type Row = { id: string; version: unknown; deployment: unknown; arch: unknown; first_seen: unknown; last_seen: unknown };
export type WorkerRequest = { url: string; method: string; json: () => Promise<unknown> };
type Statement = {
  bind: (...values: unknown[]) => Statement;
  run: () => Promise<unknown>;
  first: (column: string) => Promise<unknown>;
  all: () => Promise<{ results: unknown }>;
};
type WorkerEnv = { DB: { prepare: (sql: string) => Statement }; GITHUB_REPO?: string; STATS_TOKEN?: symbol };
type Worker = { fetch: (request: WorkerRequest, env: WorkerEnv) => Promise<Response> };

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

/** Only this source file is read. The VM receives no process, require or real fetch. */
export function createHarness() {
  const calls: DbCall[] = [];
  const rows = new Map<string, Row>();
  const stored = new Map<string, Response>();
  const authorizedComparison = Symbol('opaque equality marker');
  let selectedComparison: symbol | null = null;
  let now = fixedNow;
  const database = {
    run: jest.fn<Promise<unknown>, [DbCall]>(async () => undefined),
    first: jest.fn<Promise<unknown>, [DbCall]>(async () => 0),
    all: jest.fn<Promise<{ results: unknown }>, [DbCall]>(async () => ({ results: [] })),
  };
  const prepare = jest.fn<Statement, [string]>((sql) => {
    let bindings: unknown[] = [];
    const statement: Statement = {
      bind: (...values) => { bindings = values; return statement; },
      run: async () => {
        const call: DbCall = { sql, bindings, operation: 'run' };
        calls.push(call);
        const result = await database.run(call);
        const [id, version, deployment, arch, timestamp] = bindings;
        if (typeof id !== 'string') throw new Error('D1 fixture expects a string install id');
        const prior = rows.get(id);
        rows.set(id, { id, version, deployment, arch, first_seen: prior?.first_seen ?? timestamp, last_seen: timestamp });
        return result;
      },
      first: async (column) => {
        const call: DbCall = { sql, bindings, operation: 'first', column };
        calls.push(call);
        return database.first(call);
      },
      all: async () => {
        const call: DbCall = { sql, bindings, operation: 'all' };
        calls.push(call);
        return database.all(call);
      },
    };
    return statement;
  });
  const cache = {
    match: jest.fn<Promise<Response | undefined>, [Request]>(async (key) => stored.get(key.url)?.clone()),
    put: jest.fn<Promise<void>, [Request, Response]>(async (key, response) => { stored.set(key.url, response.clone()); }),
  };
  const origin = jest.fn<Promise<Response>, [string, Record<string, unknown>]>(async () => new Response(JSON.stringify({ tag_name: 'v1.20.0' })));
  const logs = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  class FixtureURL {
    readonly pathname: string;
    readonly searchParams: { get: (key: string) => unknown };
    constructor(input: string) {
      const parsed = new URL(input);
      this.pathname = parsed.pathname;
      this.searchParams = { get: (key) => key === 'token' ? selectedComparison : parsed.searchParams.get(key) };
    }
  }
  class FixtureDate extends Date {
    constructor() { super(now); }
    static now() { return new Date(now).getTime(); }
  }
  const sandbox: { __worker?: Worker } = {};
  Object.assign(sandbox, {
    URL: FixtureURL, Request, Response, Date: FixtureDate,
    fetch: origin, caches: { default: cache }, console: logs,
  });
  const sourcePath = resolve(__dirname, '../../..', 'collector/worker.js');
  const source = readFileSync(sourcePath, 'utf8');
  if ((source.match(/export default/g) ?? []).length !== 1) throw new Error('Worker module export shape changed');
  new Script(source.replace('export default', 'globalThis.__worker ='), { filename: 'collector/worker.js' })
    .runInContext(createContext(sandbox), { timeout: 1000 });
  const worker = sandbox.__worker;
  if (!worker) throw new Error('Worker export missing');
  const env: WorkerEnv = { DB: { prepare } };
  const request = (path = '/', method = 'POST', body: unknown = { id: 'fixture-install' }): WorkerRequest => {
    const item: WorkerRequest = { url: `https://collector.invalid${path}`, method, json: jest.fn(async () => body) };
    for (const field of ['headers', 'cf', 'ip', 'cookies']) {
      Object.defineProperty(item, field, { get() { throw new Error(`Privacy boundary read: ${field}`); } });
    }
    return item;
  };
  return {
    calls, rows, stored, database, prepare, cache, origin, logs, env, request,
    run: (item = request()) => worker.fetch(item, env),
    authorizeStats: () => { env.STATS_TOKEN = authorizedComparison; selectedComparison = authorizedComparison; },
    mismatchStats: () => { env.STATS_TOKEN = authorizedComparison; selectedComparison = Symbol('different opaque marker'); },
    setNow: (value: string) => { now = value; },
  };
}
