import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type WorkflowName = 'needs-reply' | 'release';
export type Step = { name: string; id?: string; condition?: string; script: string };
export type Context = Record<string, unknown>;
export type Run = { status: number | null; stdout: string; stderr: string; outputs: Record<string, string>; commands: string[][] };
export type Event = {
  comment?: { user?: { login?: string } };
  review?: { user?: { login?: string } };
  sender?: { login?: string };
  issue?: { number?: number };
  pull_request?: { number?: number };
};

const permittedPaths = new Set([
  'github.event.comment.user.login', 'github.event.review.user.login', 'github.event.sender.login',
  'github.event.issue.number', 'github.event.pull_request.number', 'github.repository',
  'steps.ctx.outputs.is_owner', 'steps.ctx.outputs.is_bot', 'steps.ctx.outputs.number',
  'steps.ver.outputs.version', 'matrix.arch',
]);

/** Extract only named inline shell steps. Action steps and their environments are never loaded. */
export function stepsFor(name: WorkflowName): Step[] {
  const source = readFileSync(resolve(__dirname, '../../..', '.github/workflows', `${name}.yml`), 'utf8');
  const lines = source.split('\n');
  const steps: Step[] = [];
  let current: Partial<Step> | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const nameMatch = /^      - name: (.+)$/.exec(line);
    if (nameMatch) current = { name: nameMatch[1] };
    if (!current) continue;
    const id = /^        id: (.+)$/.exec(line)?.[1];
    const condition = /^        if: (.+)$/.exec(line)?.[1];
    if (id) current.id = id;
    if (condition) current.condition = condition;
    if (line !== '        run: |') continue;
    const body: string[] = [];
    for (index += 1; index < lines.length; index += 1) {
      const bodyLine = lines[index] ?? '';
      if (bodyLine.trim() && !bodyLine.startsWith('          ')) {
        index -= 1;
        break;
      }
      body.push(bodyLine.slice(10));
    }
    if (!current.name || body.length === 0) throw new Error('Inline step has no name or body');
    steps.push({ name: current.name, id: current.id, condition: current.condition, script: `${body.join('\n')}\n` });
    current = undefined;
  }
  return steps;
}

function valueAt(path: string, context: Context): string | number | boolean {
  if (!permittedPaths.has(path)) throw new Error(`Unsupported ordinary context path: ${path}`);
  let value: unknown = context;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return '';
    value = (value as Record<string, unknown>)[key];
  }
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new Error('Context value must be an ordinary primitive');
  }
  return value;
}

/** This is deliberately a restricted fixture evaluator, not the hosted Actions expression engine. */
export function expression(source: string, context: Context): string | number | boolean {
  const and = source.split(/\s+&&\s+/);
  if (and.length > 1) return and.every((part) => Boolean(expression(part, context)));
  const or = source.split(/\s+\|\|\s+/);
  if (or.length > 1) {
    for (const part of or) {
      const result = expression(part, context);
      if (result) return result;
    }
    return '';
  }
  const comparison = /^([\w.]+)\s*(==|!=)\s*'([^']*)'$/.exec(source.trim());
  if (comparison) {
    const equal = String(valueAt(comparison[1] ?? '', context)) === comparison[3];
    return comparison[2] === '==' ? equal : !equal;
  }
  return valueAt(source.trim(), context);
}

export function render(script: string, context: Context): string {
  return script.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_whole, source: string) => {
    const value = String(expression(source, context));
    // Fixtures are plain metadata, never shell text. Real hosted interpolation is outside this harness.
    if (!/^[A-Za-z0-9_./:@+[\]-]*$/.test(value)) throw new Error('Unsafe synthetic shell interpolation');
    return value;
  });
}

export class WorkflowFixture {
  readonly directory = mkdtempSync(join(tmpdir(), 'burn4-b04-'));
  private readonly bin = join(this.directory, 'bin');
  private readonly output = join(this.directory, 'outputs');
  private readonly trace = join(this.directory, 'commands');

  constructor() {
    mkdirSync(this.bin);
    mkdirSync(join(this.directory, 'ha-app'));
    for (const name of ['grep', 'head', 'awk', 'tr']) symlinkSync(`/usr/bin/${name}`, join(this.bin, name));
    const command = join(this.bin, 'gh');
    writeFileSync(command, '#!/bin/bash\nprintf "%s\\0" "$@" >> "$BURN4_COMMANDS"\nprintf "\\036" >> "$BURN4_COMMANDS"\nexit "$BURN4_GH_EXIT"\n');
    chmodSync(command, 0o700);
  }

  config(text: string): void {
    writeFileSync(join(this.directory, 'ha-app/config.yaml'), text);
  }

  removeConfig(): void {
    rmSync(join(this.directory, 'ha-app/config.yaml'), { force: true });
  }

  run(step: Step, context: Context = {}, options: { ref?: string; ghExit?: number } = {}): Run {
    writeFileSync(this.output, '');
    writeFileSync(this.trace, '');
    const script = render(step.script, context);
    // No spread or read of process.env: every child receives only these synthetic ordinary controls.
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', script], {
      cwd: this.directory,
      env: {
        PATH: this.bin,
        GITHUB_OUTPUT: this.output,
        GITHUB_REF: options.ref ?? 'refs/tags/v2.3.4',
        BURN4_COMMANDS: this.trace,
        BURN4_GH_EXIT: String(options.ghExit ?? 0),
      },
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 64 * 1024,
    });
    if (result.error) throw result.error;
    const outputs: Record<string, string> = {};
    for (const line of readFileSync(this.output, 'utf8').split('\n').filter(Boolean)) {
      const equal = line.indexOf('=');
      if (equal < 1) throw new Error('Malformed step output');
      outputs[line.slice(0, equal)] = line.slice(equal + 1);
    }
    const commands = readFileSync(this.trace, 'utf8').split('\x1e').filter(Boolean)
      .map((line) => line.split('\0').slice(0, -1));
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, outputs, commands };
  }

  dispose(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }
}

export function runTriage(fixture: WorkflowFixture, event: Event, ghExit = 0): { compute: Run; labels: Run[] } {
  const context = { github: { event, repository: 'sample/project' }, steps: {} as Context };
  const steps = stepsFor('needs-reply');
  const computeStep = steps.find((step) => step.id === 'ctx');
  if (!computeStep) throw new Error('Missing context step');
  const compute = fixture.run(computeStep, context);
  context.steps = { ctx: { outputs: compute.outputs } };
  const labels = steps.filter((step) => step.condition && expression(step.condition, context))
    .map((step) => fixture.run(step, context, { ghExit }));
  return { compute, labels };
}
