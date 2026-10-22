import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';

export type Source = 'chore-crud' | 'chores' | 'tasks';
export type Hook = 'beforeAll' | 'beforeEach' | 'afterEach';
export type Member = { id: string; name: string; role: 'parent' | 'child' };
export const PARENT: Member = { id: 'synthetic-parent', name: 'Fixture Parent', role: 'parent' };
export const CHILD: Member = { id: 'synthetic-child', name: 'Fixture Child', role: 'child' };
export const TITLE = 'E2E Chore 1700000000000';
export type Method = 'get' | 'post' | 'patch';
export type Reply = {
  method: Method;
  path: string;
  status: number;
  body: unknown;
  error?: Error;
  jsonError?: Error;
};
export type Event = { kind: string; page?: string; target?: string; data?: unknown; role?: string };
export type Options = {
  parentError?: Error;
  childError?: Error;
  loginError?: Error;
  logoutError?: Error;
  cleanupError?: Error;
  resetError?: Error;
  newPageError?: Error;
  closeError?: Error;
  navigationError?: Error;
  loadError?: Error;
  holdModalOpen?: boolean;
  hideCreatedTitle?: boolean;
  visibility?: Partial<Record<Key, boolean>>;
  header?: string;
  columns?: number;
};
type Key = 'header' | 'main' | 'columns' | 'badge' | 'group' | 'add' | 'history' |
  'history-heading' | 'active' | 'completed' | 'modal' | 'input' | 'submit' | 'title';
type Callback = (fixtures: { page: FakePage; browser: { newPage: () => Promise<FakePage> } }) => Promise<void>;
export class FixtureSkip extends Error {}

export class FakeLocator {
  constructor(readonly owner: Runtime, readonly key: Key) {}
  locator(selector: string): FakeLocator {
    if (this.key === 'modal' && selector === 'input[placeholder="Chore title..."]') return this.owner.locator('input');
    if (this.key === 'modal' && selector === 'button[type="submit"]') return this.owner.locator('submit');
    throw new Error(`Denied nested selector ${this.key}: ${selector}`);
  }
  getByText(pattern: RegExp): FakeLocator {
    if (this.key === 'header' && pattern.source === 'active') return this.owner.locator('badge');
    throw new Error(`Denied text selector on ${this.key}`);
  }
  first(): FakeLocator {
    if (this.key !== 'main') throw new Error(`Denied first on ${this.key}`);
    return this;
  }
  async count(): Promise<number> {
    if (this.key !== 'columns') throw new Error(`Denied count on ${this.key}`);
    this.owner.events.push({ kind: 'count', target: this.key });
    return this.owner.options.columns ?? 2;
  }
  async isVisible(): Promise<boolean> {
    this.owner.events.push({ kind: 'visible-query', target: this.key });
    return this.owner.visible(this.key);
  }
  async click(): Promise<void> {
    if (!this.owner.visible(this.key)) throw new Error(`Hidden click: ${this.key}`);
    this.owner.events.push({ kind: 'click', target: this.key });
    switch (this.key) {
      case 'add': this.owner.modal = true; break;
      case 'submit':
        this.owner.modal = Boolean(this.owner.options.holdModalOpen);
        this.owner.createdTitle = !this.owner.options.hideCreatedTitle;
        break;
      case 'history': this.owner.history = true; break;
      case 'group': this.owner.grouped = !this.owner.grouped; break;
      case 'active': case 'completed': this.owner.filter = this.key; break;
      default: throw new Error(`Denied click: ${this.key}`);
    }
  }
  async fill(value: string): Promise<void> {
    if (this.key !== 'input' || !this.owner.visible(this.key)) throw new Error('Denied fill');
    this.owner.draftTitle = value;
    this.owner.events.push({ kind: 'fill', target: this.key, data: value });
  }
}

