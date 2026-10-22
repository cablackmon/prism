import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script, createContext } from 'node:vm';
import { expect as check } from 'expect';
import ts from 'typescript';

export const sourceFiles = ['task-crud.spec.ts', 'message-crud.spec.ts', 'goals.spec.ts'] as const;
export type SourceFile = (typeof sourceFiles)[number];
type Row = Record<string, unknown> & { id: string };
type Selector = string | { test(value: string): boolean };
export type RequestCall = { method: string; path: string; data?: Record<string, unknown> };
export type Reply = { status: number; body: unknown };
type Member = { id: string; name: string; role: string };
export type Options = {
  parentError?: Error;
  childError?: Error;
  childPresent?: boolean;
  loginError?: Error;
  cleanupFailAt?: number;
  fault?: (call: RequestCall, normal: Reply) => Reply;
  uiFault?: 'hide-title' | 'sticky-modal' | 'escape-stuck' | 'wrong-header';
  listAsArray?: boolean;
  emptyGoals?: boolean;
};
type Callback = (fixture: { page: FakePage; browser: { newPage(): Promise<FakePage> } }) => Promise<void>;
export class SkipSignal extends Error {}

class Locator {
  constructor(readonly page: FakePage, readonly key: string) {}
  first() { return this; }
  locator(selector: string) {
    if (this.key !== 'task-modal') throw new Error(`Unexpected nested locator: ${this.key}`);
    if (selector === 'input[placeholder="Task title..."]') return new Locator(this.page, 'task-input');
    if (selector === 'button[type="submit"]') return new Locator(this.page, 'task-submit');
    throw new Error(`Unexpected modal selector: ${selector}`);
  }
  async fill(value: string) {
    if (this.key !== 'task-input' || !this.page.modal) throw new Error('Task input is not available');
    this.page.input = value;
    this.page.world.events.push('fill:task');
  }
  async click() {
    const world = this.page.world;
    if (!this.visible()) throw new Error(`Cannot click hidden control: ${this.key}`);
    world.events.push(`click:${this.key}`);
    if (this.key === 'add-task' || this.key === 'add-goal') this.page.modal = true;
    else if (this.key === 'task-submit') {
      await this.page.request.post('/api/tasks', { data: { title: this.page.input } });
      if (world.options.uiFault !== 'sticky-modal') this.page.modal = false;
      this.page.refresh();
    } else throw new Error(`Unexpected clickable locator: ${this.key}`);
  }
  visible(): boolean {
    if (this.key === 'header') return this.page.route !== '';
    if (this.key === 'add-task') return this.page.route === '/tasks';
    if (this.key === 'add-goal') return this.page.route === '/goals';
    if (this.key === 'goal-dialog' || this.key === 'task-modal') return this.page.modal;
    if (this.key === 'task-submit' || this.key === 'task-input') return this.page.modal;
    if (this.key.startsWith('text:')) {
      return this.page.world.options.uiFault !== 'hide-title' && this.page.texts.has(this.key.slice(5));
    }
    throw new Error(`Unexpected visibility query: ${this.key}`);
  }
  text(): string {
    if (this.key !== 'header') throw new Error(`Unexpected text query: ${this.key}`);
    return this.page.world.options.uiFault === 'wrong-header' ? 'Failure document' : this.page.route.slice(1);
  }
}

