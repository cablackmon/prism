import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export type Severity = 'high' | 'medium' | 'ok';
export type Viewport = { name: string; width: number; height: number };
export type Probe = {
  viewportW: number;
  viewportH: number;
  pageOverflowX: number;
  overflowers: unknown[];
  navClipped: boolean;
  navDetail: null;
  index: number;
};
export type Finding = {
  route: string;
  viewport: string;
  width: number;
  height: number;
  scale: number;
  severity: Severity;
  summary: string;
  probe: Probe;
  screenshot: string;
};
export type Report = {
  generatedAtNote: string;
  totals: { checks: number; high: number; medium: number; ok: number };
  findings: Finding[];
};
export type Event = { kind: string; value?: unknown };
export type Screenshot = {
  path: string;
  fullPage: boolean;
  animations: string;
  route: string;
  viewport: { width: number; height: number };
  effectiveScale: number;
};
type Page = {
  setViewportSize(viewport: { width: number; height: number }): Promise<void>;
  goto(route: string): Promise<{ status(): number; ok(): boolean }>;
  waitForLoadState(state: string): Promise<void>;
  waitForTimeout(milliseconds: number): Promise<void>;
  evaluate(callback: unknown, tolerance: number): Promise<Probe>;
  screenshot(options: { path: string; fullPage: boolean; animations: string }): Promise<void>;
  addInitScript(callback: () => void): Promise<void>;
};
type Helpers = {
  execDb(sql: string): void;
  getSeededParentName(): string;
  setDefaultFontScale(scale: number | null): void;
  slug(route: string): string;
  probeRoute(page: Page, route: string, viewport: Viewport, scale: number): Promise<Finding>;
  severityRank(severity: Severity): number;
  VIEWPORTS: Viewport[];
  SCALES: number[];
};
type Options = {
  enabled?: boolean;
  routes?: string[];
  initialScale?: number | null;
  parentOutput?: string;
  navigationStatus?: number;
  failAt?: string;
  failOccurrence?: number;
  failure?: Error;
  severities?: Severity[];
};
type Callback = () => void;
type Sweep = (context: { page: Page }) => Promise<void>;

