import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const repository = resolve(__dirname, '../../..');
const source = readFileSync(join(repository, 'scripts/setup-https.ps1'));
const candidates = [join(repository, 'node_modules/.bin/pwsh'), '/usr/bin/pwsh', '/usr/local/bin/pwsh'];
const found = candidates.find(candidate => existsSync(candidate));
if (!found) throw new Error('PowerShell 7 required. See burn4-README.md for the explicit runtime prerequisite.');
const runtime = realpathSync(found);
const fixtures: Fixture[] = [];

export type Stage = 'install' | 'mkdir' | 'push' | 'generate' | 'pop' | 'caroot' | 'join';
export type Options = {
  server?: string | null;
  missingTool?: boolean;
  fault?: Stage;
  nativeFailure?: 'install' | 'generate' | 'caroot';
  nativeStatus?: number;
  probe?: string;
};
export type Call = { operation: string; cwd: string; arguments: string[]; status: number };
export type Trace = {
  calls: Call[];
  caller: string;
  after: string;
  stackDepth: number;
  error: string | null;
  subjectStarted: boolean;
  gatesVerified: boolean;
};
export type Result = { status: number; trace: Trace; stdout: string; stderr: string };

export class Fixture {
  readonly root = mkdtempSync('/tmp/burn4-https-');
  readonly caller = join(this.root, 'caller');
  readonly subject = join(this.root, 'scripts/burn4-subject.ps1');
  readonly certDirectory = join(this.root, 'config/certs');
  readonly caDirectory = join(this.root, 'ordinary-ca-location');

  constructor() {
    for (const part of ['scripts', 'caller', 'bin', 'cache', 'config', 'data', 'temp']) mkdirSync(join(this.root, part), { recursive: true });
    copyFileSync(join(repository, 'scripts/setup-https.ps1'), this.subject);
    copyFileSync(join(__dirname, 'burn4-driver.ps1'), join(this.root, 'burn4-driver.ps1'));
    fixtures.push(this);
  }

  private prepare(options: Options): { args: string[]; env: Record<string, string> } {
    if (!readFileSync(this.subject).equals(source)) throw new Error('Unchanged subject bytes required');
    const status = options.nativeStatus ?? 9;
    if (!Number.isInteger(status) || status < 0 || status > 255) throw new Error('Invalid simulated native status');
    writeFileSync(join(this.root, 'burn4-options.json'), JSON.stringify({ ...options, nativeStatus: status }));
    const env: Record<string, string> = {
      PATH: join(this.root, 'bin'),
      PSModulePath: join(dirname(runtime), 'Modules'),
      XDG_CACHE_HOME: join(this.root, 'cache'),
      XDG_CONFIG_HOME: join(this.root, 'config'),
      XDG_DATA_HOME: join(this.root, 'data'),
      TMPDIR: join(this.root, 'temp'),
      POWERSHELL_TELEMETRY_OPTOUT: '1',
      POWERSHELL_UPDATECHECK: 'Off',
    };
    return { args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(this.root, 'burn4-driver.ps1'), '-Root', this.root], env };
  }

  private result(status: number, stdout: string, stderr: string): Result {
    const trace = JSON.parse(readFileSync(join(this.root, 'burn4-trace.json'), 'utf8')) as Trace;
    return { status, stdout, stderr, trace };
  }

  run(options: Options = {}): Result {
    const { args, env } = this.prepare(options);
    const child = spawnSync(runtime, args, { cwd: this.caller, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    if (child.error) throw child.error;
    return this.result(child.status ?? -1, child.stdout, child.stderr);
  }

  async runAsync(options: Options = {}): Promise<Result> {
    const { args, env } = this.prepare(options);
    return new Promise((accept, reject) => {
      const child = spawn(runtime, args, { cwd: this.caller, env });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('PowerShell fixture timed out')); }, 10000);
      child.stdout.setEncoding('utf8').on('data', (value: string) => { stdout += value; });
      child.stderr.setEncoding('utf8').on('data', (value: string) => { stderr += value; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', status => { clearTimeout(timer); accept(this.result(status ?? -1, stdout, stderr)); });
    });
  }
}

export function fixture(): Fixture { return new Fixture(); }
export function cleanup(): void { for (const item of fixtures.splice(0)) rmSync(item.root, { recursive: true, force: true }); }
export function operations(result: Result): string[] { return result.trace.calls.filter(call => call.operation !== 'message').map(call => call.operation); }
export function messages(result: Result): string { return result.trace.calls.filter(call => call.operation === 'message').map(call => call.arguments.join(' ')).join('\n'); }
export function call(result: Result, operation: string): Call | undefined { return result.trace.calls.find(item => item.operation === operation); }
