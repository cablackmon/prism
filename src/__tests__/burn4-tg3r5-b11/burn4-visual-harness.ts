import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export type Action = 'initScript' | 'login' | 'viewport' | 'goto' | 'networkidle' |
  'settle' | 'click' | 'selector' | 'screenshot';
export type Step = {
  action: Action;
  phase: 'start' | 'finish';
  route?: string;
  selector?: string;
  duration?: number;
  name?: string;
};
export type StepHook = (step: Step) => void | Promise<void>;
export type ClientFlags = { theme?: 'light' | 'dark'; perfMode?: boolean };
export type CalendarPrefs = { viewType: string; displayMode?: 'inline' | 'cards'; weekCount?: number };
export type Locator = Readonly<{ selector: string; owner: FakePage }>;
type InitCallback = (argument: unknown) => void;
type Registered = { name: string; callback: (args: { page: FakePage }) => Promise<void> };
type SnapshotOptions = {
  maxDiffPixelRatio: number;
  animations: string;
  fullPage: boolean;
  mask?: Locator[];
};
export type Screenshot = {
  name: string;
  maxDiffPixelRatio: number;
  animations: string;
  fullPage: boolean;
  maskSelectors?: string[];
  storage: Record<string, string>;
  viewport: { width: number; height: number };
};
type Helpers = {
  setClientFlags: (page: FakePage, opts?: ClientFlags) => Promise<void>;
  setCalendarPrefs: (page: FakePage, opts: CalendarPrefs) => Promise<void>;
  dynamicMasks: (page: FakePage) => Locator[];
};
type ScriptRunner = (callback: InitCallback, argument: unknown, page: FakePage) => void;

export class SkippedScenario extends Error {}
export class DeniedDatabaseSetup extends Error {}

export class FakePage {
  readonly events: Step[] = [];
  readonly routes: string[] = [];
  readonly screenshots: Screenshot[] = [];
  readonly storage = new Map<string, string>();
  readonly locators: Locator[] = [];
  readonly initArguments: unknown[] = [];
  viewport = { width: 1920, height: 1080 };
  private readonly scripts: { callback: InitCallback; argument: unknown }[] = [];

  constructor(private readonly runScript: ScriptRunner, private readonly hook?: StepHook) {}

  async step(action: Action, detail: Omit<Step, 'action' | 'phase'> = {}): Promise<void> {
    const event: Step = { action, phase: 'start', ...detail };
    this.events.push(event);
    await this.hook?.(event);
    this.events.push({ ...event, phase: 'finish' });
  }

  async addInitScript(callback: InitCallback, argument: unknown): Promise<void> {
    await this.step('initScript');
    this.scripts.push({ callback, argument });
    this.initArguments.push(argument);
  }

  executeInitScripts(): void {
    for (const script of this.scripts) this.runScript(script.callback, script.argument, this);
  }

  async setViewportSize(size: { width: number; height: number }): Promise<void> {
    await this.step('viewport');
    this.viewport = { ...size };
  }

  async goto(route: string): Promise<void> {
    if (!route.startsWith('/')) throw new Error('Only inert relative routes are allowed');
    await this.step('goto', { route });
    this.routes.push(route);
    this.executeInitScripts();
  }

  async waitForLoadState(state: string): Promise<void> {
    if (state !== 'networkidle') throw new Error('Unexpected inert load state');
    await this.step('networkidle');
  }

  async waitForTimeout(duration: number): Promise<void> {
    await this.step('settle', { duration });
  }

  async click(selector: string): Promise<void> {
    await this.step('click', { selector });
  }

  async waitForSelector(selector: string, options: { timeout: number }): Promise<void> {
    if (options.timeout !== 5000) throw new Error('Unexpected inert selector timeout');
    await this.step('selector', { selector });
  }

  locator(selector: string): Locator {
    const locator = Object.freeze({ selector, owner: this });
    this.locators.push(locator);
    return locator;
  }

  async capture(name: string, options: SnapshotOptions): Promise<void> {
    if (options.mask?.some((locator) => locator.owner !== this)) {
      throw new Error('Foreign inert locator');
    }
    await this.step('screenshot', { name });
    this.screenshots.push({
      name,
      maxDiffPixelRatio: options.maxDiffPixelRatio,
      animations: options.animations,
      fullPage: options.fullPage,
      ...(options.mask ? { maskSelectors: options.mask.map((locator) => locator.selector) } : {}),
      storage: Object.fromEntries(this.storage),
      viewport: { ...this.viewport },
    });
  }
}