class FakePage {
  route = '';
  modal = false;
  input = '';
  closed = 0;
  texts = new Set<string>();
  readonly request;
  readonly keyboard;
  constructor(readonly world: World, readonly label: string) {
    this.request = {
      get: (path: string) => world.request('GET', path),
      post: (path: string, options: { data: Record<string, unknown> }) => world.request('POST', path, options.data),
      patch: (path: string, options: { data: Record<string, unknown> }) => world.request('PATCH', path, options.data),
      delete: (path: string) => world.request('DELETE', path),
    };
    this.keyboard = { press: async (key: string) => {
      if (key !== 'Escape' || this.route !== '/goals') throw new Error(`Unexpected key: ${key}`);
      world.events.push('key:Escape');
      if (world.options.uiFault !== 'escape-stuck') this.modal = false;
    } };
  }
  async goto(path: string) {
    if (path !== '/tasks' && path !== '/goals') throw new Error(`Unexpected navigation: ${path}`);
    this.world.events.push(`goto:${path}`);
    this.route = path;
    this.refresh();
  }
  async waitForLoadState(state: string) {
    if (state !== 'networkidle') throw new Error(`Unexpected load state: ${state}`);
    this.world.events.push('load:networkidle');
  }
  async waitForTimeout(duration: number) {
    if (duration !== 2000) throw new Error(`Unexpected virtual wait: ${duration}`);
    this.world.events.push('wait:2000');
  }
  async reload() { this.world.events.push('reload'); this.refresh(); }
  async close() { this.closed++; this.world.events.push(`close:${this.label}`); }
  locator(selector: string) {
    if (selector === 'h1') return new Locator(this, 'header');
    if (selector === '.fixed.inset-0.bg-black\\/50') return new Locator(this, 'task-modal');
    throw new Error(`Unexpected selector: ${selector}`);
  }
  getByRole(role: string, options?: { name: Selector }) {
    if (role === 'dialog' && !options) return new Locator(this, 'goal-dialog');
    if (role === 'button' && options) {
      for (const [name, key] of [['Add Task', 'add-task'], ['Add Goal', 'add-goal']]) {
        if (name && key && matches(options.name, name)) return new Locator(this, key);
      }
    }
    throw new Error(`Unexpected role: ${role}`);
  }
  getByText(text: string) { return new Locator(this, `text:${text}`); }
  refresh() {
    const rows = this.route === '/tasks' ? this.world.tasks : this.world.goals;
    this.texts = new Set([...rows.values()].map(row => String(row.title ?? row.name)));
    if (this.route === '/goals' && this.world.options.childPresent !== false) this.texts.add(this.world.child.name);
  }
}

function matches(selector: Selector, value: string) {
  return typeof selector === 'string' ? value === selector : selector.test(value);
}

class World {
  readonly parent: Member = { id: 'parent-synthetic', name: 'Synthetic Parent', role: 'parent' };
  readonly child: Member = { id: 'child-synthetic', name: 'Synthetic Child', role: 'child' };
  readonly events: string[] = [];
  readonly calls: RequestCall[] = [];
  readonly tasks = new Map<string, Row>();
  readonly messages = new Map<string, Row>();
  readonly goals = new Map<string, Row>();
  readonly page: FakePage;
  readonly setupPage: FakePage;
  cleanupCalls = 0;
  constructor(readonly options: Options) {
    if (!options.emptyGoals) this.goals.set('goal-seed', { id: 'goal-seed', name: 'Synthetic Reading', pointCost: 20 });
    this.page = new FakePage(this, 'test');
    this.setupPage = new FakePage(this, 'setup');
  }
  async request(method: string, path: string, data?: Record<string, unknown>) {
    const call: RequestCall = { method, path, ...(data ? { data: { ...data } } : {}) };
    this.calls.push(call);
    const normal = this.respond(call);
    const reply = this.options.fault ? this.options.fault(call, normal) : normal;
    return { ok: () => reply.status >= 200 && reply.status < 300, status: () => reply.status,
      json: async () => JSON.parse(JSON.stringify(reply.body)) as unknown };
  }
  private respond({ method, path, data }: RequestCall): Reply {
    const match = /^\/api\/(tasks|messages|goals)(?:\/([a-z0-9-]+))?$/.exec(path);
    if (!match) throw new Error(`Denied API path: ${method} ${path}`);
    const entity = match[1];
    const id = match[2];
    const table = entity === 'tasks' ? this.tasks : entity === 'messages' ? this.messages : this.goals;
    if (method === 'GET' && !id) {
      const rows = [...table.values()];
      if (entity === 'goals') return { status: 200, body: { goals: rows, progress: {}, children: this.options.childPresent === false ? [] : [this.child] } };
      return { status: 200, body: this.options.listAsArray ? rows : { [String(entity)]: rows } };
    }
    if (method === 'GET' && id && entity === 'tasks') {
      return table.has(id) ? { status: 200, body: table.get(id) } : { status: 404, body: { error: 'Missing synthetic task' } };
    }
    if (method === 'POST' && !id && data) {
      const newId = `${entity}-${table.size + 1}`;
      const row: Row = { id: newId, ...(entity === 'tasks' ? { completed: false } : {}), ...data };
      table.set(newId, row);
      return { status: 201, body: entity === 'goals' ? { goal: row } : row };
    }
    if (method === 'PATCH' && id && data && table.has(id) && entity !== 'goals') {
      const row = { ...table.get(id), ...data, id };
      table.set(id, row);
      return { status: 200, body: row };
    }
    if (method === 'DELETE' && id && table.has(id)) {
      table.delete(id);
      return { status: 204, body: null };
    }
    throw new Error(`Denied API operation: ${method} ${path}`);
  }
  async cleanup(kind: 'task' | 'message', title: string) {
    this.cleanupCalls++;
    this.events.push(`cleanup:${kind}:${title}`);
    if (this.options.cleanupFailAt === this.cleanupCalls) throw new Error('Synthetic cleanup failure');
    const table = kind === 'task' ? this.tasks : this.messages;
    for (const [id, row] of table) {
      const matches = kind === 'task' ? row.title === title : String(row.message).includes(title);
      if (matches) { table.delete(id); break; }
    }
    return true;
  }
}

