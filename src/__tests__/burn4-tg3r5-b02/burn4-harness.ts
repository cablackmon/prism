import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { JSDOM } from 'jsdom';

export const sources = ['traffic/index.html', 'docs/traffic/index.html'] as const;
export type Source = (typeof sources)[number];
export type Day = { count: number; uniques: number };
export type Referrer = { referrer: string; count: number; uniques: number };
export type History = {
  views: Record<string, Day>;
  clones?: Record<string, Day>;
  referrers?: Referrer[];
  referrer_history?: Record<string, Referrer[] | null>;
  window_uniques?: Record<string, number | null>;
  updated_at: string;
};
export type Reply = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};
export type FetchStep = Reply | Error | (() => Promise<Reply>);
export type ChartConfig = {
  type: string;
  data: {
    labels: string[];
    datasets: { label: string; data: (number | null)[]; type?: string; spanGaps?: boolean }[];
  };
  options: { responsive: boolean; scales: { y: { beginAtZero: boolean } } };
};
export type ChartCall = { canvas: Element; config: ChartConfig };
export type FetchCall = { url: string; options?: { cache?: string } };

export function history(overrides: Partial<History> = {}): History {
  return {
    views: {
      '2026-01-03': { count: 17, uniques: 4 },
      '2026-01-01': { count: 8, uniques: 3 },
    },
    clones: { '2026-01-02': { count: 5, uniques: 2 } },
    referrers: [{ referrer: 'search.example', count: 6, uniques: 3 }],
    updated_at: '2026-01-03T12:00:00Z',
    ...overrides,
  };
}

export function reply(data: unknown, options: { ok?: boolean; status?: number; jsonError?: unknown } = {}): Reply {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: jest.fn(async () => {
      if (options.jsonError !== undefined) throw options.jsonError;
      return data;
    }),
  };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const openDoms: JSDOM[] = [];
export function closeDashboards(): void {
  for (const dom of openDoms.splice(0)) dom.window.close();
}

export function dashboard(source: Source, steps: FetchStep[], options: {
  removeStatus?: boolean;
  chartError?: Error;
} = {}) {
  const html = readFileSync(resolve(__dirname, '../../..', source), 'utf8');
  // jsdom does not run scripts or load resources. Only the inline source below
  // executes, inside a separate VM whose fetch and Chart are inert fixtures.
  const dom = new JSDOM(html);
  openDoms.push(dom);
  const document = dom.window.document;
  const inline = [...document.querySelectorAll('script:not([src])')];
  if (inline.length !== 1) throw new Error(`Expected one inline runtime in ${source}`);
  const script = inline[0]?.textContent;
  if (!script) throw new Error(`Missing inline runtime in ${source}`);
  if (options.removeStatus) document.getElementById('updated')?.remove();

  const fetchCalls: FetchCall[] = [];
  const charts: ChartCall[] = [];
  const errors: unknown[][] = [];
  const queue = [...steps];
  class Clock extends Date {
    constructor(value: string | number = '2026-01-03T12:00:00Z') { super(value); }
    static now(): number { return 1767441600000; }
    toLocaleString(): string { return Number.isNaN(this.getTime()) ? 'Invalid Date' : this.toISOString(); }
  }
  const context = createContext({
    document,
    Date: Clock,
    console: { error: (...values: unknown[]) => { errors.push(values); } },
    fetch: async (url: string, fetchOptions?: { cache?: string }): Promise<Reply> => {
      fetchCalls.push({ url, ...(fetchOptions ? { options: { ...fetchOptions } } : {}) });
      const step = queue.shift();
      if (!step) throw new Error('Unplanned fake fetch');
      if (step instanceof Error) throw step;
      return typeof step === 'function' ? step() : step;
    },
    Chart: function FakeChart(canvas: Element, config: ChartConfig): void {
      if (options.chartError) throw options.chartError;
      charts.push({ canvas, config: JSON.parse(JSON.stringify(config)) as ChartConfig });
    },
    setTimeout: () => { throw new Error('Unexpected timer'); },
    setInterval: () => { throw new Error('Unexpected timer'); },
  }, { codeGeneration: { strings: false, wasm: false } });
  const initial = runInContext(script, context, { filename: source, timeout: 1000 }) as Promise<void>;

  return {
    document,
    fetchCalls,
    charts,
    errors,
    initial,
    text: (id: string): string | null => document.getElementById(id)?.textContent ?? null,
    rows: (table: string): string[][] => [...document.querySelectorAll(`#${table} tbody tr`)]
      .map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent ?? '')),
    reload: (): Promise<void> => runInContext('main()', context, { timeout: 1000 }) as Promise<void>,
    setStatus: (message: string): void => {
      const fn = runInContext('setStatus', context, { timeout: 1000 }) as (value: string) => void;
      fn(message);
    },
    runtimeHas: (name: string): boolean => runInContext(`typeof ${name} !== "undefined"`, context) as boolean,
  };
}

export async function loaded(source: Source, data: unknown = history()) {
  const page = dashboard(source, [reply(data)]);
  await page.initial;
  return page;
}