const sourcePath = resolve(__dirname, '../../../e2e/visual-regression.spec.ts');
const source = readFileSync(sourcePath, 'utf8');
const syntax = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
const helperNames = ['setClientFlags', 'setCalendarPrefs', 'dynamicMasks'];
const exactHelpers = new Map<string, string>();
function visit(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name && helperNames.includes(node.name.text)) {
    exactHelpers.set(node.name.text, node.getText(syntax));
  }
  ts.forEachChild(node, visit);
}
visit(syntax);
if (exactHelpers.size !== helperNames.length) throw new Error('Missing exact source helper');

function compile(text: string): string {
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText;
}
const compiled = compile(source);
// Only wrapper exposure is added. The exact AST function text and bodies are unchanged.
const helperCompiled = compile(
  [...exactHelpers.values()].join('\n') + '\nexports.helpers = { setClientFlags, setCalendarPrefs, dynamicMasks };',
);

export function loadVisualHarness(enabled = true): {
  scenarios: Registered[];
  helpers: Helpers;
  makePage: (hook?: StepHook) => FakePage;
  run: (name: string, page?: FakePage) => Promise<FakePage>;
  beforeAll: () => void;
  useOptions: unknown[];
  environmentKeys: () => string[];
  resetAttempts: () => number;
  commandAttempts: () => number;
  deniedSetup: DeniedDatabaseSetup;
} {
  const scenarios: Registered[] = [];
  const beforeAllCallbacks: (() => void)[] = [];
  const useOptions: unknown[] = [];
  const deniedSetup = new DeniedDatabaseSetup('Synthetic database setup is denied');
  let resetCount = 0;
  let commandCount = 0;
  let activePage: FakePage | undefined;
  const environment = new Proxy(Object.freeze(enabled ? { E2E_HAS_TEST_DB: '1' } : {}), {
    get: (target, name) => {
      if (name !== 'E2E_HAS_TEST_DB') throw new Error('Connection environment access is denied');
      return Reflect.get(target, name);
    },
  });
  const register = Object.assign(
    (name: string, callback: Registered['callback']) => { scenarios.push({ name, callback }); },
    {
      describe: (_name: string, callback: () => void) => { callback(); },
      beforeAll: (callback: () => void) => { beforeAllCallbacks.push(callback); },
      use: (options: unknown) => { useOptions.push(options); },
      skip: (condition: boolean) => { if (condition) throw new SkippedScenario('Inert scenario skipped'); },
    },
  );
  const modules: Record<string, unknown> = {
    '@playwright/test': {
      test: register,
      expect: (page: FakePage) => {
        if (!(page instanceof FakePage)) throw new Error('Unexpected inert expectation target');
        return { toHaveScreenshot: (name: string, options: SnapshotOptions) => page.capture(name, options) };
      },
    },
    child_process: { execSync: () => {
      commandCount++;
      throw new Error('All subprocess commands are denied');
    } },
    './helpers/auth': {
      // JavaScript discards the unused parent argument. No auth-shaped data is recorded.
      loginViaAPI: (page: FakePage) => page.step('login'),
    },
    './helpers/reset': { resetAll: () => { resetCount++; throw deniedSetup; } },
  };
  const context = {
    exports: {},
    process: Object.freeze({ env: environment }),
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error('Unlisted inert import is denied');
      return modules[name];
    },
    localStorage: Object.freeze({
      setItem: (key: string, value: string) => {
        if (!activePage) throw new Error('No synthetic page storage is active');
        activePage.storage.set(key, value);
      },
    }),
    console: Object.freeze({
      log: () => { throw new Error('Source logging is denied'); },
      error: () => { throw new Error('Source logging is denied'); },
    }),
  };
  runInNewContext(compiled, context, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false }, filename: 'burn4-inert-visual-source.js' });
  const helperExports: { helpers?: Helpers } = {};
  runInNewContext(helperCompiled, { ...context, exports: helperExports }, {
    timeout: 1000, contextCodeGeneration: { strings: false, wasm: false }, filename: 'burn4-exact-visual-helpers.js',
  });
  if (!helperExports.helpers || beforeAllCallbacks.length !== 1) {
    throw new Error('Unexpected inert helper or lifecycle registration');
  }
  const makePage = (hook?: StepHook): FakePage => new FakePage((callback, argument, page) => {
    const previousPage = activePage;
    activePage = page;
    try { callback(argument); } finally { activePage = previousPage; }
  }, hook);
  return {
    scenarios,
    helpers: helperExports.helpers,
    makePage,
    run: async (name, page = makePage()) => {
      const scenario = scenarios.find((entry) => entry.name === name);
      if (!scenario) throw new Error('Unknown registered inert scenario');
      await scenario.callback({ page });
      return page;
    },
    beforeAll: () => { beforeAllCallbacks[0]?.(); },
    useOptions,
    environmentKeys: () => Object.keys(environment),
    resetAttempts: () => resetCount,
    commandAttempts: () => commandCount,
    deniedSetup,
  };
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let finish: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => { finish = resolve; });
  return { promise, resolve: () => { finish?.(); } };
}
