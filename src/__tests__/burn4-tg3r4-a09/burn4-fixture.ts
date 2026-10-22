import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const repository = resolve(__dirname, '../../..');
const sourceBytes = readFileSync(join(repository, 'alexa/deploy.ps1'));
const runtimeCandidates = [join(repository, 'node_modules/.bin/pwsh'), '/usr/bin/pwsh', '/usr/local/bin/pwsh'];
const found = runtimeCandidates.find(path => existsSync(path));
if (!found) throw new Error('PowerShell 7 is required for this explicit package. Install pwsh or link node_modules/.bin/pwsh; see burn4-README.md.');
const runtime = realpathSync(found);
const fixtures: Fixture[] = [];

export type Operation = { operation: string; path: string; arguments?: string[] };
export type Trace = { calls: Operation[]; caller: string; after: string; error: string | null };
export type Result = { status: number; stdout: string; stderr: string; trace: Trace | null };
export type Options = { hostname?: string | null; ask?: 'throw' | 'missing'; fault?: string; nativeStatus?: number };
const manifest = '{"url":"https://prism.example.com/api","repeat":"prism.example.com","label":"fixture"}\n';

function shellQuote(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'"; }

export class Fixture {
  readonly root = mkdtempSync(join(__dirname, 'burn4-fixture-'));
  readonly alexa = join(this.root, 'alexa');
  readonly caller = join(this.root, 'caller');

  constructor() {
    for (const name of ['alexa/interactionModels/custom', 'caller', 'bin', 'cache', 'config', 'data', 'temp']) mkdirSync(join(this.root, name), { recursive: true });
    copyFileSync(join(repository, 'alexa/deploy.ps1'), join(this.alexa, 'deploy.ps1'));
    copyFileSync(join(__dirname, 'burn4-driver.ps1'), join(this.root, 'burn4-driver.ps1'));
    this.write('alexa/skill.json', manifest);
    this.write('alexa/interactionModels/custom/en-US.json', '{"name":"synthetic model"}\n');
    fixtures.push(this);
  }

  path(name: string): string {
    const full = resolve(this.root, name);
    if (full !== this.root && !full.startsWith(this.root + '/')) throw new Error('Fixture path escaped');
    return full;
  }
  write(name: string, value: string): void { const path = this.path(name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
  read(name: string): string { return readFileSync(this.path(name), 'utf8'); }
  exists(name: string): boolean { return existsSync(this.path(name)); }
  remove(name: string): void { rmSync(this.path(name), { recursive: true, force: true }); }

  private prepare(options: Options): { args: string[]; env: Record<string, string> } {
    if (!readFileSync(join(this.alexa, 'deploy.ps1')).equals(sourceBytes)) throw new Error('Subject source copy changed');
    this.remove('trace.json');
    this.write('options.json', JSON.stringify(options));
    const env: Record<string, string> = {
      PATH: join(this.root, 'bin'), PSModulePath: join(dirname(runtime), 'Modules'),
      XDG_CACHE_HOME: join(this.root, 'cache'), XDG_CONFIG_HOME: join(this.root, 'config'), XDG_DATA_HOME: join(this.root, 'data'),
      TMPDIR: join(this.root, 'temp'), POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off',
    };
    if (options.hostname !== null) env.ALEXA_PRISM_HOSTNAME = options.hostname ?? 'fixture.example.invalid';
    const prefix = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File'];
    if (options.nativeStatus !== undefined) {
      if (!Number.isInteger(options.nativeStatus) || options.nativeStatus < 0 || options.nativeStatus > 255) throw new Error('Invalid fake exit status');
      this.write('bin/ask', '#!/bin/sh\npwd > ' + shellQuote(this.path('native-cwd.txt')) + '\nprintf \'%s\\n\' "$@" > ' + shellQuote(this.path('native-args.txt')) + '\nexit ' + options.nativeStatus + '\n');
      chmodSync(this.path('bin/ask'), 0o755);
      return { args: [...prefix, join(this.alexa, 'deploy.ps1')], env };
    }
    this.remove('bin/ask');
    return { args: [...prefix, join(this.root, 'burn4-driver.ps1'), '-Root', this.root, '-OptionsFile', join(this.root, 'options.json')], env };
  }

  private result(status: number, stdout: string, stderr: string): Result {
    return { status, stdout, stderr, trace: this.exists('trace.json') ? JSON.parse(this.read('trace.json')) as Trace : null };
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
export function operations(result: Result): string[] { return result.trace?.calls.map(call => call.operation) ?? []; }
export function invocation(result: Result): Operation | undefined { return result.trace?.calls.find(call => call.operation === 'ask'); }
