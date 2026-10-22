import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

type FileName = 'history' | 'views' | 'clones' | 'referrers';
type DailyValue = { count: number; uniques: number };
export type History = {
  views: Record<string, DailyValue>;
  clones: Record<string, DailyValue>;
  referrers: unknown[];
  referrer_history: Record<string, unknown[]>;
  window_uniques: Record<string, number>;
  updated_at: string | null;
};
export type MergeInput = Partial<Record<FileName, unknown>> & {
  raw?: Partial<Record<FileName, string>>;
  missing?: FileName[];
  ticks?: string[];
  faults?: { read?: string[]; mkdir?: boolean; open_write?: boolean; write_after_chars?: number };
};
export type MergeResult = {
  error: { type: string; message: string } | null;
  stdout: string;
  stderr: string;
  events: unknown[][];
  history: History | null;
  historyText: string | null;
  parseError: string | null;
  clockCalls: number;
};

const repo = resolve(__dirname, '../../..');
const workflow = readFileSync(join(repo, '.github/workflows/traffic.yml'), 'utf8');
const mergeMarker = "          python3 << 'PYEOF'\n";
const start = workflow.indexOf(mergeMarker);
const finish = workflow.indexOf('          PYEOF', start + mergeMarker.length);
if (start < 0 || finish < 0 || workflow.indexOf(mergeMarker, start + 1) !== -1) {
  throw new Error('Expected exactly one traffic merger heredoc');
}
export const mergeSource = workflow.slice(start + mergeMarker.length, finish)
  .split('\n').map(line => {
    if (line && !line.startsWith('          ')) throw new Error('Unexpected workflow indentation');
    return line.slice(10);
  }).join('\n');

export function merge(input: MergeInput = {}): MergeResult {
  const values: Partial<Record<FileName, unknown>> = { views: {}, clones: {}, referrers: [] };
  for (const name of ['history', 'views', 'clones', 'referrers'] as const) {
    if (Object.prototype.hasOwnProperty.call(input, name)) values[name] = input[name];
  }
  const files: Partial<Record<FileName, string>> = {};
  for (const name of Object.keys(values) as FileName[]) files[name] = JSON.stringify(values[name]);
  Object.assign(files, input.raw);
  for (const name of input.missing ?? []) delete files[name];
  const child = spawnSync('/usr/bin/python3', ['-I', join(__dirname, 'burn4-driver.py')], {
    env: {}, input: JSON.stringify({ source: mergeSource, files, ticks: input.ticks, faults: input.faults }),
    encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024,
  });
  if (child.error || child.status !== 0) throw new Error(`Isolated driver failed: ${child.error?.message ?? child.stderr}`);
  return JSON.parse(child.stdout) as MergeResult;
}

export function archive(overrides: Partial<History> = {}): History {
  return {
    views: { '2020-01-01': { count: 7, uniques: 3 } },
    clones: { '2020-01-01': { count: 2, uniques: 1 } },
    referrers: [{ referrer: 'old.example', count: 4, uniques: 2 }],
    referrer_history: { '2020-01-01': [{ referrer: 'old.example', count: 4, uniques: 2 }] },
    window_uniques: { '2020-01-01': 3 }, updated_at: '2020-01-01T02:00:00Z', ...overrides,
  };
}

export type ShellInput = { diff?: number; fail?: string; failureCode?: number };
export type ShellResult = { status: number | null; stdout: string; stderr: string; calls: string[][] };

export function publication(input: ShellInput = {}): ShellResult {
  const publicationStep = workflow.indexOf('      - name: Push to traffic-data branch');
  const runStart = workflow.indexOf('        run: |\n', publicationStep);
  if (publicationStep < 0 || runStart < 0) throw new Error('Publication block not found');
  const script = workflow.slice(runStart + '        run: |\n'.length).trimEnd()
    .split('\n').map(line => {
      if (line && !line.startsWith('          ')) throw new Error('Publication step boundary changed');
      return line.slice(10);
    }).join('\n');
  const folder = mkdtempSync('/tmp/burn4-b03-shell-');
  const trace = join(folder, 'calls');
  const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
  const failure = input.fail ?? '';
  const prelude = `
  git() {
    printf '%s\\0' "$@" >> ${quote(trace)}
    printf '\\n' >> ${quote(trace)}
    local command_name="$1"
    if [[ "$command_name" == config ]]; then command_name="config:$2"; fi
    if [[ "$command_name" == ${quote(failure)} ]]; then return ${input.failureCode ?? 23}; fi
    if [[ "$command_name" == diff ]]; then return ${input.diff ?? 1}; fi
    return 0
  }
  date() {
    if [[ "$*" != '-u +%Y-%m-%d' ]]; then return 97; fi
    printf '%s' '2026-10-22'
  }
  `;
  try {
    const child = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-s'], {
      cwd: folder, env: {}, input: `${prelude}\n${script}\n`, encoding: 'utf8', timeout: 5000,
    });
    if (child.error) throw child.error;
    let calls: string[][] = [];
    try { calls = readFileSync(trace, 'utf8').trimEnd().split('\n').map(line => line.split('\0').slice(0, -1)); }
    catch (problem) { if (!(problem instanceof Error && 'code' in problem && problem.code === 'ENOENT')) throw problem; }
    return { status: child.status, stdout: child.stdout, stderr: child.stderr, calls };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
