import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type Reply = { code?: number; stdout?: string; stderr?: string; args?: string[] };
export type Plan = Record<string, Reply[]>;
export type Call = { command: string; args: string[] };
export type Outcome = { status: number | null; stdout: string; stderr: string; calls: Call[] };

const root = resolve(__dirname, '../../..');
const workflows = {
  install: '.github/workflows/test-install.yml',
  screenshots: '.github/workflows/refresh-screenshots.yml',
} as const;

// This is an execution safety boundary, not a behavior oracle. New shell lines
// require review before execution, even if their workflow step name is unchanged.
const admittedLines = new Set([
  'chmod +x scripts/*.sh', './scripts/install.sh', 'sleep 10', 'for i in {1..30}; do',
  'if curl -sf http://localhost:3000/api/health; then', 'break', 'fi', 'sleep 2', 'done',
  'docker ps', 'docker ps | grep prism-app || (echo "prism-app not running!" && exit 1)',
  'docker ps | grep prism-db || (echo "prism-db not running!" && exit 1)',
  'docker ps | grep prism-redis || (echo "prism-redis not running!" && exit 1)',
  'curl -sf http://localhost:3000/api/health || exit 1',
  'RESPONSE=$(curl -sf http://localhost:3000)', 'if [[ "$RESPONSE" != *"Prism"* ]]; then', 'exit 1',
  'docker exec prism-db psql -U prism -d prism -c "SELECT COUNT(*) FROM users;"',
  'docker logs prism-app --tail 100', 'docker logs prism-db --tail 50', 'docker logs prism-redis --tail 50',
  'npm ci', 'npm run type-check', 'npm run lint', 'npm run build',
  'for i in $(seq 1 80); do',
  'if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then echo "App is up."; break; fi',
  'sleep 3', 'if ! curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then',
  'echo "App failed to start. Last 60 log lines:"; tail -60 /tmp/dev.log; exit 1',
]);

export function assertSafeShell(shell: string): void {
  for (const raw of shell.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (admittedLines.has(line)) continue;
    // Only literal messages and the loop index are allowed in echo statements.
    if (/^echo "[a-zA-Z0-9 .!?'=:/-]*(?:\$i[a-zA-Z0-9 .!?'=:/-]*)?"$/.test(line)) continue;
    if (line === 'echo "=== App Logs ==="' || line === 'echo "=== DB Logs ==="' || line === 'echo "=== Redis Logs ==="' || line === 'echo ""') continue;
    throw new Error(`Shell line outside reviewed execution boundary: ${line}`);
  }
}

export function extractStep(text: string, name: string): string {
  const lines = text.split(/\r?\n/);
  const matches = lines.flatMap((line, index) => line === `      - name: ${name}` ? [index] : []);
  if (matches.length !== 1) throw new Error(`Expected one step named ${name}, found ${matches.length}`);
  const start = matches[0]!;
  let runIndex = -1;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^      - /.test(line)) break;
    if (/^        run:/.test(line)) { runIndex = index; break; }
  }
  if (runIndex < 0) throw new Error(`No shell run for ${name}`);
  const value = lines[runIndex]!.slice('        run:'.length).trim();
  if (value !== '|') return `${value}\n`;
  const body: string[] = [];
  for (let index = runIndex + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() && !line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  return `${body.join('\n').trimEnd()}\n`;
}

export function sourceStep(workflow: keyof typeof workflows, name: string): string {
  // Only run text is returned. YAML environment and secret blocks are never parsed.
  const shell = extractStep(readFileSync(join(root, workflows[workflow]), 'utf8'), name);
  if (workflow === 'screenshots') {
    const lines = shell.split('\n');
    const start = lines.indexOf('echo "Waiting for the app to come up..."');
    const end = lines.indexOf('fi', start);
    if (start < 0 || end < start) throw new Error('Screenshot readiness boundaries changed');
    const readiness = `${lines.slice(start, end + 1).join('\n')}\n`;
    assertSafeShell(readiness);
    return readiness;
  }
  assertSafeShell(shell);
  return shell;
}

const fakeProgram = `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(path.dirname(fs.realpathSync(__filename)));
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const file = path.join(root, 'calls.json');
const calls = JSON.parse(fs.readFileSync(file, 'utf8'));
const index = calls.filter(call => call.command === command).length;
calls.push({ command, args });
fs.writeFileSync(file, JSON.stringify(calls));
const plan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json'), 'utf8'));
const reply = plan[command] && plan[command][index];
if (!reply) { process.stderr.write('Unplanned inert command: ' + command + '\\n'); process.exit(97); }
if (reply.args && JSON.stringify(reply.args) !== JSON.stringify(args)) {
  process.stderr.write('Unexpected arguments for inert command: ' + command + '\\n'); process.exit(98);
}
process.stdout.write(reply.stdout || '');
process.stderr.write(reply.stderr || '');
process.exit(reply.code || 0);
`;

export function executeShell(shell: string, plan: Plan): Outcome {
  assertSafeShell(shell);
  // Fixture state stays inside the package, with no global /tmp log writes.
  const directory = mkdtempSync(join(__dirname, 'burn4-runtime-'));
  try {
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    mkdirSync(join(directory, 'scripts'));
    writeFileSync(join(directory, 'plan.json'), JSON.stringify(plan));
    writeFileSync(join(directory, 'calls.json'), '[]');
    const fake = join(bin, 'burn4-inert-command');
    writeFileSync(fake, fakeProgram, { mode: 0o700 });
    for (const command of ['curl', 'docker', 'sleep', 'npm', 'chmod']) symlinkSync(fake, join(bin, command));
    symlinkSync(fake, join(directory, 'scripts/install.sh'));
    // Native grep and seq supply their real matching and sequence semantics.
    symlinkSync('/usr/bin/grep', join(bin, 'grep'));
    symlinkSync('/usr/bin/seq', join(bin, 'seq'));
    symlinkSync(fake, join(bin, 'tail'));
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', shell], {
      cwd: directory, env: { PATH: bin }, encoding: 'utf8', timeout: 15_000, maxBuffer: 1_048_576,
    });
    if (result.error) throw result.error;
    const calls = JSON.parse(readFileSync(join(directory, 'calls.json'), 'utf8')) as Call[];
    const seen: Record<string, number> = {};
    for (const call of calls) {
      const index = seen[call.command] ?? 0;
      seen[call.command] = index + 1;
      const reply = plan[call.command]?.[index];
      if (!reply) throw new Error(`Unplanned inert command call: ${call.command}`);
      if (reply.args && JSON.stringify(reply.args) !== JSON.stringify(call.args)) throw new Error(`Unexpected arguments for inert command: ${call.command}`);
    }
    if (/Unplanned inert command|Unexpected arguments for inert command/.test(result.stderr)) throw new Error(result.stderr);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function runStep(workflow: keyof typeof workflows, name: string, plan: Plan): Outcome {
  return executeShell(sourceStep(workflow, name), plan);
}

export function replies(count: number, reply: Reply): Reply[] {
  return Array.from({ length: count }, () => ({ ...reply }));
}
