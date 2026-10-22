import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export type SpecName = 'dashboard' | 'smoke' | 'mobile-pwa-settings';
export type Member = { id: string; loginIndex?: number; name: string; role: 'parent' | 'child' };
export type Event = { kind: string; detail?: string | number | boolean };
export type ResponsePlan = { status?: number; data?: unknown; jsonFailure?: Error };
export type Options = {
  enabled?: boolean;
  members?: Member[];
  familyShape?: 'array' | 'wrapped';
  loginMember?: Member;
  failAt?: string;
  failure?: Error;
  holdAt?: string;
  hold?: Promise<void>;
  navigationStatus?: number;
  destinations?: Record<string, string>;
  visible?: Record<string, boolean>;
  counts?: Record<string, number>;
  responses?: Record<string, ResponsePlan>;
};
type Callback = (context: { page: FakePage; browser: { newPage(): Promise<FakePage> }; request: FakeRequest }) => Promise<void>;
type FakeResponse = { ok(): boolean; status(): number; json(): Promise<unknown> };
type FakeRequest = { get(route: string): Promise<FakeResponse>; post(route: string, ignoredPayload: unknown): Promise<FakeResponse> };
type FakeLocator = { first(): FakeLocator; locator(selector: string): FakeLocator; isVisible(): Promise<boolean>; count(): Promise<number>; click(): Promise<void>; selectOption(value: string): Promise<void> };
type FakePage = { goto(route: string): Promise<FakeResponse>; waitForLoadState(state: string): Promise<void>; waitForURL(expected: RegExp): Promise<void>; click(selector: string): Promise<void>; locator(selector: string): FakeLocator; close(): Promise<void>; request: FakeRequest; url(): string };

export const fixtureParent: Member = { id: '', loginIndex: 1, name: 'Fixture Parent', role: 'parent' };
export const fixtureChild: Member = { id: '', loginIndex: 0, name: 'Fixture Child', role: 'child' };

