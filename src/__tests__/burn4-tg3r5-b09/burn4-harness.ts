import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type Finding = { file: string; method: string; line: number; column: number; path: string[]; excepted?: string };
export type Diagnostic = { file: string; line: number; column: number; code: string; message: string; method?: string };
export type Analysis = { findings: Finding[]; diagnostics: Diagnostic[] };
export type Report = Analysis & { files: string[]; limitations: string[] };
export const sourceFile = 'src/app/api/synthetic/route.ts';
const driver = resolve(__dirname, 'burn4-driver.mjs');
const executable = resolve(__dirname, '../../../scripts/burn4-display-auth-audit.mjs');
export const auth = "import {getDisplayAuth as read} from '@/lib/auth';\n";

export class Fixture {
  readonly root = mkdtempSync('/tmp/burn4-b09-');
  write(file: string, source: string): void {
    mkdirSync(dirname(join(this.root, file)), { recursive: true });
    writeFileSync(join(this.root, file), source);
  }
  api<T>(input: Record<string, unknown>): T {
    const result = spawnSync(process.execPath, [driver], {
      cwd: this.root, env: {}, input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 || result.stderr) throw new Error('Synthetic API driver failed');
    const decoded = JSON.parse(result.stdout) as { value?: T; error?: string };
    if (decoded.error) throw new Error(decoded.error);
    return decoded.value as T;
  }
  analyze(source: string, file = sourceFile): Analysis { return this.api({ operation: 'analyze', source, file }); }
  cli(args: string[]): { exitCode: number; report: Report; output: string } {
    const value = this.api<{ exitCode: number; output: string }>({ operation: 'cli', args: ['--root', this.root, '--json', ...args] });
    return { ...value, report: JSON.parse(value.output) as Report };
  }
  execute(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [executable, '--root', this.root, ...args], {
      cwd: this.root, env: {}, encoding: 'utf8', timeout: 15_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }
  dispose(): void { rmSync(this.root, { recursive: true, force: true }); }
}
