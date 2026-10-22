import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export type Spec = 'shopping' | 'shopping-crud' | 'gift-ideas';
export type Repair = ReadonlyArray<{ before: string; after: string }>;
export type Member = { id: string; name: string; role: 'parent' | 'child' };
export type RecordRow = { id: string; name: string; listId?: string; checked?: boolean; forUserId?: string; owner?: string };
export type Call = { method: string; path: string; actor: string; data?: Record<string, unknown> };
export type Reply = { status: number; body: unknown };
export type Options = {
  members?: Member[];
  parentFailure?: boolean;
  bareLists?: boolean;
  header?: string;
  categories?: number;
  columns?: number;
  noItems?: boolean;
  stuckProgress?: boolean;
  progressVisible?: boolean;
  modeEntry?: boolean;
  modeExit?: boolean;
  addList?: boolean;
  newList?: boolean;
  addItem?: boolean;
  stuckModal?: boolean;
  hiddenCreatedItem?: boolean;
  giftTab?: boolean;
  noGiftContent?: boolean;
  hiddenMember?: boolean;
  leakIdeas?: boolean;
  cleanupFalse?: boolean;
  cleanupReject?: boolean;
  reply?: (call: Call, reply: Reply) => Reply;
};
export class SyntheticSkip extends Error {}
type Fixtures = { page: Page; browser: { newPage: () => Promise<Page> } };
type Callback = (fixtures: Fixtures) => Promise<void>;
type Query = 'header' | 'categories' | 'columns' | 'progress' | 'items' | 'span' | 'buttons' |
  'maximize' | 'minimize' | 'entry' | 'exit' | 'addList' | 'newList' | 'addItem' | 'dialog' |
  'input' | 'submit' | 'giftTab' | 'member' | 'itemName';
const members: Member[] = [
  { id: 'adult-a', name: 'Synthetic Parent', role: 'parent' },
  { id: 'child-a', name: 'Synthetic Child', role: 'child' },
  { id: 'adult-b', name: 'Synthetic Other', role: 'parent' },
];

