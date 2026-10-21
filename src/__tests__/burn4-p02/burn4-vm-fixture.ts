import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Options = {
  settings?: Record<string, string>;
  dependencies?: Record<string, unknown>;
};

/** Execute unchanged real source with synthetic process settings and imports. */
export function loadUtility<T>(name: 'browserFetch' | 'logError', options: Options = {}) {
  const sourcePath = resolve(__dirname, `../../lib/utils/${name}.ts`);
  const source = readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  const moduleValue = { exports: {} };
  const errorLog = jest.fn();
  const dependencies = options.dependencies ?? {};
  const requireDependency = jest.fn((name: string) => {
    if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
    throw new Error(`No offline fixture for ${name}`);
  });
  runInNewContext(compiled.outputText, {
    module: moduleValue,
    exports: moduleValue.exports,
    require: requireDependency,
    process: Object.freeze({ env: Object.freeze({ ...options.settings }) }),
    console: { error: errorLog },
    Error,
  }, { filename: sourcePath, timeout: 1_000 });
  return { exports: moduleValue.exports as T, errorLog, requireDependency };
}
