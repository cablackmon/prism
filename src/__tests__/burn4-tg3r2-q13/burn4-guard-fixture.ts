import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const unchangedGuard = readFileSync(path.resolve(__dirname, '../../..', 'scripts/guard-outbound.sh'));

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

type FixtureContext = {
  file: (name: string) => string;
  executionMarker: string;
};

type Options = {
  command?: string | ((context: FixtureContext) => string);
  rawInput?: string;
  files?: Readonly<Record<string, string>>;
  scannerExit?: number;
  scannerStdout?: string;
  scannerStderr?: string;
};

export function runGuard(options: Options = {}) {
  const scannerExit = options.scannerExit ?? 0;
  if (!Number.isInteger(scannerExit) || scannerExit < 0 || scannerExit > 255) {
    throw new Error('Fixture scanner exit must be an integer from 0 to 255');
  }
  // A fixed temp root avoids reading real process configuration.
  const root = mkdtempSync('/tmp/burn4-tg3r2-q13-');
  const file = (name: string): string => {
    const resolved = path.resolve(root, name);
    if (!resolved.startsWith(`${root}/`)) throw new Error('Fixture files must stay inside the disposable root');
    return resolved;
  };
  const scripts = file('scripts');
  const temporary = file('burn4-temp');
  const scanLog = file('burn4-scanned.txt');
  const callsLog = file('burn4-scanner-calls.txt');
  const executionMarker = file('burn4-proposed-command-executed.txt');

  try {
    for (const directory of [scripts, temporary]) mkdirSync(directory);
    writeFileSync(file('scripts/burn4-guard-outbound.sh'), unchangedGuard);
    for (const [name, contents] of Object.entries(options.files ?? {})) {
      writeFileSync(file(name), contents);
    }
    writeFileSync(file('scripts/scan-text.sh'), [
      '#!/bin/bash',
      `printf '%s\\n' called >> ${shellLiteral(callsLog)}`,
      `/usr/bin/cat "$1" > ${shellLiteral(scanLog)}`,
      `printf '%s' ${shellLiteral(options.scannerStdout ?? '')}`,
      `printf '%s' ${shellLiteral(options.scannerStderr ?? '')} >&2`,
      `exit ${scannerExit}`,
      '',
    ].join('\n'));
    writeFileSync(file('burn4-driver.sh'), [
      '#!/bin/bash',
      `mktemp() { /usr/bin/mktemp ${shellLiteral(path.join(temporary, 'burn4-guard.XXXXXX'))}; }`,
      '. "$1"',
      '',
    ].join('\n'));

    const command = typeof options.command === 'function'
      ? options.command({ file, executionMarker })
      : (options.command ?? '');
    // Proposed command text is stdin data only. It is never shell code or argv.
    const input = options.rawInput ?? JSON.stringify({ tool_input: { command } });
    const result = spawnSync('/bin/bash', [
      '--noprofile', '--norc', file('burn4-driver.sh'), file('scripts/burn4-guard-outbound.sh'),
    ], {
      cwd: root,
      env: {},
      input,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });

    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Fixture guard terminated by ${result.signal}`);
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      scanned: existsSync(scanLog) ? readFileSync(scanLog, 'utf8') : undefined,
      scannerCalls: existsSync(callsLog) ? readFileSync(callsLog, 'utf8').trim().split('\n').length : 0,
      temporaryFiles: readdirSync(temporary),
      proposedCommandExecuted: existsSync(executionMarker),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
