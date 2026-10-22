import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';

export type Spec = 'calendar' | 'calendar-notes' | 'event-crud';
type Hook = 'beforeAll' | 'beforeEach' | 'afterEach';
type Member = { id: string; name: string; role: string };
type EventRow = { id: string; title: string; [key: string]: unknown };
type Note = { date: string; content: string };
type Data = Record<string, unknown>;
type Response = { status(): number; ok(): boolean; json(): Promise<unknown> };
type Fixture = { page: Page; browser: { newPage(): Promise<Page> } };
type Callback = (fixture: Fixture) => Promise<void>;
type Fault = { method: string; path: string; occurrence?: number; status?: number; body?: unknown; error?: string };

export const fixedTime = '2026-12-31T12:00:00';
export const today = new Date(fixedTime).toISOString().slice(0, 10);
export const parent: Member = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic Parent', role: 'parent' };

export type Options = {
  time?: string;
  hidden?: string[];
  noOp?: string[];
  notesMissing?: boolean;
  notesStyle?: 'state' | 'class' | 'none';
  notesQueryError?: boolean;
  modalDoesNotSave?: boolean;
  notes?: Note[];
  fault?: Fault;
  discoveryError?: boolean;
  redacted?: boolean;
  cleanupErrorAt?: number;
};

