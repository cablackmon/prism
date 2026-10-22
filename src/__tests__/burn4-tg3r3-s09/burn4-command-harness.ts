import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type Stage = 'build' | 'standalone' | 'reset-static' | 'static' | 'public' | 'own-public' | 'own-data' | 'restart' | 'wait' | 'readiness' | 'pull' | 'compose';
export type Event = { command: string; args: string[]; stage: Stage; exit: number };
export type FixtureOptions = { failStage?: Stage; failCode?: number; omitArtifact?: 'standalone' | 'static' | 'public'; missingCommand?: 'docker-compose' };
export const deployStages: Stage[] = ['build', 'standalone', 'reset-static', 'static', 'public', 'own-public', 'own-data', 'restart', 'wait', 'readiness'];
export const deployCommands: Array<[string, string[]]> = [
  ['npm', ['run', 'build']],
  ['docker', ['cp', '.next/standalone/.', 'prism-app:/app/']],
  ['docker', ['exec', '--user', 'root', 'prism-app', 'sh', '-c', 'rm -rf /app/.next/static && mkdir -p /app/.next/static']],
  ['docker', ['cp', '.next/static/.', 'prism-app:/app/.next/static/']],
  ['docker', ['cp', 'public/.', 'prism-app:/app/public/']],
  ['docker', ['exec', '--user', 'root', 'prism-app', 'chown', '-R', 'nextjs:nodejs', '/app/public']],
  ['docker', ['exec', '--user', 'root', 'prism-app', 'chown', '-R', 'nextjs:nodejs', '/app/data']],
  ['docker', ['compose', 'restart', 'app']],
  ['sleep', ['5']],
  ['curl', ['-sf', 'http://localhost:3000/api/health/ready']],
];
const updateCommands: Array<[string, string[]]> = [['git', ['pull']], ['docker-compose', ['up', '-d', '--build']]];
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

/** Children inherit nothing. PATH contains only our six strict fake commands. */
export function createFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync('/tmp/burn4-tg3r3-s09 fixture-');
  const bin = join(root, 'burn4-bin');
  mkdirSync(bin);
  const eventPath = join(root, 'burn4-events.jsonl');
  writeFileSync(eventPath, '');
  if (options.omitArtifact !== 'public') {
    mkdirSync(join(root, 'public'));
    writeFileSync(join(root, 'public/burn4-sw.js'), '/* fixture public artifact */\n');
  }
  const commands = [...deployCommands, ...updateCommands];
  const stages: Stage[] = [...deployStages, 'pull', 'compose'];
  const fake = `
const fs = require('node:fs');
const path = require('node:path');
const root = ${JSON.stringify(root)};
const config = ${JSON.stringify(options)};
const commands = ${JSON.stringify(commands)};
const stages = ${JSON.stringify(stages)};
const command = process.argv[2];
const args = process.argv.slice(3);
const index = commands.findIndex(([name, accepted]) => name === command && JSON.stringify(accepted) === JSON.stringify(args));
if (index === -1) {
  fs.appendFileSync(${JSON.stringify(eventPath)}, JSON.stringify({ command, args, stage: 'UNEXPECTED', exit: 98 }) + '\\n');
  process.stderr.write('Unexpected fixture command\\n');
  process.exit(98);
}
const stage = stages[index];
let code = config.failStage === stage ? (config.failCode ?? 47) : 0;
if (stage === 'build' && code === 0) {
  for (const artifact of ['standalone', 'static']) {
    if (artifact !== config.omitArtifact) {
      const dir = path.join(root, '.next', artifact);
      fs.mkdirSync(dir, {recursive:true});
      fs.writeFileSync(path.join(dir, 'burn4-artifact.js'), '/* harmless build fixture */\\n');
    }
  }
}
if (['standalone', 'static', 'public'].includes(stage) && code === 0 && !fs.existsSync(path.resolve(root, args[1]))) code = 44;
fs.appendFileSync(${JSON.stringify(eventPath)}, JSON.stringify({command, args, stage, exit: code}) + '\\n');
if (stage === 'readiness' && code === 0) process.stdout.write('{"ready":true}\\n');
if (code !== 0) process.stderr.write('Fixture command failed: ' + stage + '\\n');
process.exit(code);
`;
  const fakePath = join(root, 'burn4-command.cjs');
  writeFileSync(fakePath, fake);
  for (const command of ['npm', 'docker', 'docker-compose', 'curl', 'git', 'sleep']) {
    if (command === options.missingCommand) continue;
    const wrapper = join(bin, command);
    writeFileSync(wrapper, '#!/bin/bash\nexec ' + quote(process.execPath) + ' ' + quote(fakePath) + ' ' + quote(command) + ' "$@"\n');
    chmodSync(wrapper, 0o700);
  }
  const scripts = { deploy: 'deploy-local.sh', update: 'update.sh' };
  const scriptPaths: Record<keyof typeof scripts, string> = { deploy: '', update: '' };
  for (const [name, source] of Object.entries(scripts)) {
    const target = join(root, 'burn4-' + source);
    copyFileSync(resolve(__dirname, '../../..', 'scripts', source), target);
    scriptPaths[name as keyof typeof scripts] = target;
  }
  const execute = (file: string, args: string[]) => {
    const result = spawnSync(file, args, { cwd: root, env: { PATH: bin }, encoding: 'utf8', timeout: 5000, maxBuffer: 128 * 1024 });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Fixture child terminated by ${result.signal}`);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  return {
    root, bin, scriptPaths,
    run: (script: keyof typeof scripts) => execute('/bin/bash', ['--noprofile', '--norc', scriptPaths[script]]),
    command: (command: string, args: string[]) => execute(join(bin, command), args),
    events: (): Event[] => readFileSync(eventPath, 'utf8').trim().split('\n').filter(Boolean).map((line: string) => JSON.parse(line) as Event),
    clearEvents: () => writeFileSync(eventPath, ''),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
