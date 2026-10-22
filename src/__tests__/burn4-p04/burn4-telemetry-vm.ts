import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ModuleKind, transpileModule } from 'typescript';

type SandboxOptions = {
  env?: Record<string, string | undefined>;
  arch?: string;
  globals?: Record<string, unknown>;
};

/** Execute unchanged current master source with synthetic process and dependencies. */
export function loadTelemetry<T>(
  filename: string,
  dependencies: Record<string, unknown>,
  options: SandboxOptions = {},
): T {
  const sourcePath = resolve(__dirname, '../../lib/telemetry', filename);
  const source = readFileSync(sourcePath, 'utf8');
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS }, fileName: sourcePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  runInNewContext(compiled, {
    module: moduleRecord, exports: moduleRecord.exports, Date, Error,
    process: { env: { ...options.env }, arch: options.arch ?? 'offline-arch' },
    require: (name: string) => {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name)) {
        throw new Error(`Unexpected dependency in offline telemetry VM: ${name}`);
      }
      return dependencies[name];
    },
    ...options.globals,
  }, { filename: sourcePath });
  return moduleRecord.exports as T;
}
