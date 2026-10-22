import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export type Source = 'modes' | 'settings';
export type Hook = 'beforeAll' | 'beforeEach' | 'afterEach';
type Pattern = string | RegExp;
type Query =
  | { kind: 'selector'; selector: string; hasText?: Pattern }
  | { kind: 'role'; role: string; name: Pattern }
  | { kind: 'text'; text: Pattern };

export interface Member {
  id: string;
  name: string;
}

export interface ResponsePlan {
  ok?: boolean;
  body?: unknown;
  requestError?: Error;
  jsonError?: Error;
}

interface Element {
  key: string;
  text: string;
  visible: boolean;
  role?: string;
  tag?: string;
  classes?: string[];
  section?: string;
}

interface Fixtures {
  page: FakePage;
  browser: { newPage: () => Promise<FakePage> };
}

type Callback = (fixtures: Fixtures) => Promise<void>;

export interface VisibilityAssertion {
  query: string;
  timeout: number | undefined;
  first: boolean;
}

function matches(text: string, pattern: Pattern): boolean {
  // RegExp instances originate in the VM realm; do not use instanceof here.
  return typeof pattern === 'string'
    ? text.includes(pattern)
    : new RegExp(pattern.source, pattern.flags).test(text);
}

function describePattern(pattern: Pattern): string {
  return typeof pattern === 'string' ? pattern : `/${pattern.source}/${pattern.flags}`;
}

function describeQuery(query: Query): string {
  if (query.kind === 'role') return `role:${query.role}:${describePattern(query.name)}`;
  if (query.kind === 'text') return `text:${describePattern(query.text)}`;
  return `selector:${query.selector}${query.hasText ? `:${describePattern(query.hasText)}` : ''}`;
}

class Locator {
  constructor(
    readonly harness: ScenarioHarness,
    readonly query: Query,
    readonly firstOnly = false,
  ) {}

  first(): Locator {
    return new Locator(this.harness, this.query, true);
  }

  elements(): Element[] {
    const query = this.query;
    const selected = this.harness.elements().filter((element) => {
      if (query.kind === 'text') return matches(element.text, query.text);
      if (query.kind === 'role') {
        return element.role === query.role && matches(element.text, query.name);
      }
      const selector = query.selector.replaceAll('\\', '');
      const selectorMatches = selector.startsWith('.')
        ? element.classes?.includes(selector.slice(1)) === true
        : element.tag === selector;
      return selectorMatches && (query.hasText === undefined || matches(element.text, query.hasText));
    });
    return this.firstOnly ? selected.slice(0, 1) : selected;
  }

  one(): Element {
    const elements = this.elements();
    assert.equal(elements.length, 1, `locator must resolve once: ${describeQuery(this.query)}`);
    const element = elements[0];
    assert.ok(element);
    return element;
  }

  async click(): Promise<void> {
    const description = describeQuery(this.query);
    this.harness.step(`click:${description}`);
    const element = this.one();
    assert.equal(element.visible, true, `cannot click hidden ${element.key}`);
    if (element.section !== undefined) this.harness.section = element.section;
  }
}

class FakePage {
  constructor(readonly harness: ScenarioHarness, readonly identity: 'setup' | 'scenario') {}

  readonly request = {
    post: async (path: string, options: { data: { enabled: unknown } }) =>
      this.harness.response('POST', path, options.data.enabled),
    get: async (path: string) => this.harness.response('GET', path),
  };

  async close(): Promise<void> {
    this.harness.step(`close:${this.identity}`);
    this.harness.closedPages.push(this);
  }

  async goto(path: string): Promise<void> {
    this.harness.step(`goto:${path}`);
    this.harness.route = path;
  }

  async waitForLoadState(state: string): Promise<void> {
    this.harness.step(`load:${state}`);
  }

  locator(selector: string, options?: { hasText?: Pattern }): Locator {
    return new Locator(this.harness, { kind: 'selector', selector, hasText: options?.hasText });
  }