function strict<T extends object>(value: T, name: string): T {
  return new Proxy(value, {
    get(target, key, receiver) {
      if (key === 'then') return undefined;
      if (!(key in target)) throw new Error(`Denied ${name} member ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
  });
}

export class Page {
  readonly journal: string[] = [];
  readonly events = new Map<string, EventRow>();
  readonly notes = new Map<string, Note>();
  readonly fields = new Map<string, string>();
  readonly requests: { method: string; path: string; data?: Data }[] = [];
  closed = false;
  offset = 0;
  view = 'Week';
  dialog = false;
  notesActive = false;
  private sequence = 0;
  private matchingRequests = 0;
  readonly request: {
    get(path: string): Promise<Response>;
    post(path: string, options: { data: Data }): Promise<Response>;
    put(path: string, options: { data: Data }): Promise<Response>;
    patch(path: string, options: { data: Data }): Promise<Response>;
    delete(path: string): Promise<Response>;
  };

  constructor(readonly options: Options = {}) {
    for (const note of options.notes ?? []) this.notes.set(note.date, { ...note });
    this.request = strict({
      get: (path: string) => this.send('GET', path),
      post: (path: string, config: { data: Data }) => this.send('POST', path, config.data),
      put: (path: string, config: { data: Data }) => this.send('PUT', path, config.data),
      patch: (path: string, config: { data: Data }) => this.send('PATCH', path, config.data),
      delete: (path: string) => this.send('DELETE', path),
    }, 'request');
    return strict(this, 'page');
  }

  async close() { this.closed = true; this.journal.push('close'); }
  async goto(path: string) {
    if (path !== '/calendar') throw new Error(`Denied navigation ${path}`);
    this.journal.push(`goto:${path}`);
  }
  async waitForLoadState(state: string) {
    if (state !== 'networkidle') throw new Error(`Denied load state ${state}`);
    this.journal.push(`load:${state}`);
  }
  async waitForTimeout(ms: number) {
    if (ms !== 1000) throw new Error(`Denied delay ${ms}`);
    this.journal.push('synthetic-delay');
  }
  locator(selector: string): Locator { return this.lookup(selector); }
  getByRole(role: string, options: { name: string | RegExp }): Locator {
    if (role !== 'button') throw new Error(`Denied role ${role}`);
    return this.lookup(roleName(options.name));
  }
  getByTitle(name: RegExp): Locator {
    if (name.source !== 'notes') throw new Error('Denied title selector');
    return new Locator(this, ['notes-button']);
  }
  getByText(text: RegExp): Locator {
    if (text.source !== 'click to add') throw new Error('Denied text selector');
    return new Locator(this, ['notes-text']);
  }
  async click(selector: string) { await this.lookup(selector).click(); }

  lookup(selector: string): Locator {
    const mapping: Record<string, string> = {
      h1: 'header',
      'button[aria-label="Previous"]': 'Previous',
      'button[aria-label="Next"]': 'Next',
      '.border.rounded-md': 'switcher',
      '[role="dialog"]': 'dialog',
      '[data-testid="calendar-notes"]': 'notes-area',
      'textarea[placeholder*="note" i]': 'notes-textarea',
    };
    const key = mapping[selector] ?? (['Today', 'Month', 'Day', 'Add Event'].includes(selector) ? selector : undefined);
    if (!key) throw new Error(`Denied selector ${selector}`);
    return new Locator(this, [key]);
  }

  visible(key: string): boolean {
    if (this.options.hidden?.includes(key)) return false;
    if (key === 'dialog') return this.dialog;
    if (key.startsWith('notes-') && key !== 'notes-button') return this.notesActive && !this.options.notesMissing;
    if (key === 'notes-button') return this.view !== 'Month';
    return true;
  }

  async interact(key: string) {
    if (!this.visible(key)) throw new Error(`Cannot click hidden ${key}`);
    this.journal.push(`click:${key}`);
    if (this.options.noOp?.includes(key)) return;
    if (key === 'Next') this.offset++;
    else if (key === 'Previous') this.offset--;
    else if (key === 'Today') this.offset = 0;
    else if (key === 'Month' || key === 'Day') this.view = key;
    else if (key === 'Add Event') this.dialog = true;
    else if (key === 'notes-button') this.notesActive = !this.notesActive;
    else if (key === 'submit') {
      if (!this.options.modalDoesNotSave) this.addEvent({
        title: this.fields.get('event-title'), startTime: this.fields.get('event-start'), endTime: this.fields.get('event-end'),
      });
      this.dialog = false;
    } else throw new Error(`Denied click ${key}`);
  }

  addEvent(data: Data): EventRow {
    if (typeof data.title !== 'string') throw new Error('Synthetic event needs a title');
    const row: EventRow = { ...data, id: `event-${++this.sequence}`, title: data.title };
    this.events.set(row.id, row);
    return row;
  }

  private async send(method: string, path: string, data?: Data): Promise<Response> {
    this.requests.push({ method, path, data });
    const fault = this.options.fault;
    if (fault && method === fault.method && path.startsWith(fault.path)) {
      this.matchingRequests++;
      if (this.matchingRequests === (fault.occurrence ?? 1)) {
        if (fault.error) throw new Error(fault.error);
        return response(fault.status ?? 500, fault.body ?? { error: 'synthetic failure' });
      }
    }
    if (method === 'POST' && path === '/api/events' && data) return response(201, this.addEvent(data));
    const eventId = /^\/api\/events\/(event-\d+)$/.exec(path)?.[1];
    if (eventId) {
      const event = this.events.get(eventId);
      if (method === 'DELETE') { this.events.delete(eventId); return response(200, { deleted: true }); }
      if (method === 'GET') return response(event ? 200 : 404, event ?? {});
      if (method === 'PATCH' && event && data) {
        const next = { ...event, ...data };
        this.events.set(eventId, next);
        return response(200, next);
      }
    }
    if (method === 'PUT' && path === '/api/calendar-notes' && data && typeof data.date === 'string' && typeof data.content === 'string') {
      if (!data.content.trim()) { this.notes.delete(data.date); return response(200, { deleted: true, date: data.date }); }
      const note = { date: data.date, content: data.content };
      this.notes.set(note.date, note);
      return response(200, { note });
    }
    const range = /^\/api\/calendar-notes\?from=(\d{4}-\d{2}-\d{2})&to=(\d{4}-\d{2}-\d{2})$/.exec(path);
    if (method === 'GET' && range?.[1] && range[2]) {
      const [from, to] = [range[1], range[2]];
      return response(200, { notes: [...this.notes.values()].filter(note => note.date >= from && note.date <= to) });
    }
    if (method === 'GET' && path === '/api/calendar-notes') return response(400, { error: 'Missing range' });
    throw new Error(`Denied request ${method} ${path}`);
  }
}

function response(status: number, body: unknown): Response {
  return strict({ status: () => status, ok: () => status >= 200 && status < 300, json: async () => structuredClone(body) }, 'response');
}

function roleName(name: string | RegExp): string {
  if (typeof name === 'string' && ['Today', 'Month', 'Day'].includes(name)) return name;
  if (name instanceof RegExp && name.source === 'Add Event') return 'Add Event';
  // RegExp instances created inside the VM have a different prototype.
  if (typeof name !== 'string' && name.source === 'Add Event') return 'Add Event';
  throw new Error('Denied button name');
}

class Locator {
  constructor(readonly page: Page, readonly keys: string[]) { return strict(this, 'locator'); }
  first(): Locator { return this; }
  or(other: Locator): Locator { return new Locator(this.page, [...this.keys, ...other.keys]); }
  getByRole(role: string, options: { name: string | RegExp }): Locator {
    if (this.keys[0] !== 'switcher' || role !== 'button') throw new Error('Denied nested role');
    return this.page.lookup(roleName(options.name));
  }
  locator(selector: string): Locator {
    if (this.keys[0] !== 'dialog') throw new Error('Denied nested locator');
    if (selector === 'button[type="submit"]') return new Locator(this.page, ['submit']);
    if (['#event-title', '#event-start', '#event-end'].includes(selector)) return new Locator(this.page, [selector.slice(1)]);
    throw new Error('Denied dialog selector');
  }
  async isVisible(): Promise<boolean> {
    if (this.keys.length > 1 && this.page.options.notesQueryError) throw new Error('synthetic notes query failure');
    return this.keys.some(key => this.page.visible(key));
  }
  async click() { await this.page.interact(this.one()); }
  async fill(value: string) {
    const key = this.one();
    if (!key.startsWith('event-') || !this.page.dialog) throw new Error('Denied input fill');
    this.page.fields.set(key, value);
  }
  async textContent(): Promise<string> {
    if (this.one() !== 'header') throw new Error('Denied text content');
    return `Synthetic calendar period ${this.page.offset}`;
  }
  async getAttribute(name: string): Promise<string | null> {
    if (this.one() !== 'notes-button' || name !== 'data-state') throw new Error('Denied attribute');
    return this.page.notesActive && this.page.options.notesStyle !== 'class' && this.page.options.notesStyle !== 'none' ? 'active' : null;
  }
  async evaluate(callback: (el: { classList: { contains(name: string): boolean } }) => unknown): Promise<unknown> {
    if (this.one() !== 'notes-button') throw new Error('Denied evaluate target');
    return callback({ classList: { contains: (name: string) => {
      if (name !== 'bg-secondary') throw new Error('Denied class query');
      return this.page.notesActive && this.page.options.notesStyle === 'class';
    } } });
  }
  private one(): string {
    if (this.keys.length !== 1 || !this.keys[0]) throw new Error('Expected single fake locator');
    return this.keys[0];
  }
}

function locatorExpectation(locator: Locator, negate = false): unknown {
  return {
    get not() { return locatorExpectation(locator, !negate); },
    async toBeVisible() { expect(await locator.isVisible()).toBe(!negate); },
    async toHaveText(text: string) {
      if (negate) expect(await locator.textContent()).not.toBe(text);
      else expect(await locator.textContent()).toBe(text);
    },
  };
}

export class Scenario {
  readonly page: Page;
  readonly setupPage: Page;
  readonly authLog: string[] = [];
  readonly imports: string[] = [];
  readonly tests = new Map<string, Callback>();
  readonly hooks: Record<Hook, Callback[]> = { beforeAll: [], beforeEach: [], afterEach: [] };
  private cleanupCount = 0;

  constructor(readonly spec: Spec, readonly options: Options = {}) {
    this.page = new Page(options);
    this.setupPage = new Page();
    const register = Object.assign((title: string, callback: Callback) => {
      if (this.tests.has(title)) throw new Error('Duplicate callback title');
      this.tests.set(title, callback);
    }, {
      describe: (_title: string, callback: () => void) => callback(),
      beforeAll: (callback: Callback) => this.hooks.beforeAll.push(callback),
      beforeEach: (callback: Callback) => this.hooks.beforeEach.push(callback),
      afterEach: (callback: Callback) => this.hooks.afterEach.push(callback),
    });
    const imports: Record<string, unknown> = {
      '@playwright/test': strict({ test: strict(register, 'test'), expect: (actual: unknown) => actual instanceof Locator ? locatorExpectation(actual) : expect(actual) }, 'Playwright'),
      './helpers/auth': strict({
        getFirstParent: async (page: Page) => {
          if (page !== this.setupPage) throw new Error('Unexpected discovery page');
          this.authLog.push('discover');
          if (options.discoveryError) throw new Error('synthetic discovery failure');
          return { ...parent, id: options.redacted ? '' : parent.id };
        },
        loginViaAPI: async (page: Page, name: string) => {
          if (page !== this.page || name !== parent.name) throw new Error('Unexpected login fixture');
          this.authLog.push('login');
          return { ...parent };
        },
        logout: async (page: Page) => {
          if (page !== this.page) throw new Error('Unexpected logout page');
          this.authLog.push('logout');
        },
      }, 'inert auth'),
      './helpers/cleanup': strict({ deleteEventByTitle: async (page: Page, title: string) => {
        if (page !== this.page || !title.startsWith('E2E Event ')) throw new Error('Unexpected cleanup fixture');
        this.authLog.push(`cleanup:${title.endsWith('(edited)') ? 'edited' : 'original'}`);
        if (++this.cleanupCount === options.cleanupErrorAt) throw new Error('synthetic cleanup failure');
        // Inert by design. The real helper is excluded and never imported.
        return true;
      } }, 'inert cleanup'),
    };
    const time = options.time ?? fixedTime;
    class Clock extends Date {
      constructor(...args: unknown[]) {
        if (!args.length) super(time);
        else if (args.length === 1) super(args[0] as string);
        else super(...args as [number, number, number, number, number]);
      }
      static now() { return new Date(time).getTime(); }
    }
    const filename = resolve(__dirname, '../../..', `e2e/${spec}.spec.ts`);
    const source = readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Script(compiled, { filename: `${spec}.spec.ts` }).runInNewContext({
      exports: {}, Date: Clock,
      require: (name: string) => {
        this.imports.push(name);
        if (!Object.hasOwn(imports, name)) throw new Error(`Denied import ${name}`);
        return imports[name];
      },
    }, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  }

  async hook(name: Hook) {
    for (const callback of this.hooks[name]) await callback(this.fixture());
  }
  async setup() { await this.hook('beforeAll'); await this.hook('beforeEach'); }
  async body(title: string) {
    const callback = this.tests.get(title);
    if (!callback) throw new Error(`Unknown scenario ${title}`);
    await callback(this.fixture());
  }
  async run(title: string) {
    await this.setup();
    try { await this.body(title); } finally { await this.hook('afterEach'); }
  }
  private fixture(): Fixture {
    return { page: this.page, browser: strict({ newPage: async () => this.setupPage }, 'browser') };
  }
}

// The desired assertion is executed directly for inverse probes as well as gaps.
// An unrelated loader, fake, callback or matcher error cannot satisfy the probe.
export function confirmGap(contract: () => void, message: string) {
  try { contract(); } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(message);
    expect((error as { matcherResult?: unknown }).matcherResult).toBeDefined();
    return (error as Error).message;
  }
  throw new Error('Gap inverse probe unexpectedly met the desired contract');
}

export async function outcome(scenario: Scenario, title: string): Promise<{ error: unknown }> {
  try { await scenario.run(title); return { error: undefined }; }
  catch (error) { return { error }; }
}

export type Gap = {
  name: string;
  matcher: string;
  arrange(): Promise<{ contract(): void; current(): void | Promise<void> }>;
};

export function pinGaps(gaps: Gap[]) {
  for (const gap of gaps) {
    test.failing(`KNOWN GAP: ${gap.name}`, async () => (await gap.arrange()).contract());
    test(`INVERSE: ${gap.name}`, async () => {
      const probe = await gap.arrange();
      await probe.current();
      console.info(`CONFIRMED INVERSE: ${gap.name}\n${confirmGap(probe.contract, gap.matcher)}`);
    });
  }
}
