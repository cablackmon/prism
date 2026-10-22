import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Script } from 'node:vm';
import * as ts from 'typescript';

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

type Validation = (data: unknown) => ValidationResult;
type FileContents = string | Error;
type Entry = {
  id: string;
  file: string;
  name: string;
  mode: string;
  widgetCount: number;
};

export const communityDirectory = path.resolve(__dirname, '../../..', 'community/layouts');
export const indexPath = path.join(communityDirectory, 'index.json');
const sourcePath = path.resolve(__dirname, '../../..', 'scripts/validate-community-layouts.ts');

// Reading the one read-only source is the only host filesystem access in this harness.
// All filesystem calls made by the command itself use the memory map below.
const command = new Script(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: false,
  },
}).outputText, { filename: sourcePath });

export function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'sample-dashboard',
    file: 'sample-dashboard.json',
    name: 'Sample dashboard',
    mode: 'dashboard',
    widgetCount: 1,
    ...overrides,
  };
}

export function layout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Sample dashboard',
    mode: 'dashboard',
    widgets: [{ id: 'sample-clock', type: 'clock' }],
    ...overrides,
  };
}

export function fixtureFiles(entries: unknown[] = [entry()]): Record<string, FileContents> {
  return {
    'index.json': JSON.stringify({ version: 1, layouts: entries }),
    'sample-dashboard.json': JSON.stringify(layout()),
  };
}

export function runCommand(
  files: Record<string, FileContents>,
  validate: Validation = () => ({ valid: true, errors: [], warnings: [] }),
) {
  const memory = new Map(Object.entries(files).map(([name, data]) => [
    path.resolve(communityDirectory, name), data,
  ]));
  const checkedPaths: string[] = [];
  const reads: Array<{ filename: string; encoding: string }> = [];
  const validated: unknown[] = [];
  const dependencies: string[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let exitCode: number | undefined;
  let uncaught: unknown;
  class ExitSignal {}
  const memoryFs = {
    existsSync(filename: string) {
      checkedPaths.push(filename);
      return memory.has(filename);
    },
    readFileSync(filename: string, encoding: string) {
      reads.push({ filename, encoding });
      if (!memory.has(filename)) throw new Error('Missing memory fixture');
      const value = memory.get(filename);
      if (value instanceof Error) throw value;
      return value;
    },
  };
  const validator = {
    validateCommunityLayout(data: unknown) {
      validated.push(data);
      return validate(data);
    },
  };
  const modules: Record<string, unknown> = {
    fs: memoryFs,
    path,
    '../src/lib/community/validateLayout': validator,
  };
  try {
    command.runInNewContext({
      __dirname: path.dirname(sourcePath),
      exports: {},
      require(name: string) {
        dependencies.push(name);
        if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected module: ${name}`);
        return modules[name];
      },
      process: Object.freeze({
        exit(code: number) {
          exitCode = code;
          throw new ExitSignal();
        },
      }),
      console: {
        log: (...values: unknown[]) => logs.push(values.map(String).join(' ')),
        warn: (...values: unknown[]) => warnings.push(values.map(String).join(' ')),
        error: (...values: unknown[]) => errors.push(values.map(String).join(' ')),
      },
    }, { timeout: 1000 });
  } catch (error) {
    if (!(error instanceof ExitSignal)) uncaught = error;
  }
  return { exitCode, uncaught, logs, warnings, errors, reads, checkedPaths, validated, dependencies };
}