export class FakePage {
  readonly request: Record<Method, (path: string, options?: { data: unknown }) => Promise<{
    status: () => number;
    ok: () => boolean;
    json: () => Promise<unknown>;
  }>>;
  constructor(readonly owner: Runtime, readonly id: string) {
    this.request = {
      get: (path, options) => owner.request(this, 'get', path, options),
      post: (path, options) => owner.request(this, 'post', path, options),
      patch: (path, options) => owner.request(this, 'patch', path, options),
    };
  }
  async goto(path: string): Promise<void> {
    if (path !== (this.owner.source === 'tasks' ? '/tasks' : '/chores')) throw new Error(`Denied navigation ${path}`);
    this.owner.events.push({ kind: 'goto', page: this.id, target: path });
    if (this.owner.options.navigationError) throw this.owner.options.navigationError;
  }
  async waitForLoadState(state: string): Promise<void> {
    if (state !== 'networkidle') throw new Error(`Denied load state ${state}`);
    this.owner.events.push({ kind: 'load', page: this.id, target: state });
    if (this.owner.options.loadError) throw this.owner.options.loadError;
  }
  async close(): Promise<void> {
    this.owner.events.push({ kind: 'close', page: this.id });
    if (this.owner.options.closeError) throw this.owner.options.closeError;
  }
  locator(selector: string): FakeLocator {
    const selectors: Record<string, Key> = {
      h1: 'header', header: 'header', main: 'main', h3: 'columns',
      '.fixed.inset-0.bg-black\\/50': 'modal',
    };
    const key = selectors[selector];
    if (!key) throw new Error(`Denied selector ${selector}`);
    return this.owner.locator(key);
  }
  getByRole(role: string, options: { name: string | RegExp }): FakeLocator {
    if (role !== 'button') throw new Error(`Denied role ${role}`);
    const labels: [string, Key][] = [
      [this.owner.source === 'tasks' ? 'Add Task' : 'Add Chore', 'add'],
      ['History', 'history'], ['Group by Person', 'group'], ['Active', 'active'], ['Completed', 'completed'],
    ];
    const matches = labels.filter(([label]) => typeof options.name === 'string' ? options.name === label : options.name.test(label));
    if (matches.length !== 1 || !matches[0]) throw new Error('Denied or ambiguous button selector');
    return this.owner.locator(matches[0][1]);
  }
  getByText(pattern: string | RegExp): FakeLocator {
    if (typeof pattern === 'string' && pattern === this.owner.draftTitle && pattern === TITLE) return this.owner.locator('title');
    if (typeof pattern !== 'string' && pattern.test('Recent Completions')) return this.owner.locator('history-heading');
    throw new Error('Denied page text selector');
  }
}

export class Runtime {
  readonly events: Event[] = [];
  readonly callbacks = new Map<string, Callback>();
  readonly hooks: Record<Hook, Callback[]> = { beforeAll: [], beforeEach: [], afterEach: [] };
  readonly page = new FakePage(this, 'test');
  readonly replies: Reply[] = [];
  readonly roles = new Map<string, string>();
  readonly fixtures = {
    page: this.page,
    browser: {
      newPage: async (): Promise<FakePage> => {
        this.events.push({ kind: 'new-page' });
        if (this.options.newPageError) throw this.options.newPageError;
        return new FakePage(this, 'setup');
      },
    },
  };
  modal = false;
  history = false;
  createdTitle = false;
  draftTitle = '';
  grouped = true;
  filter = '';
  constructor(readonly source: Source, readonly options: Options = {}) {}
  locator(key: Key): FakeLocator { return new FakeLocator(this, key); }
  visible(key: Key): boolean {
    const override = this.options.visibility?.[key];
    if (override !== undefined) return override;
    if (key === 'modal' || key === 'input' || key === 'submit') return this.modal;
    if (key === 'history-heading') return this.history;
    if (key === 'title') return this.createdTitle;
    return true;
  }
  async request(page: FakePage, method: Method, path: string, options?: { data: unknown }): Promise<{
    status: () => number; ok: () => boolean; json: () => Promise<unknown>;
  }> {
    if (!/^\/api\/(chores|tasks)(\/synthetic-chore(\/complete|\/approve)?)?$/.test(path)) throw new Error(`Denied request ${method} ${path}`);
    const reply = this.replies.shift();
    if (!reply || reply.method !== method || reply.path !== path) throw new Error(`Unexpected fake request ${method} ${path}`);
    this.events.push({ kind: method, page: page.id, target: path, data: options?.data, role: this.roles.get(page.id) ?? 'anonymous' });
    if (reply.error) throw reply.error;
    return {
      status: () => reply.status,
      ok: () => reply.status >= 200 && reply.status < 300,
      json: async () => {
        if (reply.jsonError) throw reply.jsonError;
        return reply.body;
      },
    };
  }
  async hook(hook: Hook): Promise<void> {
    for (const callback of this.hooks[hook]) await callback(this.fixtures);
  }
  async run(title: string): Promise<void> {
    const callback = this.callbacks.get(title);
    if (!callback) throw new Error(`Unknown registered case: ${title}`);
    await callback(this.fixtures);
  }
  assertConsumed(): void { expect(this.replies).toHaveLength(0); }
}

