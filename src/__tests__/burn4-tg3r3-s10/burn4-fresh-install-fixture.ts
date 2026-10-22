import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export type Invocation = { command: string; args: string[] };
export type FixtureOptions = {
  composeVersionExit?: number;
  composeDownExit?: number;
  rmExit?: number;
  volumeExit?: number;
  installerExit?: number;
  containersOutput?: string;
  containersExit?: number;
  healthOutput?: string;
  healthExit?: number;
  databaseOutput?: string;
  databaseExit?: number;
  pageOutput?: string;
  pageExit?: number;
  filterFailures?: Partial<Record<'wc' | 'tr' | 'head', number>>;
};

const fixtureRoots: string[] = [];
const sourcePath = resolve(__dirname, '../../../scripts/test-fresh-install.sh');

export function createFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'burn4-fresh-install-'));
  fixtureRoots.push(root);
  const bin = join(root, 'bin');
  const scripts = join(root, 'scripts');
  mkdirSync(bin);
  mkdirSync(scripts);
  const callsFile = join(root, 'burn4-calls.jsonl');
  const dispatcher = join(root, 'burn4-command.cjs');
  const responses = {
    composeVersionExit: 0,
    composeDownExit: 0,
    rmExit: 0,
    volumeExit: 0,
    installerExit: 0,
    containersOutput: 'prism-web\nprism-db\nprism-redis\n',
    containersExit: 0,
    healthOutput: '{"status":"ok"}\n',
    healthExit: 0,
    databaseOutput: ' 7 \n',
    databaseExit: 0,
    pageOutput: '<!DOCTYPE html><html><body>fixture page</body></html>\n',
    pageExit: 0,
    filterFailures: {},
    ...options,
  };

  // Responses are literal fixture code, not env, service config or credential files.
  writeFileSync(dispatcher, `#!${process.execPath}\n` + String.raw`
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const responses = ${JSON.stringify(responses)};
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ command, args }) + '\n');
function same(expected) { return JSON.stringify(args) === JSON.stringify(expected); }
function finish(output, exit) { process.stdout.write(output, () => process.exit(exit)); }
if (command === 'docker' && same(['compose', 'version'])) {
  process.exit(responses.composeVersionExit);
} else if ((command === 'docker' && same(['compose', 'down', '-v']))
  || (command === 'docker-compose' && same(['down', '-v']))) {
  process.exit(responses.composeDownExit);
} else if (command === 'rm' && same(['-f', '.env'])) {
  // Record this request without removing or reading any file.
  process.exit(responses.rmExit);
} else if (command === 'docker'
  && same(['volume', 'rm', 'prism-postgres-data', 'prism-redis-data', 'prism-photos-cache'])) {
  process.exit(responses.volumeExit);
} else if (command === 'install.sh' && same([])) {
  finish('fixture installer completed\n', responses.installerExit);
} else if (command === 'docker'
  && same(['ps', '--filter', 'name=prism', '--format', '{{.Names}}'])) {
  finish(responses.containersOutput, responses.containersExit);
} else if (command === 'curl' && same(['-sf', 'http://localhost:3000/api/health'])) {
  finish(responses.healthOutput, responses.healthExit);
} else if (command === 'docker' && same(['exec', 'prism-db', 'psql', '-U', 'prism', '-d',
  'prism', '-t', '-c', 'SELECT COUNT(*) FROM users;'])) {
  finish(responses.databaseOutput, responses.databaseExit);
} else if (command === 'curl' && same(['-sf', 'http://localhost:3000'])) {
  finish(responses.pageOutput, responses.pageExit);
} else if ((command === 'wc' && same(['-l']))
  || (command === 'tr' && same(['-d', ' ']))
  || (command === 'head' && same(['-c', '100']))) {
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(responses.filterFailures[command]));
} else {
  process.stderr.write('Blocked unexpected fake invocation: ' + command + '\n');
  process.exit(98);
}
`, { mode: 0o755 });

  for (const command of ['docker', 'docker-compose', 'curl', 'rm']) {
    symlinkSync(dispatcher, join(bin, command));
  }
  for (const command of ['wc', 'tr', 'head'] as const) {
    symlinkSync(options.filterFailures?.[command] ? dispatcher : `/usr/bin/${command}`, join(bin, command));
  }
  // This fake replaces the installer completely. The real installer is never read.
  symlinkSync(dispatcher, join(scripts, 'install.sh'));

  return {
    root,
    calls(): Invocation[] {
      if (!existsSync(callsFile)) return [];
      return readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean)
        .map((line): Invocation => JSON.parse(line) as Invocation);
    },
    topLevelFiles(): string[] { return readdirSync(root).sort(); },
    run(args: string[] = ['--yes'], confirmation = '') {
      const result = spawnSync('/bin/bash', ['-c', readFileSync(sourcePath, 'utf8'), 'burn4-fresh-install', ...args], {
        cwd: root,
        env: { PATH: bin, LC_ALL: 'C' },
        input: confirmation,
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      if (result.error) throw result.error;
      if (result.stderr.includes('Blocked unexpected fake invocation:')) {
        throw new Error('Fixture blocked an unexpected command');
      }
      return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
    },
  };
}

export function cleanFixtures(): void {
  for (const root of fixtureRoots.splice(0)) {
    if (!basename(root).startsWith('burn4-fresh-install-')) throw new Error('Unsafe fixture cleanup');
    rmSync(root, { recursive: true, force: true });
  }
}
