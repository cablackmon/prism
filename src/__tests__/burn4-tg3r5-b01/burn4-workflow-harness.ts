import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';

export const now = Date.parse('2026-10-21T12:00:00.000Z');
export const submissionPath = '/tmp/submission.json';
export const indexPath = 'community/layouts/index.json';
export const errorsPath = '/tmp/validation-errors.json';
const source = readFileSync(resolve(__dirname, '../../..', '.github/workflows/layout-submission.yml'), 'utf8');

export const steps = {
  limits: 'Check submission limits',
  extract: 'Extract and validate layout',
  validator: 'Run validator',
  failure: 'Comment validation failure',
  publish: 'Add layout and create PR',
} as const;
export type Step = keyof typeof steps;
export type Call = { name: string; args: unknown[] };
export type JsonObject = Record<string, unknown>;
export type Layout = JsonObject & { name: string };

type Options = {
  body?: string | null;
  createdAt?: string;
  issueCount?: number;
  files?: Record<string, string>;
  fail?: Record<string, string>;
  validation?: { valid: boolean; errors: string[] };
  repo?: string;
  issue?: number;
};

export function layout(overrides: JsonObject = {}): Layout {
  return {
    type: 'prism-layout', version: 1, mode: 'dashboard', name: 'Synthetic Family Board',
    description: 'Synthetic fixture only', author: 'Fixture Author', orientation: 'landscape',
    widgets: [
      { i: 'clock', x: 0, y: 0, w: 8, h: 4 },
      { i: 'weather', x: 8, y: 0, w: 8, h: 4 },
      { i: 'calendar', x: 16, y: 0, w: 12, h: 8 },
    ],
    ...overrides,
  };
}

export function block(step: Step): string {
  const start = source.indexOf(`      - name: ${steps[step]}\n`);
  if (start < 0) throw new Error(`Missing workflow step ${step}`);
  const end = source.indexOf('\n      - name:', start + 1);
  const section = source.slice(start, end < 0 ? undefined : end);
  const lines = section.split('\n');
  const marker = lines.findIndex(line => /^\s+(script|run): \|$/.test(line));
  if (marker < 0) throw new Error(`Missing executable block ${step}`);
  const first = lines[marker + 1];
  if (first === undefined) throw new Error(`Empty executable block ${step}`);
  const indent = first.length - first.trimStart().length;
  const result: string[] = [];
  for (const line of lines.slice(marker + 1)) {
    if (line.trim() && line.length - line.trimStart().length < indent) break;
    result.push(line.slice(indent));
  }
  const body = result.join('\n');
  if (step !== 'validator') return body;
  const match = body.match(/npx tsx -e "([\s\S]*?)" 2>&1/);
  if (!match?.[1]) throw new Error('Missing validator JavaScript');
  return match[1];
}

class Exit extends Error {
  constructor(readonly code: number) { super(`Synthetic exit ${code}`); }
}

export function fixture(options: Options = {}) {
  const calls: Call[] = [];
  const outputs: Record<string, unknown> = {};
  const failures: string[] = [];
  const normalize = (path: string) => path.replace(/^\.\//, '');
  const files = new Map(Object.entries(options.files ?? {
    [submissionPath]: JSON.stringify(layout()),
    [indexPath]: JSON.stringify({ layouts: [] }),
  }).map(([path, value]) => [normalize(path), value]));
  const fail = options.fail ?? {};
  const record = (name: string, ...args: unknown[]) => {
    calls.push({ name, args: structuredClone(args) });
    if (fail[name]) throw new Error(fail[name]);
  };
  const api = (name: string, value: unknown = {}) => async (arg: unknown) => {
    record(name, arg);
    return structuredClone(value);
  };
  const fs = {
    readFileSync(path: string, encoding: string) {
      path = normalize(path);
      record(`read:${path}`, encoding);
      const value = files.get(path);
      if (value === undefined) throw new Error(`Synthetic missing file ${path}`);
      return value;
    },
    writeFileSync(path: string, value: string) {
      path = normalize(path);
      record(`write:${path}`, value);
      files.set(path, value);
    },
  };
  const core = {
    setOutput(name: string, value: unknown) { record('output', name, value); outputs[name] = value; },
    setFailed(message: string) { record('failed', message); failures.push(message); },
  };
  class Clock extends Date {
    constructor(value?: string | number) { super(value ?? now); }
    static now() { return now; }
  }
  const context = {
    repo: { owner: 'fixture-owner', repo: options.repo ?? 'fixture-repo' },
    issue: { number: options.issue ?? 41 },
    payload: { issue: { user: { login: 'fixture-author' }, body: options.body ?? null } },
  };
  const github = { rest: {
    users: { getByUsername: api('user', { data: { created_at: options.createdAt ?? new Date(now - 14 * 86400000).toISOString() } }) },
    issues: {
      listForRepo: api('list', { data: Array.from({ length: options.issueCount ?? 1 }, (_, i) => ({ number: i + 1 })) }),
      createComment: api('comment'), update: api('update'), addLabels: api('add-label'), removeLabel: api('remove-label'),
    },
    pulls: { create: api('pull', { data: { html_url: 'https://example.invalid/fixture/pull/7' } }) },
  } };
  let execCount = 0;
  const requireFake = (id: string) => {
    if (id === 'fs') return fs;
    if (id === 'child_process') return {
      execSync(command: string) {
        record('exec', command);
        execCount += 1;
        if (fail[`exec:${execCount}`]) throw new Error(fail[`exec:${execCount}`]);
        return '';
      },
    };
    if (id === './src/lib/community/validateLayout') return {
      validateCommunityLayout(input: unknown, validationOptions: unknown) {
        record('validate', input, validationOptions);
        return structuredClone(options.validation ?? { valid: true, errors: [] });
      },
    };
    throw new Error(`Denied import ${id}`);
  };
  const sandbox = createContext({
    github, context, core, require: requireFake, Date: Clock,
    process: { exit(code: number): never { record('exit', code); throw new Exit(code); } },
    console: { log(...args: unknown[]) { record('log', ...args); } },
  }, { codeGeneration: { strings: false, wasm: false } });
  async function run(step: Step) {
    const script = new Script(`(async () => {\n${block(step)}\n})()`, { filename: `layout-workflow-${step}.js` });
    try { await script.runInContext(sandbox, { timeout: 1000 }); }
    catch (error) { if (!(error instanceof Exit)) throw error; }
  }
  return { run, calls, outputs, failures, files, fail, sandbox, context };
}

export function argsFor(f: ReturnType<typeof fixture>, name: string): unknown[][] {
  return f.calls.filter(call => call.name === name).map(call => call.args);
}

export function names(f: ReturnType<typeof fixture>): string[] { return f.calls.map(call => call.name); }
