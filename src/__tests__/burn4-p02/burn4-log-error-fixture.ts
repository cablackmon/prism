import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type LogErrorModule = typeof import('@/lib/utils/logError');

/** Run unchanged master source with synthetic process settings and a fake log. */
export function logger(mode?: string) {
  const sourcePath = resolve(__dirname, '../../lib/utils/logError.ts');
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
  const settings = mode === undefined ? {} : { NODE_ENV: mode };
  runInNewContext(compiled.outputText, {
    module: moduleValue,
    exports: moduleValue.exports,
    process: Object.freeze({ env: Object.freeze(settings) }),
    console: { error: errorLog },
    Error,
  }, { filename: sourcePath, timeout: 1_000 });
  return { log: (moduleValue.exports as LogErrorModule).logError, errorLog };
}
