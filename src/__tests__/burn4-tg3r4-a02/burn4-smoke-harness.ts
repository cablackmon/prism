import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';

export type Frame = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

type SpawnRecord = {
  executable: string;
  args: string[];
  environmentKeys: string[];
  stdio: string[];
};

type Options = {
  onWrite?: (frame: Frame, harness: SmokeHarness) => void;
  spawnFailure?: string;
};

type Interval = { callback: () => void; every: number; next: number };

export const requiredNames = [
  'list_family', 'list_chores', 'add_shopping_item',
  'complete_chore', 'get_weather', 'list_recipes',
];

export function initialization(id: number | string = 1): Frame {
  return {
    jsonrpc: '2.0', id,
    result: { serverInfo: { name: 'burn4-fixture', version: '0.0.0' } },
  };
}

export function toolsResponse(names = requiredNames, id: number | string = 2): Frame {
  return { jsonrpc: '2.0', id, result: { tools: names.map(name => ({ name })) } };
}

/** Runs the existing CLI body with only inert process and transport objects. */
export class SmokeHarness {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = new EventEmitter();
  readonly child = new EventEmitter();
  readonly writes: Frame[] = [];
  readonly wireWrites: string[] = [];
  readonly spawns: SpawnRecord[] = [];
  readonly logs: string[] = [];
  readonly errors: string[] = [];
  readonly stderrWrites: string[] = [];
  readonly exits: number[] = [];
  readonly escapes: unknown[] = [];
  readonly emittedErrors: unknown[] = [];
  kills = 0;
  now = 0;
  settled = false;
  private readonly intervals = new Map<number, Interval>();
  private nextInterval = 0;
  private readonly execution: Promise<void>;

  constructor(private readonly options: Options = {}) {
    const original = readFileSync(join(__dirname, '../../..', '.mcp/smoke.mjs'), 'utf8');
    const importLines = [
      "import { spawn } from 'node:child_process';",
      "import { fileURLToPath } from 'node:url';",
      "import { dirname, join } from 'node:path';",
    ];
    let body = original;
    for (const line of importLines) {
      if (body.split(line).length !== 2) throw new Error('Unexpected smoke import shape');
      body = body.replace(line, '');
    }
    if (body.split('import.meta.url').length !== 2) throw new Error('Unexpected smoke URL shape');
    body = body.replace('import.meta.url', 'scriptUrl');
    const inertChild = Object.assign(this.child, {
      stdout: this.stdout,
      stderr: this.stderr,
      stdin: Object.assign(this.stdin, {
        write: (text: string) => {
          this.wireWrites.push(text);
          const frame = JSON.parse(text) as Frame;
          this.writes.push(frame);
          this.options.onWrite?.(frame, this);
          return true;
        },
      }),
      kill: () => {
        this.kills += 1;
        return true;
      },
    });
    const fakeProcess = {
      env: Object.create(null) as Record<string, never>,
      stderr: { write: (text: string) => { this.stderrWrites.push(text); return true; } },
      exit: (code: number) => { this.exits.push(code); },
    };
    const context = createContext({
      scriptUrl: 'file:///burn4-fixture/.mcp/smoke.mjs',
      dirname, join, fileURLToPath,
      spawn: (executable: string, args: string[], config: { env: Record<string, unknown>; stdio: string[] }) => {
        this.spawns.push({
          executable, args: [...args],
          environmentKeys: Object.keys(config.env).sort(), stdio: [...config.stdio],
        });
        if (this.options.spawnFailure) throw new Error(this.options.spawnFailure);
        return inertChild;
      },
      process: fakeProcess,
      console: {
        log: (...items: unknown[]) => this.logs.push(items.map(String).join(' ')),
        error: (...items: unknown[]) => this.errors.push(items.map(String).join(' ')),
      },
      Date: { now: () => this.now },
      setInterval: (callback: () => void, every: number) => {
        const id = ++this.nextInterval;
        this.intervals.set(id, { callback, every, next: this.now + every });
        return id;
      },
      clearInterval: (id: number) => { this.intervals.delete(id); },
    }, { codeGeneration: { strings: false, wasm: false } });
    const outcome = new Script(`(async () => {\n${body}\n})()`, {
      filename: '.mcp/smoke.mjs',
    }).runInContext(context, { timeout: 1000 }) as Promise<unknown>;
    this.execution = Promise.resolve(outcome).then(
      () => { this.settled = true; },
      error => { this.escapes.push(error); this.settled = true; },
    );
  }

  get pendingTimers(): number { return this.intervals.size; }

  async flush(): Promise<void> {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }

  emit(channel: 'stdout' | 'stderr' | 'stdin' | 'child', event: string, payload?: unknown): void {
    try {
      this[channel].emit(event, payload);
    } catch (error) {
      this.emittedErrors.push(error);
    }
  }

  frame(frame: Frame): void { this.chunk(JSON.stringify(frame) + '\n'); }

  chunk(text: string): void {
    this.emit('stdout', 'data', { toString: () => text });
  }

  async advance(milliseconds: number): Promise<void> {
    const end = this.now + milliseconds;
    while (this.intervals.size) {
      const next = Math.min(...[...this.intervals.values()].map(interval => interval.next));
      if (next > end) break;
      this.now = next;
      for (const [id, interval] of [...this.intervals]) {
        if (interval.next <= this.now && this.intervals.has(id)) {
          interval.next += interval.every;
          try { interval.callback(); } catch (error) { this.emittedErrors.push(error); }
        }
      }
      await this.flush();
    }
    this.now = end;
    await this.flush();
  }

  async finish(): Promise<void> {
    await this.advance(6100);
    if (this.settled) await this.execution;
  }
}

export async function initializedHarness(): Promise<SmokeHarness> {
  const harness = new SmokeHarness();
  harness.frame(initialization());
  await harness.advance(25);
  return harness;
}

export async function completedHarness(names = requiredNames): Promise<SmokeHarness> {
  const harness = await initializedHarness();
  harness.frame(toolsResponse(names));
  await harness.advance(25);
  return harness;
}