export function loadSuite(source: SourceFile, options: Options = {}, transform?: (text: string) => string) {
  if (!sourceFiles.includes(source)) throw new Error(`Denied source: ${source}`);
  const world = new World(options);
  const beforeAll: Callback[] = [], beforeEach: Callback[] = [], afterEach: Callback[] = [];
  const scenarios = new Map<string, Callback>();
  const register = Object.assign((name: string, callback: Callback) => {
    if (scenarios.has(name)) throw new Error(`Duplicate scenario: ${name}`);
    scenarios.set(name, callback);
  }, {
    describe: (_name: string, callback: () => void) => callback(),
    beforeAll: (callback: Callback) => beforeAll.push(callback),
    beforeEach: (callback: Callback) => beforeEach.push(callback),
    afterEach: (callback: Callback) => afterEach.push(callback),
    skip: (condition: boolean, reason: string) => { if (condition) throw new SkipSignal(reason); },
  });
  const assertion = (actual: unknown) => actual instanceof Locator ? {
    toBeVisible: async () => check(actual.visible()).toBe(true),
    toContainText: async (text: string) => check(actual.text()).toContain(text),
    not: { toBeVisible: async () => check(actual.visible()).toBe(false) },
  } : check(actual);
  const imports: Record<string, unknown> = {
    '@playwright/test': { test: register, expect: assertion },
    './helpers/auth': {
      getFirstParent: async (page: FakePage) => {
        if (page !== world.setupPage) throw new Error('Wrong discovery page');
        world.events.push('discover:parent');
        if (options.parentError) throw options.parentError;
        return { ...world.parent };
      },
      getFirstChild: async (page: FakePage) => {
        if (page !== world.setupPage) throw new Error('Wrong discovery page');
        world.events.push('discover:child');
        if (options.childError) throw options.childError;
        if (options.childPresent === false) throw new Error('No child found');
        return { ...world.child };
      },
      loginViaAPI: async (page: FakePage, name: string) => {
        if (page !== world.page || name !== world.parent.name) throw new Error('Wrong synthetic login');
        world.events.push(`login:${name}`);
        if (options.loginError) throw options.loginError;
      },
      logout: async (page: FakePage) => {
        if (page !== world.page) throw new Error('Wrong logout page');
        world.events.push('logout');
      },
    },
    './helpers/cleanup': {
      deleteTaskByTitle: (page: FakePage, title: string) => {
        if (page !== world.page) throw new Error('Wrong task cleanup page');
        return world.cleanup('task', title);
      },
      deleteMessageByContent: (page: FakePage, title: string) => {
        if (page !== world.page) throw new Error('Wrong message cleanup page');
        return world.cleanup('message', title);
      },
    },
  };
  const filename = resolve(__dirname, '../../..', 'e2e', source);
  const original = readFileSync(filename, 'utf8');
  const javascript = ts.transpileModule(transform ? transform(original) : original, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText;
  const context = createContext({ exports: {}, Date: { now: () => 1700000000000 }, require: (name: string) => {
    if (!Object.hasOwn(imports, name)) throw new Error(`Denied import: ${name}`);
    return imports[name];
  } }, { codeGeneration: { strings: false, wasm: false } });
  new Script(javascript, { filename }).runInContext(context, { timeout: 1000 });
  const fixture = { page: world.page, browser: { newPage: async () => { world.events.push('newPage'); return world.setupPage; } } };
  const runHooks = async (hooks: Callback[]) => { for (const callback of hooks) await callback(fixture); };
  return {
    world, scenarios: [...scenarios.keys()], hookCounts: [beforeAll.length, beforeEach.length, afterEach.length],
    beforeAll: () => runHooks(beforeAll), beforeEach: () => runHooks(beforeEach), afterEach: () => runHooks(afterEach),
    run: async (name: string) => {
      const callback = scenarios.get(name);
      if (!callback) throw new Error(`Unknown scenario: ${name}`);
      await callback(fixture);
    },
  };
}

export async function ready(source: SourceFile, options: Options = {}) {
  const suite = loadSuite(source, options);
  await suite.beforeAll();
  await suite.beforeEach();
  return suite;
}

export async function capture(action: () => Promise<unknown>): Promise<unknown> {
  try { await action(); return undefined; } catch (error) { return error; }
}
