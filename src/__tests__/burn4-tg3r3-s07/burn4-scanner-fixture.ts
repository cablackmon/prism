import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const sourcePath = join(repoRoot, 'scripts/scan-text.sh');
const commands = ['cat', 'grep', 'head', 'sed'] as const;
type ScannerCommand = (typeof commands)[number];
const activeFixtures = new Set<string>();

type ScanOptions = {
  file?: string;
  stdin?: string;
};

type FixtureOptions = {
  denylist?: string | null;
  missingCommand?: ScannerCommand;
};

export function createScannerFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(repoRoot, 'burn4-s07-fixture-'));
  activeFixtures.add(root);
  const bin = join(root, 'burn4-bin');
  const denylist = join(root, 'burn4-denylist.txt');
  mkdirSync(bin);
  for (const command of commands) {
    if (command !== options.missingCommand) {
      symlinkSync(`/usr/bin/${command}`, join(bin, command));
    }
  }
  if (options.denylist !== null) {
    writeFileSync(denylist, options.denylist ?? '# Synthetic test markers only\n');
  }

  return {
    denylist,
    writeInput(text: string, name = 'burn4-message.txt'): string {
      const path = join(root, name);
      writeFileSync(path, text);
      return path;
    },
    missingInput(): string {
      return join(root, 'burn4-missing-input.txt');
    },
    directoryInput(): string {
      const path = join(root, 'burn4-directory');
      mkdirSync(path);
      return path;
    },
    scan({ file, stdin = '' }: ScanOptions = {}) {
      // Node's direct input pipe can be a socket that cannot reopen /dev/stdin.
      // Bash printf supplies the real local pipe used by the documented CLI.
      const args = [
        '-c',
        'printf "%s" "$1" | /bin/bash "$2" "${@:3}"',
        'burn4-stdin-wrapper',
        stdin,
        sourcePath,
        ...(file ? [file] : []),
      ];
      const result = spawnSync('/bin/bash', args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 256 * 1024,
        env: {
          PATH: bin,
          PRISM_PII_DENYLIST: denylist,
          LC_ALL: 'C',
        },
      });
      if (result.error) throw result.error;
      if (result.signal) throw new Error(`Scanner ended with ${result.signal}`);
      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  };
}

export function cleanupScannerFixtures(): void {
  for (const root of activeFixtures) rmSync(root, { recursive: true, force: true });
  activeFixtures.clear();
}