export function deferred(): { promise: Promise<void>; resolve(): void } {
  let done: () => void = () => { throw new Error('Deferred initialization missing'); };
  const promise = new Promise<void>((resolve) => { done = resolve; });
  return { promise, resolve: () => done() };
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

export function loadSpec(spec: SpecName, options: Options = {}) {
  const events: Event[] = [];
  const imports: string[] = [];
  const tests: { name: string; callback: Callback }[] = [];
  const hooks: Record<'beforeAll' | 'beforeEach' | 'afterEach', Callback[]> = { beforeAll: [], beforeEach: [], afterEach: [] };
  const members = options.members ?? [fixtureParent, fixtureChild];
  const failure = options.failure ?? new Error('Synthetic dependency failure');
  const skip = new Error('Synthetic test skip');
  let route = '';
  let menuOpen = false;
  let section = '';
  let session: Member | undefined;
  let closed = false;
  let describeDepth = 0;

  function record(kind: string, detail?: Event['detail']): void {
    events.push(detail === undefined ? { kind } : { kind, detail });
    if (options.failAt === kind) throw failure;
  }
  async function action(kind: string, detail?: Event['detail']): Promise<void> {
    record(kind, detail);
    if (options.holdAt === kind) await options.hold;
  }
  function response(plan: ResponsePlan, label: string): FakeResponse {
    const status = plan.status ?? 200;
    return {
      ok() { record(`status:${label}`, status); return status >= 200 && status < 300; },
      status() { return status; },
      async json() {
        await action(`json:${label}`);
        if (plan.jsonFailure) throw plan.jsonFailure;
        return plan.data;
      },
    };
  }
  const defaults: Record<string, unknown> = {
    '/api/health': { status: 'ok' },
    '/api/family': options.familyShape === 'array' ? members : { members },
    '/api/tasks': { tasks: [{ id: 'fixture-task' }] },
    '/api/chores': { chores: [{ id: 'fixture-chore' }] },
  };
  const request: FakeRequest = {
    async get(target) {
      if (!Object.hasOwn(defaults, target)) throw new Error('Unexpected GET route');
      await action(`get:${target}`);
      return response({ data: defaults[target], ...options.responses?.[target] }, target);
    },
    async post(target, _ignoredPayload) {
      // Auth bodies are deliberately neither inspected nor retained.
      if (target !== '/api/auth/verify-pin') throw new Error('Unexpected POST route');
      await action('verify');
      const status = session?.role === 'parent' ? 200 : 403;
      return response({ status, ...options.responses?.[target] }, target);
    },
  };

  const selectors = new Set(['main', 'nav', '[data-widget]', 'button[aria-label="Open menu"]', 'a[href="/settings"]', '#settings-section-select', 'h2:has-text("Integrations")', '#microsoft', '#google']);
  function locator(selector: string): FakeLocator {
    const option = selector.match(/^#settings-section-select >> option\[value="(integrations|photos)"\]$/);
    if (!selectors.has(selector) && !option) throw new Error('Unexpected locator');
    return {
      first() { return this; },
      locator(child) { return locator(`${selector} >> ${child}`); },
      async isVisible() {
        await action(`visible:${selector}`);
        if (options.visible?.[selector] !== undefined) return options.visible[selector];
        if (selector === 'a[href="/settings"]') return menuOpen;
        if (selector === '#settings-section-select') return route === '/settings';
        if (['h2:has-text("Integrations")', '#microsoft', '#google'].includes(selector)) return route === '/settings' && section === 'integrations';
        return true;
      },
      async count() {
        await action(`count:${selector}`);
        return options.counts?.[selector] ?? 1;
      },
      async click() {
        assert.equal(await this.isVisible(), true, 'Hidden locator cannot be clicked');
        await action(`click:${selector}`);
        if (selector === 'button[aria-label="Open menu"]') menuOpen = true;
        else if (selector === 'a[href="/settings"]') route = options.destinations?.['/settings'] ?? '/settings';
        else throw new Error('Unexpected locator click');
      },
      async selectOption(value) {
        assert.equal(selector, '#settings-section-select', 'Unexpected select target');
        assert.equal(await this.isVisible(), true, 'Hidden select cannot be changed');
        assert.equal(value, 'integrations', 'Unexpected selected value');
        await action('select', value);
        section = value;
      },
    };
  }
  function makePage(temporary = false): FakePage {
    return {
      async goto(target) {
        if (!['/', '/tasks', '/chores'].includes(target)) throw new Error('Unexpected navigation');
        await action('goto', target);
        route = options.destinations?.[target] ?? target;
        return response({ status: options.navigationStatus ?? 200 }, 'navigation');
      },
      async waitForLoadState(state) { assert.equal(state, 'networkidle'); await action('load-state'); },
      async waitForURL(expected) { await action('wait-url'); assert.match(this.url(), expected, 'Destination did not match'); },
      async click(selector) {
        const match = selector.match(/^a\[href="(\/calendar|\/tasks|\/shopping|\/)"\]$/);
        if (!match?.[1]) throw new Error('Unexpected page click');
        const destination = match[1];
        await action(`click:${destination}`);
        route = options.destinations?.[destination] ?? destination;
      },
      locator,
      async close() { if (!temporary) throw new Error('Unexpected fixture page close'); await action('close'); closed = true; },
      request,
      url() { return `http://fixture.invalid${route}`; },
    };
  }
  const page = makePage();
  const temporaryPage = makePage(true);
  const browser = { async newPage() { await action('new-page'); return temporaryPage; } };
  const context = { page, browser, request };
  const test = Object.assign((name: string, callback: Callback) => tests.push({ name, callback }), {
    describe(_name: string, register: () => void) { describeDepth += 1; try { register(); } finally { describeDepth -= 1; } },
    beforeAll(callback: Callback) { hooks.beforeAll.push(callback); },
    beforeEach(callback: Callback) { hooks.beforeEach.push(callback); },
    afterEach(callback: Callback) { hooks.afterEach.push(callback); },
    use(_config: unknown) { assert.equal(describeDepth, 0, 'Device configuration must be at file scope'); },
    skip(condition: boolean, _reason: string) { record('skip', condition); if (condition) throw skip; },
  });
  function fakeExpect(actual: unknown) {
    return {
      async toBeVisible() {
        assert.ok(actual && typeof actual === 'object' && 'isVisible' in actual, 'Expected locator');
        const received = actual as FakeLocator;
        assert.equal(await received.isVisible(), true, 'Expected visible locator');
      },
      async toHaveURL(expected: RegExp) { assert.match((actual as FakePage).url(), expected, 'Destination did not match'); },
      async toHaveCount(expected: number) { assert.equal(await (actual as FakeLocator).count(), expected, 'Unexpected locator count'); },
      toBe(expected: unknown) { assert.equal(actual, expected, 'Unexpected value'); },
      toBeGreaterThan(expected: number) { assert.ok(typeof actual === 'number' && actual > expected, 'Expected greater value'); },
      toHaveProperty(key: string) { assert.ok(actual && typeof actual === 'object' && Object.hasOwn(actual, key), 'Expected own property'); },
    };
  }
  const modules: Record<string, unknown> = {
    '@playwright/test': { test, expect: fakeExpect, devices: { 'iPhone 14': { viewport: { width: 390, height: 664 } } } },
    './helpers/auth': {
      async getFirstParent(received: FakePage) {
        assert.equal(received, temporaryPage);
        await action('parent-lookup');
        const parent = members.find((member) => member.role === 'parent');
        if (!parent) throw new Error('Synthetic roster has no parent');
        return parent;
      },
      async loginViaAPI(received: FakePage, name: string) {
        assert.equal(received, page);
        await action('login', name);
        session = options.loginMember ?? members.find((member) => member.name === name);
        if (!session) throw new Error('Synthetic member missing');
        return session;
      },
      async logout(received: FakePage) { assert.equal(received, page); await action('logout'); session = undefined; },
    },
    './helpers/reset': { resetAll() { record('reset'); } },
  };
  function importModule(name: string): unknown {
    if (!Object.hasOwn(modules, name)) throw new Error('Import denied');
    imports.push(name);
    return modules[name];
  }
  const env = new Proxy(Object.freeze({}), {
    get(_target, key) {
      if (key === 'E2E_HAS_TEST_DB') return options.enabled ? '1' : undefined;
      if (key === 'E2E_PIN') return undefined;
      throw new Error('Environment field denied');
    },
    set() { throw new Error('Environment mutation denied'); },
    ownKeys() { throw new Error('Environment enumeration denied'); },
  });
  const source = readFileSync(path.resolve(__dirname, '../../../e2e', `${spec}.spec.ts`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, {
    require: importModule,
    exports: {},
    process: Object.freeze({ env }),
    fetch() { throw new Error('Network denied'); },
    setTimeout() { throw new Error('Timers denied'); },
    console: Object.freeze({ log() { throw new Error('Logging denied'); }, error() { throw new Error('Logging denied'); } }),
  }, { timeout: 1000, filename: `${spec}.source.vm.js`, contextCodeGeneration: { strings: false, wasm: false } });

  return {
    events, imports, tests, hooks, failure, skip, page, request, importModule,
    get closed() { return closed; },
    get currentPath() { return route; },
    get sessionRole() { return session?.role; },
    async hook(name: keyof typeof hooks) { for (const callback of hooks[name]) await callback(context); },
    async run(name: string) {
      const registered = tests.find((entry) => entry.name === name);
      if (!registered) throw new Error('Unknown registered test');
      await registered.callback(context);
    },
  };
}
