import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type Stage = 'ready' | 'sleep' | 'migrate' | 'clear' | 'seed' | 'server' | 'dev';
export type Entrypoint = 'production' | 'screenshots';
export type Event = { stage: Stage; pid: number };
export type Result = { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; events: Event[] };
type Options = {
  omit?: Array<'node' | 'npx' | 'npm' | 'sleep'>;
  statuses?: Partial<Record<Stage, number>>;
  readiness?: number[];
  stdout?: Partial<Record<Stage, string>>;
  stderr?: Partial<Record<Stage, string>>;
  hold?: 'server' | 'dev';
};
export type Running = {
  child: ChildProcessWithoutNullStreams;
  completed: Promise<Result>;
  event: (stage: Stage) => Promise<Event>;
  stop: () => Promise<void>;
};

const packageRoot = resolve(__dirname, '../../..');
const scratchRoot = join(__dirname, 'burn4-fixtures');
const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
const probe = "const p=require('postgres')(process.env.DATABASE_URL);p`SELECT 1`.then(()=>{p.end();process.exit(0)}).catch(()=>process.exit(1))";

function fake(command: string): string {
  const dispatch: Record<string, string> = {
    node: `if [ "$#" -eq 1 ] && [ "$1" = /app/scripts/migrate.js ]; then
  stage=migrate
elif [ "$#" -eq 1 ] && [ "$1" = /app/server.js ]; then
  stage=server
elif [ "$#" -eq 2 ] && [ "$1" = -e ] && [ "$2" = ${quote(probe)} ]; then
  stage=ready
else
  printf '%s\\n' 'unexpected node invocation' >&2
  exit 96
fi`,
    npx: `if [ "$#" -eq 2 ] && [ "$1" = tsx ] && [ "$2" = /app/src/lib/db/clear.ts ]; then
  stage=clear
elif [ "$#" -eq 2 ] && [ "$1" = tsx ] && [ "$2" = /app/src/lib/db/seed.ts ]; then
  stage=seed
else
  printf '%s\\n' 'unexpected npx invocation' >&2
  exit 96
fi`,
    npm: `if [ "$#" -eq 2 ] && [ "$1" = run ] && [ "$2" = dev ]; then
  stage=dev
else
  printf '%s\\n' 'unexpected npm invocation' >&2
  exit 96
fi`,
    sleep: `if [ "$#" -eq 1 ] && [ "$1" = 1 ]; then
  stage=sleep
else
  printf '%s\\n' 'unexpected sleep invocation' >&2
  exit 96
fi`,
  };
  const selected = dispatch[command];
  if (!selected) throw new Error('fake command is not allowed');
  return `#!/bin/sh
set -eu
${selected}
printf '%s:%s\\n' "$stage" "$$" >> events
if [ -f "stdout.$stage" ]; then
  IFS= read -r line < "stdout.$stage"
  printf '%s\\n' "$line"
fi
if [ -f "stderr.$stage" ]; then
  IFS= read -r line < "stderr.$stage"
  printf '%s\\n' "$line" >&2
fi
status=0
if [ "$stage" = ready ]; then
  count=0
  if [ -f readiness-count ]; then IFS= read -r count < readiness-count; fi
  count=$((count + 1))
  printf '%s\\n' "$count" > readiness-count
  if [ -f "ready.$count" ]; then
    IFS= read -r status < "ready.$count"
  else
    printf '%s\\n' 'readiness fixture exhausted' >&2
    exit 97
  fi
elif [ -f "status.$stage" ]; then
  IFS= read -r status < "status.$stage"
fi
if [ -f "hold.$stage" ] && [ "$status" -eq 0 ]; then
  trap 'printf "term:%s\\n" "$$" >> signals; exit 143' TERM
  trap 'printf "int:%s\\n" "$$" >> signals; exit 130' INT
  printf '%s:%s\\n' "$stage" "$$" >> holding
  while IFS= read -r line; do :; done
fi
exit "$status"
`;
}

export class StartupFixture {
  readonly root: string;
  private readonly bin: string;
  private readonly options: Options;

  constructor(options: Options = {}) {
    this.options = options;
    mkdirSync(scratchRoot, { recursive: true });
    this.root = mkdtempSync(join(scratchRoot, 'burn4 startup '));
    this.bin = join(this.root, 'bin');
    mkdirSync(this.bin);
    for (const command of ['node', 'npx', 'npm', 'sleep'] as const) {
      if (options.omit?.includes(command)) continue;
      const target = join(this.bin, command);
      writeFileSync(target, fake(command));
      chmodSync(target, 0o700);
    }
    for (const [stage, status] of Object.entries(options.statuses ?? {})) {
      if (!Number.isInteger(status) || status < 0 || status > 255) throw new Error('invalid synthetic status');
      writeFileSync(join(this.root, `status.${stage}`), `${status}\n`);
    }
    for (const [index, status] of (options.readiness ?? [0]).entries()) {
      if (!Number.isInteger(status) || status < 0 || status > 255) throw new Error('invalid synthetic readiness status');
      writeFileSync(join(this.root, `ready.${index + 1}`), `${status}\n`);
    }
    for (const stream of ['stdout', 'stderr'] as const) {
      for (const [stage, value] of Object.entries(options[stream] ?? {})) {
        if (value.includes('\n')) throw new Error('fixture messages must be one line');
        writeFileSync(join(this.root, `${stream}.${stage}`), `${value}\n`);
      }
    }
    if (options.hold) writeFileSync(join(this.root, `hold.${options.hold}`), 'hold\n');
  }

  private source(entrypoint: Entrypoint): string {
    return join(packageRoot, 'docker', entrypoint === 'production' ? 'entrypoint.sh' : 'entrypoint-screenshots.sh');
  }

  events(): Event[] {
    const path = join(this.root, 'events');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
      const [stage, pid] = line.split(':');
      return { stage: stage as Stage, pid: Number(pid) };
    });
  }

  signals(): string[] {
    const path = join(this.root, 'signals');
    return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [];
  }

  run(entrypoint: Entrypoint): Result {
    if (this.options.hold) throw new Error('use start for a held fake');
    const result = spawnSync('/bin/sh', [this.source(entrypoint)], {
      cwd: this.root,
      env: { PATH: this.bin },
      encoding: 'utf8',
      timeout: 1500,
      maxBuffer: 128 * 1024,
    });
    if (result.error) throw result.error;
    return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, events: this.events() };
  }

  start(entrypoint: Entrypoint): Running {
    const child = spawn('/bin/sh', [this.source(entrypoint)], { cwd: this.root, env: { PATH: this.bin }, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    let closed = false;
    const deadline = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 2000);
    const completed = new Promise<Result>((resolveResult, reject) => {
      child.once('error', (error) => { clearTimeout(deadline); reject(error); });
      child.once('close', (status, signal) => {
        closed = true;
        clearTimeout(deadline);
        resolveResult({ status, signal, stdout, stderr, events: this.events() });
      });
    });
    return {
      child,
      completed,
      event: async (stage) => {
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          const found = this.events().find((event) => event.stage === stage);
          const holding = existsSync(join(this.root, 'holding'));
          if (found && (!this.options.hold || holding)) return found;
          if (closed) throw new Error(`fake exited before ${stage}`);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
        }
        throw new Error(`fake did not reach ${stage}`);
      },
      stop: async () => {
        if (!closed) child.kill('SIGKILL');
        await completed;
      },
    };
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

export const stages = (result: Result): Stage[] => result.events.map((event) => event.stage);