function assertionBridge(value: unknown): unknown {
  if (!(value instanceof FakeLocator)) return expect(value);
  const visible = (negated: boolean): void => {
    value.owner.events.push({ kind: 'assert-visible', target: value.key, data: !negated });
    expect(value.owner.visible(value.key)).toBe(!negated);
  };
  return {
    toBeVisible: async () => visible(false),
    not: { toBeVisible: async () => visible(true) },
    toContainText: async (text: string) => {
      if (value.key !== 'header') throw new Error(`Denied text assertion on ${value.key}`);
      const actual = value.owner.options.header ?? (value.owner.source === 'tasks' ? 'Tasks' : 'Chores');
      value.owner.events.push({ kind: 'assert-text', target: value.key, data: text });
      expect(actual).toContain(text);
    },
  };
}

export function load(source: Source, options: Options = {}): Runtime {
  const runtime = new Runtime(source, options);
  const register = Object.assign((title: string, callback: Callback): void => {
    if (runtime.callbacks.has(title)) throw new Error(`Duplicate registered case: ${title}`);
    runtime.callbacks.set(title, callback);
  }, {
    describe: (_title: string, callback: () => void): void => callback(),
    beforeAll: (callback: Callback): void => { runtime.hooks.beforeAll.push(callback); },
    beforeEach: (callback: Callback): void => { runtime.hooks.beforeEach.push(callback); },
    afterEach: (callback: Callback): void => { runtime.hooks.afterEach.push(callback); },
    skip: (condition: boolean, reason: string): void => { if (condition) throw new FixtureSkip(reason); },
  });
  const auth = {
    getFirstParent: async (page: FakePage): Promise<Member> => {
      runtime.events.push({ kind: 'parent-lookup', page: page.id });
      if (options.parentError) throw options.parentError;
      return PARENT;
    },
    getFirstChild: async (page: FakePage): Promise<Member> => {
      runtime.events.push({ kind: 'child-lookup', page: page.id });
      if (options.childError) throw options.childError;
      return CHILD;
    },
    loginViaAPI: async (page: FakePage, name: string): Promise<void> => {
      if (name !== PARENT.name && name !== CHILD.name) throw new Error('Denied synthetic identity');
      runtime.events.push({ kind: 'login', page: page.id, target: name });
      if (options.loginError) throw options.loginError;
      runtime.roles.set(page.id, name === CHILD.name ? 'child' : 'parent');
    },
    logout: async (page: FakePage): Promise<void> => {
      runtime.events.push({ kind: 'logout', page: page.id });
      if (options.logoutError) throw options.logoutError;
      runtime.roles.delete(page.id);
    },
  };
  const reset = (kind: string): void => {
    runtime.events.push({ kind });
    if (options.resetError) throw options.resetError;
  };
  const modules: Record<string, unknown> = {
    '@playwright/test': { test: register, expect: assertionBridge },
    './helpers/auth': auth,
    './helpers/cleanup': {
      deleteChoreByTitle: async (page: FakePage, title: string): Promise<void> => {
        if (title !== TITLE) throw new Error('Unexpected cleanup title');
        runtime.events.push({ kind: 'cleanup', page: page.id, target: title });
        if (options.cleanupError) throw options.cleanupError;
      },
    },
    './helpers/reset': {
      resetChoreCompletions: () => reset('reset-chores'),
      resetTasks: () => reset('reset-tasks'),
    },
  };
  const code = readFileSync(resolve(__dirname, '../../..', `e2e/${source}.spec.ts`), 'utf8');
  const compiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: `${source}.spec.ts`,
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const context = createContext({
    exports: {},
    Date: Object.freeze({ now: () => 1700000000000 }),
    require: (name: string): unknown => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Denied module ${name}`);
      return modules[name];
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  new Script(compiled.outputText, { filename: `${source}.spec.ts` }).runInContext(context, { timeout: 1000 });
  return runtime;
}

export const CREATE = 'create a chore via API';
export const MODAL = 'create chore via modal UI';
export const PARENT_COMPLETE = 'complete a chore as parent (auto-approve)';
export const CHILD_COMPLETE = 'complete chore as child requires approval';
export const DISABLE = 'disable a chore prevents completion';
export function createReply(body: unknown = { id: 'synthetic-chore', title: TITLE, pointValue: 5, frequency: 'weekly' }, status = 201): Reply {
  return { method: 'post', path: '/api/chores', status, body };
}
export function completionReply(body: unknown, status = 201): Reply {
  return { method: 'post', path: '/api/chores/synthetic-chore/complete', status, body };
}
export function childReplies(): Reply[] {
  return [createReply(), completionReply({ id: 'synthetic-completion', approved: false, requiresApproval: true, isChildCompletion: true }),
    { method: 'post', path: '/api/chores/synthetic-chore/approve', status: 200, body: { completion: { pointsAwarded: 5 } } }];
}