  getByRole(role: string, options: { name: Pattern }): Locator {
    return new Locator(this.harness, { kind: 'role', role, name: options.name });
  }

  getByText(text: Pattern): Locator {
    return new Locator(this.harness, { kind: 'text', text });
  }
}

/** Executes only the original two eligible registration modules and callbacks. */
export class ScenarioHarness {
  readonly events: string[] = [];
  readonly imports: string[] = [];
  readonly scenarios = new Map<string, Callback>();
  readonly hooks: Record<Hook, Callback[]> = { beforeAll: [], beforeEach: [], afterEach: [] };
  readonly closedPages: FakePage[] = [];
  readonly visibility: VisibilityAssertion[] = [];
  readonly failures = new Map<string, Error>();
  readonly plans = { POST: [] as ResponsePlan[], GET: [] as ResponsePlan[] };
  readonly page = new FakePage(this, 'scenario');
  readonly setupPage = new FakePage(this, 'setup');
  readonly fixtures: Fixtures = {
    page: this.page,
    browser: {
      newPage: async () => {
        this.step('newPage');
        return this.setupPage;
      },
    },
  };
  parent: Member = { id: 'parent-fixture', name: 'Fixture Parent' };
  members: Member[] = [this.parent, { id: 'child-fixture', name: 'Fixture Child' }];
  displayedMembers: string[] = this.members.map((member) => member.name);
  readonly hidden = new Set<string>();
  route = '';
  section = 'Family Members';
  heading = 'Settings';
  themeText = 'Theme';
  versionText = '1.19.0';
  away = false;
  babysitter = false;
  suiteName = '';

