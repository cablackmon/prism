import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type RuntimeModule = typeof import('../../lib/config/runtime');

/** Execute unchanged current-master source using only synthetic process values. */
export function loadRuntime(settings: Record<string, string> = {}, cwd = '/synthetic/prism') {
  const filename = path.resolve(__dirname, '../../lib/config/runtime.ts');
  const source = readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  const moduleValue = { exports: {} };
  const currentDirectory = jest.fn(() => cwd);
  const requireDependency = jest.fn((name: string) => {
    if (name === 'path') return path;
    throw new Error(`No offline fixture for ${name}`);
  });
  runInNewContext(compiled.outputText, {
    exports: moduleValue.exports,
    module: moduleValue,
    require: requireDependency,
    process: Object.freeze({
      env: Object.freeze({ ...settings }),
      cwd: currentDirectory,
    }),
  }, { filename, timeout: 1_000 });
  return {
    runtime: moduleValue.exports as RuntimeModule,
    currentDirectory,
    requireDependency,
  };
}
