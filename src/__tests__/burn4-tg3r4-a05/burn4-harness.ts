import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import type { Options, Result, RunTrace } from './burn4-protocol';

const source = readFileSync(resolve(process.cwd(), 'scripts/smoke-caldav-write.mjs'), 'utf8');
const runner = ts.transpileModule(readFileSync(resolve(__dirname, 'burn4-sandbox-runner.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

export function run(options: Options = {}): Result {
  const child = spawnSync(process.execPath, ['-e', runner], {
    input: JSON.stringify({ source, options }),
    encoding: 'utf8',
    env: {},
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  if (child.stderr) throw new Error(`Sandbox failure: ${child.stderr}`);
  if (!child.stdout) throw new Error(`Missing sandbox result, status ${child.status}`);
  return { ...(JSON.parse(child.stdout) as Omit<Result, 'status'>), status: child.status ?? -1 };
}
export function first(result: Result): RunTrace {
  const trace = result.runs[0];
  if (!trace) throw new Error('Missing first execution');
  return trace;
}
export function calls(trace: RunTrace, name: string): unknown[] {
  return trace.calls.filter(call => call.name === name).map(call => call.detail);
}
export function names(trace: RunTrace): string[] { return trace.calls.map(call => call.name); }
