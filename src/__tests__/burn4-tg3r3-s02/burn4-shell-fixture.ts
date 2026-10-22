import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export type Invocation = { command: string; args: string[] };
export type FakeOptions = {
  dumpBytes?: number;
  dumpExit?: number;
  gzipExit?: number;
  curlExit?: number;
  rcloneFailures?: string[];
  rcloneInstalled?: boolean;
  curlInstalled?: boolean;
  hourSequence?: string[];
  sleepLimit?: number;
  backupExit?: number;
};

const fixtureRoots: string[] = [];
const sourceRoot = resolve(__dirname, '../../..');

// Every subprocess receives only these fixture settings. No caller env is read.
export function createFixture(options: FakeOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'burn4-backup-safe-'));
  fixtureRoots.push(root);
  const bin = join(root, 'bin');
  const backups = join(root, 'backups');
  const data = join(root, 'data');
  const configFile = join(root, 'burn4-options.json');
  const callsFile = join(root, 'burn4-calls.jsonl');
  const mountedConfig = join(root, 'etc-rclone', 'rclone.conf');
  const writableConfig = join(root, 'root-config', 'rclone', 'rclone.conf');
  for (const dir of [bin, backups, data]) mkdirSync(dir, { recursive: true });
  writeFileSync(configFile, JSON.stringify({
    dumpBytes: 12001,
    dumpExit: 0,
    gzipExit: 0,
    curlExit: 0,
    rcloneFailures: [],
    hourSequence: ['03'],
    sleepLimit: 1,
    backupExit: 0,
    ...options,
  }));

  // Only known filesystem tools can execute for real, with relocated fixture paths.
  for (const command of ['stat', 'du', 'cut', 'find', 'ls', 'grep', 'mkdir', 'cp']) {
    symlinkSync(`/usr/bin/${command}`, join(bin, command));
  }
  const dispatcher = join(root, 'burn4-command.cjs');
  writeFileSync(dispatcher, `#!${process.execPath}\n` + String.raw`
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(${JSON.stringify(configFile)}, 'utf8'));
const callsFile = ${JSON.stringify(callsFile)};
const calls = fs.existsSync(callsFile)
  ? fs.readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  : [];
fs.appendFileSync(callsFile, JSON.stringify({ command, args }) + '\n');
if (command === 'date') {
  if (args[0] === '+%Y%m%d_%H%M%S') process.stdout.write('20261021_030000\n');
  else if (args[0] === '+%H') {
    const index = calls.filter(call => call.command === 'date' && call.args[0] === '+%H').length;
    process.stdout.write((config.hourSequence[index] || config.hourSequence.at(-1)) + '\n');
  } else process.stdout.write('fixture clock\n');
} else if (command === 'pg_dump') {
  process.stdout.write(Buffer.alloc(config.dumpBytes, 'x'), () => process.exit(config.dumpExit));
} else if (command === 'gzip') {
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', () => {
    if (config.gzipExit) process.exit(config.gzipExit);
    process.stdout.write(Buffer.concat(chunks));
  });
} else if (command === 'rclone') {
  const key = args[0] + ':' + (args[1] === ${JSON.stringify(data)} ? 'data' : 'database');
  process.exit(config.rcloneFailures.includes(key) ? 9 : 0);
} else if (command === 'curl') {
  process.exit(config.curlExit);
} else if (command === 'sleep') {
  const count = calls.filter(call => call.command === 'sleep').length + 1;
  if (count >= config.sleepLimit) process.kill(process.ppid, 'SIGTERM');
} else if (command === 'burn4-backup.sh') {
  process.exit(config.backupExit);
} else {
  throw new Error('Unallowlisted fake command: ' + command);
}
`, { mode: 0o755 });
  for (const command of ['date', 'pg_dump', 'gzip', 'sleep', 'burn4-backup.sh']) {
    symlinkSync(dispatcher, join(bin, command));
  }
  if (options.rcloneInstalled !== false) symlinkSync(dispatcher, join(bin, 'rclone'));
  if (options.curlInstalled !== false) symlinkSync(dispatcher, join(bin, 'curl'));

  function run(script: 'backup.sh' | 'backup-scheduler.sh', settings: Record<string, string> = {}) {
    let source = readFileSync(join(sourceRoot, 'scripts', script), 'utf8');
    if (script === 'backup.sh') {
      source = source.replace('BACKUP_DIR="/backups"', `BACKUP_DIR=${JSON.stringify(backups)}`);
      source = source.replace(/(?<=[" ])\/data(?=[" ])/g, data);
    } else {
      source = source
        .replaceAll('/etc/rclone/rclone.conf', mountedConfig)
        .replaceAll('/root/.config/rclone', join(root, 'root-config', 'rclone'))
        .replaceAll('/scripts/backup.sh', join(bin, 'burn4-backup.sh'));
    }
    // Feed the relocated source on stdin. Existing source is never edited/copied.
    const result = spawnSync('/bin/sh', ['-s'], {
      cwd: root,
      input: source,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      env: { PATH: bin, LC_ALL: 'C', ...settings },
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    root, bin, backups, data, mountedConfig, writableConfig,
    backupFile: join(backups, 'prism_20261021_030000.sql.gz'),
    writeData(name: string, value = 'synthetic asset') {
      const target = join(data, name);
      mkdirSync(resolve(target, '..'), { recursive: true });
      writeFileSync(target, value);
    },
    calls(): Invocation[] {
      if (!existsSync(callsFile)) return [];
      return readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean)
        .map((line): Invocation => JSON.parse(line) as Invocation);
    },
    runBackup(settings: Record<string, string> = {}) { return run('backup.sh', settings); },
    runScheduler(settings: Record<string, string> = {}) { return run('backup-scheduler.sh', settings); },
  };
}

export function cleanFixtures(): void {
  for (const root of fixtureRoots.splice(0)) {
    if (!basename(root).startsWith('burn4-backup-safe-')) throw new Error('Unsafe fixture cleanup');
    rmSync(root, { recursive: true, force: true });
  }
}
