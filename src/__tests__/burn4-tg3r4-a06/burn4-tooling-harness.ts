import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { SearchSource } from '@jest/core';
import type { TestContext } from '@jest/test-result';
import type { Config } from '@jest/types';
import { ESLint } from 'eslint';
import { normalize } from 'jest-config';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

export const repositoryRoot = resolve(__dirname, '../../..');

type ModuleRecord = { exports: unknown };

function evaluateModule<T>(
  filename: string,
  dependencies: Record<string, unknown> = {},
  globals: Record<string, unknown> = {},
): T {
  const sourcePath = resolve(repositoryRoot, filename);
  const source = readFileSync(sourcePath, 'utf8');
  // CommonJS VM evaluation needs the equivalent file URL for the ESM meta value.
  // This changes only module-location syntax in memory, never repository source.
  const compatibleSource = source.replaceAll(
    'import.meta.url',
    JSON.stringify(pathToFileURL(sourcePath).href),
  );
  const { outputText } = transpileModule(compatibleSource, {
    // A .mjs parser filename would force ESM output despite module: CommonJS.
    fileName: `${filename}.ts`,
    compilerOptions: {
      allowJs: true,
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
  });
  const moduleRecord: ModuleRecord = { exports: {} };
  new Script(outputText, { filename }).runInNewContext({
    ...globals,
    module: moduleRecord,
    exports: moduleRecord.exports,
    require: (specifier: string) => {
      if (!Object.hasOwn(dependencies, specifier)) {
        throw new Error(`Unexpected config dependency: ${specifier}`);
      }
      return dependencies[specifier];
    },
  }, { timeout: 10_000 });
  return moduleRecord.exports as T;
}

export type BrowserPolicy = {
  forbidOnly: boolean;
  retries: number;
  workers?: number;
  testDir: string;
  testIgnore: string[];
  fullyParallel: boolean;
  globalTeardown: string;
  use: { baseURL: string; trace: string };
  projects: { name: string; use: { viewport: { width: number; height: number } } }[];
  webServer: { command: string; url: string; reuseExistingServer: boolean };
};

export function browserPolicy(ci?: string) {
  const reads: string[] = [];
  const defineConfig = jest.fn((config: BrowserPolicy) => config);
  const environment = new Proxy({}, {
    get: (_target, key: string) => {
      if (key !== 'CI') throw new Error(`Unexpected environment lookup: ${key}`);
      reads.push(key);
      return ci;
    },
  });
  const evaluated = evaluateModule<{ default: BrowserPolicy }>('playwright.config.ts', {
    '@playwright/test': {
      defineConfig,
      devices: { 'Desktop Chrome': { viewport: { width: 1280, height: 720 } } },
    },
  }, { process: { env: environment } });
  return { policy: evaluated.default, reads, defineConfig };
}

export function eslintEngine() {
  const packageRequire = createRequire(resolve(repositoryRoot, 'eslint.config.mjs'));
  const config = evaluateModule<{ default: NonNullable<ESLint.Options['overrideConfig']> }>(
    'eslint.config.mjs',
    {
      path: { dirname },
      url: { fileURLToPath },
      '@eslint/eslintrc': packageRequire('@eslint/eslintrc'),
    },
  ).default;
  return new ESLint({
    cwd: repositoryRoot,
    overrideConfigFile: true,
    overrideConfig: config,
  });
}

export async function jestDiscovery(filename: 'jest.config.js' | 'jest.integration.config.js') {
  const sourceConfig = evaluateModule<Config.InitialOptions>(filename);
  const { options } = await normalize(
    { ...sourceConfig, rootDir: repositoryRoot },
    { _: [], $0: 'burn4-discovery-only' },
    resolve(repositoryRoot, filename),
  );
  // SearchSource's path predicate needs only config. Other context access fails
  // closed, so these checks cannot scan files, resolve imports or run tests.
  const context = new Proxy({ config: options }, {
    get: (target, key) => {
      if (key !== 'config') throw new Error(`Discovery context access forbidden: ${String(key)}`);
      return target.config;
    },
  }) as unknown as TestContext;
  const discovery = new SearchSource(context);
  return {
    accepts: (relativePath: string) => discovery.isTestFilePath(resolve(repositoryRoot, relativePath)),
    options,
  };
}

export type ObservedEntry = {
  target: object;
  contentRect: { width: number; height: number };
};
export type Observer = {
  observe: (target: object) => void;
  unobserve: () => void;
  disconnect: () => void;
};

export function observerSetup() {
  const globals = {} as {
    ResizeObserver: new (callback: (entries: ObservedEntry[], observer: Observer) => void) => Observer;
  };
  new Script(readFileSync(resolve(repositoryRoot, 'jest.setup.js'), 'utf8'), {
    filename: 'jest.setup.js',
  }).runInNewContext({ global: globals }, { timeout: 1_000 });
  return globals.ResizeObserver;
}