export class Harness {
  readonly scenarios = new Map<string, Callback>();
  readonly hooks: Record<'beforeAll' | 'beforeEach' | 'afterEach', Callback[]> = { beforeAll: [], beforeEach: [], afterEach: [] };
  readonly calls: Call[] = [];
  readonly events: string[] = [];
  readonly pages: Page[] = [];
  readonly roster: Member[];
  readonly items = new Map<string, RecordRow>();
  readonly lists = new Map<string, RecordRow>([['list-a', { id: 'list-a', name: 'Synthetic Grocery' }]]);
  readonly ideas = new Map<string, RecordRow>();
  readonly options: Options;
  readonly page: Page;
  private nextId = 1;
  constructor(spec: Spec, options: Options = {}, repair: Repair = []) {
    this.options = options;
    this.roster = options.members ?? members;
    if (!options.noItems) this.items.set('baseline-item', { id: 'baseline-item', name: 'Synthetic Apple', listId: 'list-a', checked: false });
    this.page = this.newPage();
    const register = Object.assign((name: string, callback: Callback) => {
      if (this.scenarios.has(name)) throw new Error('Duplicate scenario');
      this.scenarios.set(name, callback);
    }, {
      describe: (_name: string, callback: () => void) => callback(),
      beforeAll: (callback: Callback) => this.hooks.beforeAll.push(callback),
      beforeEach: (callback: Callback) => this.hooks.beforeEach.push(callback),
      afterEach: (callback: Callback) => this.hooks.afterEach.push(callback),
      skip: (condition: boolean) => { if (condition) throw new SyntheticSkip('Synthetic unavailable prerequisite'); },
    });
    const login = async (page: Page, name: string): Promise<void> => {
      const member = this.roster.find((candidate) => candidate.name === name);
      if (!member) throw new Error('Unknown synthetic identity');
      page.actor = member.id;
      this.events.push(`login:${member.id}`);
    };
    const cleanup = async (page: Page, id: string, kind: 'items' | 'lists'): Promise<boolean> => {
      this.events.push(`cleanup:${kind}:${id}`);
      if (options.cleanupReject) throw new Error('Synthetic cleanup rejected');
      if (options.cleanupFalse) return false;
      const response = await this.request(page, 'DELETE', `/api/shopping-${kind}/${id}`);
      return response.ok();
    };
    const modules: Record<string, unknown> = {
      '@playwright/test': { test: register, expect: locatorExpect },
      './helpers/auth': {
        loginViaAPI: login,
        logout: async (page: Page) => { this.events.push(`logout:${page.actor}`); page.actor = ''; },
        getFirstParent: async () => {
          this.events.push('roster:parent');
          if (options.parentFailure) throw new Error('Synthetic roster unavailable');
          const parent = this.roster.find((member) => member.role === 'parent');
          if (!parent) throw new Error('Synthetic parent absent');
          return parent;
        },
        getFirstChild: async () => {
          this.events.push('roster:child');
          const child = this.roster.find((member) => member.role === 'child');
          if (!child) throw new Error('Synthetic child absent');
          return child;
        },
        getFamilyMembers: async () => { this.events.push('roster:all'); return this.roster; },
      },
      './helpers/reset': { resetShoppingItems: () => {
        this.events.push('reset:items');
        for (const item of this.items.values()) item.checked = false;
      } },
      './helpers/cleanup': {
        deleteShoppingItem: (page: Page, id: string) => cleanup(page, id, 'items'),
        deleteShoppingList: (page: Page, id: string) => cleanup(page, id, 'lists'),
      },
    };
    const filename = resolve(__dirname, '../../../e2e', `${spec}.spec.ts`);
    let source = readFileSync(filename, 'utf8');
    for (const replacement of repair) {
      if (source.split(replacement.before).length !== 2) throw new Error('Repair probe must match exactly once');
      source = source.replace(replacement.before, replacement.after);
    }
    const code = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(code, {
      exports: {},
      Date: class extends Date { static now(): number { return 1700000000000; } },
      require: (name: string) => {
        if (!Object.hasOwn(modules, name)) throw new Error(`Denied import: ${name}`);
        return modules[name];
      },
      process: new Proxy({}, { get: () => { throw new Error('Process access denied'); } }),
      console: new Proxy({}, { get: () => { throw new Error('Console access denied'); } }),
    }, { filename, timeout: 2000 });
  }
  newPage(): Page {
    const page = new Page(this);
    this.pages.push(page);
    this.events.push('page:new');
    return page;
  }
  fixtures(): Fixtures { return { page: this.page, browser: { newPage: async () => this.newPage() } }; }
  async hook(kind: keyof Harness['hooks']): Promise<void> {
    for (const callback of this.hooks[kind]) await callback(this.fixtures());
  }
  async ready(): Promise<void> { await this.hook('beforeAll'); await this.hook('beforeEach'); }
  async invoke(name: string): Promise<void> {
    const callback = this.scenarios.get(name);
    if (!callback) throw new Error(`Unknown scenario: ${name}`);
    await callback(this.fixtures());
  }
  async run(name: string): Promise<void> {
    await this.hook('beforeEach');
    try { await this.invoke(name); } finally { await this.hook('afterEach'); }
  }
  async request(page: Page, method: string, path: string, data?: Record<string, unknown>): Promise<{ status: () => number; ok: () => boolean; json: () => Promise<unknown> }> {
    if (!page.actor) throw new Error('Synthetic request requires identity');
    const match = /^\/api\/(shopping-items|shopping-lists|gift-ideas)(?:\/([\w-]+))?(?:\?listId=([\w-]+))?$/.exec(path);
    if (!match || !['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new Error('Denied synthetic route or method');
    const call: Call = { method, path, actor: page.actor, ...(data ? { data: { ...data } } : {}) };
    this.calls.push(call);
    const kind = match[1];
    const id = match[2];
    const table = kind === 'shopping-items' ? this.items : kind === 'shopping-lists' ? this.lists : this.ideas;
    let reply: Reply;
    let commit: (() => void) | undefined;
    if (method === 'GET' && !id) {
      const rows = [...table.values()].filter((row) => kind === 'gift-ideas' ? this.options.leakIdeas || row.owner === page.actor : !match[3] || row.listId === match[3]);
      reply = { status: 200, body: kind === 'shopping-lists' ? this.options.bareLists ? rows : { lists: rows } : kind === 'shopping-items' ? { items: rows } : { ideas: rows } };
    } else if (method === 'POST' && !id && data && typeof data.name === 'string') {
      if (kind === 'shopping-items' && (typeof data.listId !== 'string' || !this.lists.has(data.listId))) {
        reply = { status: 400, body: { error: 'Missing synthetic list' } };
      } else if (kind === 'gift-ideas' && data.forUserId === page.actor) {
        reply = { status: 400, body: { error: 'Cannot create a gift idea for yourself' } };
      } else {
        const row: RecordRow = { id: `created-${this.nextId++}`, name: data.name };
        if (kind === 'shopping-items') { row.listId = String(data.listId); row.checked = false; }
        if (kind === 'gift-ideas') { row.forUserId = String(data.forUserId); row.owner = page.actor; }
        commit = () => { table.set(row.id, row); };
        reply = { status: 201, body: { ...row } };
      }
    } else if (method === 'PATCH' && kind === 'shopping-items' && id && data && typeof data.checked === 'boolean') {
      const row = table.get(id);
      if (!row) reply = { status: 404, body: { error: 'Missing synthetic item' } };
      else {
        const updated = { ...row, checked: data.checked };
        commit = () => { table.set(id, updated); };
        reply = { status: 200, body: { ...updated } };
      }
    } else if (method === 'DELETE' && id) {
      const row = table.get(id);
      if (kind === 'gift-ideas' && row && row.owner !== page.actor) reply = { status: 403, body: {} };
      else {
        commit = () => {
          table.delete(id);
          if (kind === 'shopping-lists') for (const [itemId, item] of this.items) if (item.listId === id) this.items.delete(itemId);
        };
        reply = { status: 200, body: { success: true } };
      }
    } else throw new Error('Unsupported synthetic operation');
    const result = this.options.reply?.(call, reply) ?? reply;
    if (result.status >= 200 && result.status < 300) commit?.();
    return { status: () => result.status, ok: () => result.status >= 200 && result.status < 300, json: async () => result.body };
  }
}

export class Page {
  actor = '';
  closed = false;
  mode = false;
  dialog = false;
  giftContent = false;
  input = '';
  readonly request;
  constructor(readonly harness: Harness) {
    this.request = {
      get: (path: string) => harness.request(this, 'GET', path),
      post: (path: string, options: { data: Record<string, unknown> }) => harness.request(this, 'POST', path, options.data),
      patch: (path: string, options: { data: Record<string, unknown> }) => harness.request(this, 'PATCH', path, options.data),
      delete: (path: string) => harness.request(this, 'DELETE', path),
    };
  }
  async close(): Promise<void> { this.closed = true; this.harness.events.push('page:close'); }
  async goto(path: string): Promise<void> {
    if (!['/shopping', '/wishes'].includes(path)) throw new Error('Denied synthetic navigation');
    this.harness.events.push(`goto:${path}`);
  }
  async waitForLoadState(state: string): Promise<void> {
    if (state !== 'networkidle') throw new Error('Denied synthetic load state');
  }
  async waitForTimeout(ms: number): Promise<void> {
    if (ms !== 2000) throw new Error('Denied synthetic wait');
    this.harness.events.push('wait:2000');
  }
  locator(selector: string): Locator {
    const allowed: Record<string, Query> = {
      h1: 'header', '[data-category]': 'categories', '[data-column]': 'columns',
      '[class*="cursor-pointer"]': 'items', span: 'span', button: 'buttons',
      'svg.lucide-maximize2, svg.lucide-maximize-2': 'maximize',
      'svg.lucide-minimize2, svg.lucide-minimize-2': 'minimize', '[role="dialog"]': 'dialog',
    };
    const query = allowed[selector];
    if (!query) throw new Error(`Denied synthetic selector: ${selector}`);
    return new Locator(this, query);
  }
  getByRole(role: string, options: { name: string | RegExp }): Locator {
    if (role !== 'button') throw new Error('Denied synthetic role');
    const name = String(options.name);
    const query: Record<string, Query> = { 'Add List': 'addList', 'New List': 'newList', '/Add Item/i': 'addItem', '/Gift Ideas/i': 'giftTab' };
    const found = query[name];
    if (!found) throw new Error(`Denied synthetic role name: ${name}`);
    return new Locator(this, found);
  }
  getByText(text: string | RegExp): Locator {
    if (text instanceof RegExp || Object.prototype.toString.call(text) === '[object RegExp]') {
      if (String(text) !== '/\\d+\\/\\d+/') throw new Error('Denied synthetic text pattern');
      return new Locator(this, 'progress');
    }
    if (this.harness.roster.some((member) => member.name === text)) return new Locator(this, 'member', String(text));
    if (typeof text !== 'string' || !text.startsWith('E2E ')) throw new Error('Denied synthetic text');
    return new Locator(this, 'itemName', text);
  }
}

export class Locator {
  constructor(readonly page: Page, readonly query: Query, readonly name = '') {}
  first(): Locator { return this; }
  filter(options: { has: Locator }): Locator {
    if (options.has.page !== this.page) throw new Error('Foreign synthetic locator');
    const query = this.query === 'items' && options.has.query === 'span' ? 'items' :
      this.query === 'buttons' && options.has.query === 'maximize' ? 'entry' :
      this.query === 'buttons' && options.has.query === 'minimize' ? 'exit' : undefined;
    if (!query) throw new Error('Denied synthetic filter');
    return new Locator(this.page, query);
  }
  locator(selector: string): Locator {
    if (this.query !== 'dialog' || !['#item-name', 'button[type="submit"]'].includes(selector)) throw new Error('Denied nested synthetic selector');
    return new Locator(this.page, selector === '#item-name' ? 'input' : 'submit');
  }
  async count(): Promise<number> {
    const { options, items } = this.page.harness;
    if (this.query === 'categories') return options.categories ?? 1;
    if (this.query === 'columns') return options.columns ?? 0;
    if (this.query === 'items') return items.size;
    return this.visible() ? 1 : 0;
  }
  visible(): boolean {
    const { options, items } = this.page.harness;
    switch (this.query) {
      case 'progress': return options.progressVisible !== false;
      case 'entry': return options.modeEntry !== false && !this.page.mode;
      case 'exit': return options.modeExit !== false && this.page.mode;
      case 'addList': return options.addList !== false;
      case 'newList': return options.newList !== false;
      case 'addItem': return options.addItem !== false;
      case 'dialog': case 'input': case 'submit': return this.page.dialog;
      case 'giftTab': return options.giftTab !== false;
      case 'member': return this.page.giftContent && !options.hiddenMember;
      case 'itemName': return !options.hiddenCreatedItem && [...items.values()].some((item) => item.name === this.name);
      case 'header': return true;
      case 'items': return items.size > 0;
      default: throw new Error(`Unsupported synthetic visibility: ${this.query}`);
    }
  }
  async isVisible(): Promise<boolean> { return this.visible(); }
  async textContent(): Promise<string> {
    if (this.query === 'header') return this.page.harness.options.header ?? 'Shopping';
    if (this.query !== 'progress') throw new Error('Unsupported synthetic text content');
    const rows = [...this.page.harness.items.values()];
    return `${rows.filter((row) => row.checked).length}/${rows.length}`;
  }
  async fill(text: string): Promise<void> {
    if (this.query !== 'input' || !this.visible()) throw new Error('Cannot fill synthetic target');
    this.page.input = text;
    this.page.harness.events.push('modal:fill');
  }
  async click(): Promise<void> {
    if (!this.visible()) throw new Error(`Cannot click hidden synthetic target: ${this.query}`);
    const { harness } = this.page;
    harness.events.push(`click:${this.query}`);
    switch (this.query) {
      case 'items': {
        const row = harness.items.values().next().value;
        if (!row) throw new Error('Missing synthetic item');
        if (!harness.options.stuckProgress) row.checked = !row.checked;
        break;
      }
      case 'entry': this.page.mode = true; break;
      case 'exit': this.page.mode = false; break;
      case 'addItem': this.page.dialog = true; break;
      case 'submit':
        await harness.request(this.page, 'POST', '/api/shopping-items', { listId: 'list-a', name: this.page.input });
        if (!harness.options.stuckModal) this.page.dialog = false;
        break;
      case 'giftTab': if (!harness.options.noGiftContent) this.page.giftContent = true; break;
      default: throw new Error('Unsupported synthetic click');
    }
  }
}

function locatorExpect(value: unknown): unknown {
  if (!(value instanceof Locator)) return expect(value);
  const build = (negated: boolean) => ({
    toBeVisible: async () => { expect(value.visible()).toBe(!negated); },
    toContainText: async (text: string) => {
      const actual = await value.textContent();
      if (negated) expect(actual).not.toContain(text); else expect(actual).toContain(text);
    },
    toHaveText: async (text: string) => {
      const actual = await value.textContent();
      if (negated) expect(actual).not.toBe(text); else expect(actual).toBe(text);
    },
  });
  return { ...build(false), not: build(true) };
}

export async function outcome(work: Promise<void>): Promise<'passed' | 'rejected' | 'skipped'> {
  try { await work; return 'passed'; } catch (error) { return error instanceof SyntheticSkip ? 'skipped' : 'rejected'; }
}
