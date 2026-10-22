import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';

export const demoFiles = {
  dashboard: '01-dashboard-overview.spec.ts',
  theme: '02-light-dark-toggle.spec.ts',
  chore: '03-chore-celebration.spec.ts',
  grocery: '04-grocery-shopping.spec.ts',
  recipe: '05-recipe-view.spec.ts',
  away: '06-away-mode.spec.ts',
  babysitter: '07-babysitter-mode.spec.ts',
} as const;

export type Demo = keyof typeof demoFiles;
export type Action = { kind: string; target: string; value?: unknown }
type Match = { kind: string; target?: string; occurrence?: number }
export type Gate = { wait: Promise<void> } & Match
export type Fault = { error: Error } & Match
export type Options = {
  faults?: readonly Fault[];
  gates?: readonly Gate[];
  counts?: Readonly<Record<string, readonly number[]>>;
  ingredientCount?: number;
  groceries?: readonly string[];
  recipes?: readonly string[];
  status?: number;
  memberId?: string;
}
type Locator = {
  filter(options: { hasText: string | RegExp }): Locator;
  first(): Locator;
  nth(index: number): Locator;
  or(other: Locator): Locator;
  locator(selector: string): Locator;
  count(): Promise<number>;
  click(options?: { force?: boolean; timeout?: number }): Promise<void>;
  waitFor(options: { state: string; timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
}
type ModeEvent = { type: string; detail: { enabled: boolean } }
type Run = {
  actions: Action[];
  run(): Promise<void>;
  elapsed(): number;
}

function strict<T extends object>(value: T, label: string): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      if (property === 'then') return undefined;
      if (!Object.prototype.hasOwnProperty.call(target, property)) {
        throw new Error(`Denied ${label} property: ${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function makeRun(source: string, options: Options): Run {
  const actions: Action[] = [];
  const seen = new Map<string, number>();
  const counted = new Map<string, number>();
  const locatorPaths = new WeakMap<Locator, string>();
  let elapsed = 0;
  let callback: ((context: { page: unknown }) => Promise<void>) | undefined;

  async function step(kind: string, target = '', value?: unknown): Promise<void> {
    actions.push(value === undefined ? { kind, target } : { kind, target, value });
    const key = `${kind}:${target}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const matches = (candidate: Match) => candidate.kind === kind &&
      (candidate.target === undefined || candidate.target === target) &&
      (candidate.occurrence === undefined || candidate.occurrence === occurrence);
    const fault = options.faults?.find(matches);
    if (fault) throw fault.error;
    const gate = options.gates?.find(matches);
    if (gate) await gate.wait;
  }

  function locator(path: string, item?: { kind: 'grocery' | 'recipe'; name: string }): Locator {
    const result: Locator = strict({
      filter: (filter: { hasText: string | RegExp }) => locator(`${path}.filter(${String(filter.hasText)})`, item),
      first: () => locator(`${path}.first`, item),
      nth: (index: number) => locator(`${path}.nth(${index})`, item),
      or: (other: Locator) => {
        const otherPath = locatorPaths.get(other);
        if (!otherPath) throw new Error('Denied foreign locator');
        return locator(`${path}.or(${otherPath})`, item);
      },
      locator: (selector: string) => locator(`${path} >> ${selector}`),
      count: async () => {
        await step('count', path);
        const values = options.counts?.[path];
        const index = counted.get(path) ?? 0;
        counted.set(path, index + 1);
        if (values) {
          const value = values[Math.min(index, values.length - 1)];
          if (value === undefined) throw new Error('Empty fake count schedule');
          return value;
        }
        return path.endsWith('ul.space-y-1 > li') ? options.ingredientCount ?? 6 : 1;
      },
      click: async (clickOptions?: { force?: boolean; timeout?: number }) => {
        await step('click', path, clickOptions);
      },
      waitFor: async (waitOptions: { state: string; timeout?: number }) => {
        await step('visible', path, waitOptions);
        const available = item?.kind === 'grocery' ? options.groceries : options.recipes;
        if (item && available && !available.includes(item.name)) {
          throw new Error(`Missing synthetic ${item.kind}: ${item.name}`);
        }
      },
      scrollIntoViewIfNeeded: async () => { await step('scroll', path); },
    }, 'locator');
    locatorPaths.set(result, path);
    return result;
  }

  const page = strict({
    goto: async (path: string) => { await step('goto', path); },
    waitForLoadState: async (state: string) => { await step('ready', state); },
    waitForTimeout: async (duration: number) => {
      await step('wait', '', duration);
      elapsed += duration;
    },
    hover: async (selector: string) => { await step('hover', selector); },
    click: async (selector: string) => { await step('click', selector); },
    mouse: strict({ move: async (x: number, y: number) => { await step('move', '', [x, y]); } }, 'mouse'),
    keyboard: strict({ press: async (key: string) => { await step('key', key); } }, 'keyboard'),
    locator: (selector: string, locatorOptions?: { hasText: string }) => {
      const path = locatorOptions ? `${selector}.text(${locatorOptions.hasText})` : selector;
      return locator(path, selector.startsWith('text=') ? { kind: 'recipe', name: selector.slice(5) } : undefined);
    },
    getByText: (name: string, textOptions: { exact: boolean }) => {
      if (textOptions.exact !== false) throw new Error('Unexpected text matching contract');
      return locator(`text(${name})`, { kind: 'grocery', name });
    },
    waitForSelector: async (selector: string, selectorOptions: { timeout: number }) => {
      await step('selector', selector, selectorOptions);
    },
    request: strict({
      post: async (path: string, request: { data: { enabled: boolean; enabledBy: string; autoActivated?: boolean } }) => {
        if (!['/api/away-mode', '/api/babysitter-mode'].includes(path)) throw new Error(`Denied request path: ${path}`);
        const { enabled, enabledBy, autoActivated } = request.data;
        const keys = Object.keys(request.data);
        if (keys.some(key => !['enabled', 'enabledBy', 'autoActivated'].includes(key))) throw new Error('Denied request data field');
        await step('post', path, { enabled, enabledBy, ...(autoActivated === undefined ? {} : { autoActivated }) });
        return strict({
          ok: () => (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
          status: () => options.status ?? 200,
        }, 'response');
      },
    }, 'request'),
    evaluate: async (fn: () => void) => {
      await step('evaluate');
      const context = createContext({
        window: strict({ dispatchEvent: (event: ModeEvent) => {
          if (!['prism:away-mode-change', 'prism:babysitter-mode-change'].includes(event.type)) throw new Error('Denied event type');
          actions.push({ kind: 'dispatch', target: event.type, value: { enabled: event.detail.enabled } });
          return true;
        } }, 'window'),
        CustomEvent: class {
          type: string;
          detail: { enabled: boolean };
          constructor(type: string, eventOptions: { detail: { enabled: boolean } }) {
            this.type = type;
            this.detail = eventOptions.detail;
          }
        },
      });
      new Script(`(${fn.toString()})()`).runInContext(context, { timeout: 1000 });
    },
  }, 'page');

  const register = new Proxy((_title: string, body: typeof callback) => {
    if (callback || typeof body !== 'function') throw new Error('Expected exactly one demo callback');
    callback = body;
  }, { get: (_target, key) => { throw new Error(`Denied test hook: ${String(key)}`); } });
  const imports: Record<string, unknown> = {
    '@playwright/test': strict({ test: register }, 'Playwright import'),
    '../helpers/auth': strict({ loginViaAPI: async () => {
      await step('login');
      return { id: options.memberId ?? 'synthetic-member' };
    } }, 'auth import'),
    '../helpers/reset': strict({
      resetDemoData: () => {
        actions.push({ kind: 'reset', target: '' });
        const fault = options.faults?.find(candidate => candidate.kind === 'reset');
        if (fault) throw fault.error;
      },
      seedBabysitterInfo: () => {
        actions.push({ kind: 'seed', target: '' });
        const fault = options.faults?.find(candidate => candidate.kind === 'seed');
        if (fault) throw fault.error;
      },
    }, 'reset import'),
  };
  const context = createContext({
    exports: {},
    require: (id: string) => {
      if (!Object.prototype.hasOwnProperty.call(imports, id)) throw new Error(`Denied import: ${id}`);
      return imports[id];
    },
  });
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  new Script(compiled.outputText).runInContext(context, { timeout: 1000 });
  if (!callback) throw new Error('Missing demo callback');
  const body = callback;
  return { actions, run: () => body({ page }), elapsed: () => elapsed };
}

export function loadDemo(demo: Demo, options: Options = {}, rewrite?: (source: string) => string): Run {
  if (!Object.prototype.hasOwnProperty.call(demoFiles, demo)) throw new Error('Denied demo source');
  const filename = demoFiles[demo];
  if (!filename) throw new Error('Denied demo source');
  const path = resolve(__dirname, '../../../e2e/demos/scenarios', filename);
  const source = readFileSync(path, 'utf8');
  return makeRun(rewrite ? rewrite(source) : source, options);
}

// Synthetic snippets exercise denial boundaries without reading another module.
export function loadSynthetic(source: string, options: Options = {}): Run {
  return makeRun(source, options);
}