  constructor(readonly source: Source) {
    assert.ok(source === 'modes' || source === 'settings', 'only the two eligible sources may load');
    const path = resolve(__dirname, '../../..', `e2e/${source}.spec.ts`);
    const original = readFileSync(path, 'utf8');
    const compiled = ts.transpileModule(original, {
      fileName: path,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const register = (title: string, callback: Callback) => {
      assert.equal(this.scenarios.has(title), false, `duplicate scenario ${title}`);
      this.scenarios.set(title, callback);
    };
    const test = Object.assign(register, {
      describe: (title: string, callback: () => void) => {
        this.suiteName = title;
        callback();
      },
      beforeAll: (callback: Callback) => this.hooks.beforeAll.push(callback),
      beforeEach: (callback: Callback) => this.hooks.beforeEach.push(callback),
      afterEach: (callback: Callback) => this.hooks.afterEach.push(callback),
    });
    const fakeExpect = (actual: unknown) => ({
      toBe: (expected: unknown) => assert.strictEqual(actual, expected),
      toBeVisible: async (options?: { timeout?: number }) => {
        assert.ok(actual instanceof Locator, 'visibility requires an owned locator');
        this.visibility.push({
          query: describeQuery(actual.query),
          timeout: options?.timeout,
          first: actual.firstOnly,
        });
        this.step(`visible:${describeQuery(actual.query)}`);
        const element = actual.one();
        assert.equal(element.visible, true, `expected visible ${element.key}`);
      },
      toContainText: async (text: string) => {
        assert.ok(actual instanceof Locator, 'text assertion requires an owned locator');
        this.step(`contains:${describeQuery(actual.query)}`);
        assert.equal(actual.one().text.includes(text), true, `expected text ${text}`);
      },
    });
    const auth = {
      getFirstParent: async (page: FakePage) => {
        assert.equal(page, this.setupPage);
        this.step('getFirstParent');
        return this.parent;
      },
      getFamilyMembers: async (page: FakePage) => {
        assert.equal(page, this.setupPage);
        this.step('getFamilyMembers');
        return this.members;
      },
      loginViaAPI: async (page: FakePage, name: string) => {
        assert.equal(page, this.page);
        this.step(`login:${name}`);
      },
      logout: async (page: FakePage) => {
        assert.equal(page, this.page);
        this.step('logout');
      },
    };
    const replacements: Readonly<Record<string, unknown>> = {
      '@playwright/test': { test, expect: fakeExpect },
      './helpers/auth': auth,
      './helpers/reset': {
        resetModes: () => {
          this.step('resetModes');
          this.away = false;
          this.babysitter = false;
        },
      },
    };
    const inertRequire = (name: string): unknown => {
      assert.ok(Object.hasOwn(replacements, name), `blocked import: ${name}`);
      this.imports.push(name);
      return replacements[name];
    };
    // No process, environment, real require, fetch, timers, or browser globals.
    runInNewContext(compiled, { require: inertRequire, exports: Object.create(null) }, {
      filename: path,
      timeout: 1000,
      contextCodeGeneration: { strings: false, wasm: false },
    });
  }

  step(event: string): void {
    this.events.push(event);
    const failure = this.failures.get(event);
    if (failure !== undefined) throw failure;
  }

  async hook(name: Hook): Promise<void> {
    for (const callback of this.hooks[name]) await callback(this.fixtures);
  }

  async scenario(title: string): Promise<void> {
    const callback = this.scenarios.get(title);
    assert.ok(callback, `unregistered scenario: ${title}`);
    await callback(this.fixtures);
  }

  async response(method: 'POST' | 'GET', path: string, enabled?: unknown) {
    assert.ok(path === '/api/away-mode' || path === '/api/babysitter-mode', `blocked request ${path}`);
    this.step(`${method}:${path}${method === 'POST' ? `:${String(enabled)}` : ''}`);
    const plan = this.plans[method].shift() ?? {};
    if (plan.requestError !== undefined) throw plan.requestError;
    const ok = plan.ok ?? true;
    if (method === 'POST' && ok) {
      assert.equal(typeof enabled, 'boolean');
      if (path === '/api/away-mode') this.away = enabled === true;
      else this.babysitter = enabled === true;
    }
    const current = path === '/api/away-mode' ? this.away : this.babysitter;
    return {
      ok: () => {
        this.step(`ok:${method}:${path}`);
        return ok;
      },
      json: async (): Promise<unknown> => {
        this.step(`json:${method}:${path}`);
        if (plan.jsonError !== undefined) throw plan.jsonError;
        return Object.hasOwn(plan, 'body') ? plan.body : { enabled: current };
      },
    };
  }

  elements(): Element[] {
    const visible = (key: string) => !this.hidden.has(key);
    if (this.route === '/') {
      return [
        { key: 'away-overlay', text: '', classes: ['z-[9998]'], visible: this.away && visible('away-overlay') },
        { key: 'babysitter-overlay', text: '', classes: ['z-[9997]'], visible: this.babysitter && visible('babysitter-overlay') },
        { key: 'babysitter-heading', text: 'Babysitter Information', visible: this.babysitter && visible('babysitter-heading') },
      ];
    }
    if (this.route !== '/settings') return [];
    const elements: Element[] = [
      { key: 'settings-heading', tag: 'h1', text: this.heading, visible: visible('settings-heading') },
      ...['Family Members', 'Display', 'About'].map((section) => ({
        key: `${section}-button`, role: 'button', text: section, section,
        visible: visible(`${section}-button`),
      })),
    ];
    if (this.section === 'Family Members') {
      elements.push(...this.displayedMembers.map((name, index) => ({
        key: `member-${index}`, text: name, classes: ['font-medium'], visible: visible(`member-${index}`),
      })));
    }
    if (this.section === 'Display') {
      elements.push({ key: 'theme', text: this.themeText, visible: visible('theme') });
    }
    if (this.section === 'About') {
      elements.push({ key: 'version', text: this.versionText, visible: visible('version') });
    }
    return elements;
  }
}

export async function prepared(source: Source): Promise<ScenarioHarness> {
  const harness = new ScenarioHarness(source);
  await harness.hook('beforeAll');
  if (source === 'settings') await harness.hook('beforeEach');
  harness.events.length = 0;
  return harness;
}