const source = readFileSync(path.resolve(__dirname, '../../../e2e/ui-audit.spec.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const expose = '\nmodule.exports = { execDb, getSeededParentName, setDefaultFontScale, slug, probeRoute, severityRank, VIEWPORTS, SCALES };';

export function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve: () => void = () => { throw new Error('Deferred was not initialized'); };
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export async function drainMicrotasks(): Promise<void> {
  for (let count = 0; count < 12; count += 1) await Promise.resolve();
}

export function loadAudit(options: Options = {}) {
  const events: Event[] = [];
  const imports: string[] = [];
  const descriptions: string[] = [];
  const beforeAll: Callback[] = [];
  const afterAll: Callback[] = [];
  const tests: { name: string; callback: Sweep }[] = [];
  const writes = new Map<string, string>();
  const storage = new Map<string, string>();
  const holds = new Map<string, Promise<void>>();
  const screenshots: Screenshot[] = [];
  const probes: Probe[] = [];
  const counts = new Map<string, number>();
  const failure = options.failure ?? new Error('Synthetic dependency failure');
  const skip = new Error('Synthetic Playwright skip');
  let scale = options.initialScale ?? null;
  let route = '';
  let viewport = { width: 0, height: 0 };
  const severities: Severity[] = options.severities ?? ['high', 'medium', 'ok'];
  if (severities.length === 0) throw new Error('At least one synthetic severity is required');

  function record(kind: string, value?: unknown): void {
    events.push(value === undefined ? { kind } : { kind, value });
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    if (options.failAt === kind && count === (options.failOccurrence ?? 1)) throw failure;
  }

  async function action(kind: string, value?: unknown): Promise<void> {
    record(kind, value);
    await holds.get(kind);
  }

  function fakeExec(command: string, config: { encoding: string }): string {
    if (config.encoding !== 'utf-8') throw new Error('Unexpected subprocess encoding');
    const prefix = 'docker exec prism-db psql -U prism -d prism ';
    const lookup = prefix + '-At -c "SELECT name FROM users WHERE role = \'parent\' ORDER BY created_at LIMIT 1"';
    if (command === lookup) {
      record('parent-lookup');
      return options.parentOutput ?? '  Fixture Parent\n';
    }
    const match = command.match(/^docker exec prism-db psql -U prism -d prism -c "UPDATE layouts SET font_scale = (NULL|-?\d+(?:\.\d+)?) WHERE is_default = true"$/);
    if (match) {
      const next = match[1] === 'NULL' ? null : Number(match[1]);
      record('scale-change', next);
      scale = next;
      return '';
    }
    throw new Error('Subprocess command denied');
  }

  const detector = () => { throw new Error('Detector must only be passed to fake evaluate'); };
  const page: Page = {
    async setViewportSize(next) { await action('viewport', next); viewport = { ...next }; },
    async goto(next) {
      await action('navigate', next);
      route = next;
      const status = options.navigationStatus ?? 200;
      return { status: () => status, ok: () => status >= 200 && status < 300 };
    },
    async waitForLoadState(state) { await action('networkidle', state); },
    async waitForTimeout(milliseconds) { await action('stabilize', milliseconds); },
    async evaluate(callback, tolerance) {
      if (callback !== detector || tolerance !== 2) throw new Error('Unexpected detector invocation');
      await action('evaluate', tolerance);
      const probe: Probe = {
        viewportW: viewport.width, viewportH: viewport.height,
        pageOverflowX: 0, overflowers: [], navClipped: false, navDetail: null,
        index: probes.length,
      };
      probes.push(probe);
      return probe;
    },
    async screenshot(config) {
      await action('screenshot', config.path);
      screenshots.push({ ...config, route, viewport: { ...viewport }, effectiveScale: route === '/' ? scale ?? 100 : 100 });
    },
    async addInitScript(callback) {
      await action('init-script');
      runInNewContext(`(${callback.toString()})()`, {
        localStorage: {
          setItem(key: string, value: string) { record('storage', key); storage.set(key, value); },
        },
      }, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
    },
  };

  const test = Object.assign(
    (name: string, callback: Sweep) => tests.push({ name, callback }),
    {
      describe(name: string, callback: Callback) { descriptions.push(name); callback(); },
      beforeAll(callback: Callback) { beforeAll.push(callback); },
      afterAll(callback: Callback) { afterAll.push(callback); },
      skip(condition: boolean, _reason: string) { record('skip', condition); if (condition) throw skip; },
      setTimeout(milliseconds: number) { record('test-timeout', milliseconds); },
    },
  );
  const modules: Record<string, unknown> = {
    '@playwright/test': {
      test,
      expect(actual: number) {
        return { toBeGreaterThan(expected: number) {
          record('completion-assertion', actual);
          if (!(actual > expected)) throw new Error('Sweep did not produce findings');
        } };
      },
    },
    child_process: { execSync: fakeExec },
    fs: {
      mkdirSync(directory: string, config: { recursive: boolean }) {
        record('mkdir', { directory, recursive: config.recursive });
      },
      writeFileSync(file: string, content: string) { record('write-report', file); writes.set(file, content); },
    },
    path,
    './helpers/auth': { async loginViaAPI(receivedPage: Page, parent: string) {
      if (receivedPage !== page) throw new Error('Unexpected login page');
      await action('login', parent);
    } },
    './helpers/reset': { resetAll() { record('reset'); } },
    '../src/lib/constants/navItems': { ALL_NAV_ITEMS: (options.routes ?? ['/', '/fixture']).map((href) => ({ href })) },
    './helpers/ui-detectors': {
      layoutProbe: detector,
      gradeProbe(probe: Probe) {
        if (probes[probe.index] !== probe) throw new Error('Unexpected probe identity');
        record('grade', probe.index);
        return { severity: severities[probe.index % severities.length], summary: `synthetic finding ${probe.index}` };
      },
    },
  };
  function importModule(name: string): unknown {
    if (!Object.prototype.hasOwnProperty.call(modules, name)) throw new Error('Import denied');
    imports.push(name);
    return modules[name];
  }
  const moduleBox: { exports: unknown } = { exports: {} };
  const controls: Readonly<Record<string, string | undefined>> = Object.freeze(options.enabled ? { E2E_HAS_TEST_DB: '1' } : {});
  const env = new Proxy(controls, {
    get(target, key) {
      if (key === 'E2E_HAS_TEST_DB') return target[key];
      if (key === 'DATABASE_URL' || key === 'E2E_DB_NAME') return undefined;
      throw new Error('Environment field denied');
    },
    set() { throw new Error('Environment mutation denied'); },
    ownKeys() { throw new Error('Environment enumeration denied'); },
  });
  const normalizedLogs: string[] = [];
  runInNewContext(compiled + expose, {
    require: importModule,
    module: moduleBox,
    exports: moduleBox.exports,
    process: Object.freeze({ env }),
    console: { log(message: string) {
      record('log');
      normalizedLogs.push(message.replace(/\u2014/g, '-'));
    } },
    Date: class { static now() { return 1_000; } },
    setTimeout() { throw new Error('Timer denied'); },
    fetch() { throw new Error('Network denied'); },
  }, {
    timeout: 1000, filename: 'ui-audit-source.vm.js',
    contextCodeGeneration: { strings: false, wasm: false },
  });
  const helpers = moduleBox.exports as Helpers;

  return {
    helpers, page, events, imports, descriptions, beforeAll, afterAll, tests,
    writes, storage, holds, screenshots, probes, failure, skip, normalizedLogs, importModule,
    get effectiveScale() { return scale ?? 100; },
    setup() { for (const callback of beforeAll) callback(); },
    teardown() { for (const callback of afterAll) callback(); },
    sweep() {
      const registered = tests[0];
      if (!registered) throw new Error('Sweep was not registered');
      return registered.callback({ page });
    },
    report(): Report {
      const content = writes.get(path.join('e2e', 'ui-audit-artifacts', 'report.json'));
      if (!content) throw new Error('No synthetic report');
      return JSON.parse(content) as Report;
    },
  };
}
