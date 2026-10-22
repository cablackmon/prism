import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

export type FixtureFile = {
  name: string;
  content: string;
  tracked?: boolean;
  workingCopy?: string;
};

const source = path.resolve(__dirname, '../../..', 'scripts/scan-examples.sh');

export function scanExamples(files: FixtureFile[] = []) {
  // Every child runs inside this disposable repository, never the source repo.
  const root = mkdtempSync(path.join(__dirname, 'burn4-scanner-fixture-'));
  const options = {
    cwd: root,
    env: {},
    encoding: 'utf8' as const,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  };
  function fixturePath(name: string) {
    const resolved = path.resolve(root, name);
    if (!resolved.startsWith(root + path.sep)) throw new Error('Fixture path escaped its root');
    return resolved;
  }
  function git(args: string[]) {
    const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], options);
    if (result.error || result.status !== 0) {
      throw new Error(`Fixture git operation failed: ${result.error?.message ?? result.stderr}`);
    }
  }
  try {
    git(['init', '--quiet', '--template=']);
    for (const file of files) {
      const filename = fixturePath(file.name);
      mkdirSync(path.dirname(filename), { recursive: true });
      writeFileSync(filename, file.content);
    }
    const tracked = files.filter(file => file.tracked !== false).map(file => file.name);
    if (tracked.length) git(['add', '--', ...tracked]);
    for (const file of files) {
      if (file.workingCopy !== undefined) writeFileSync(fixturePath(file.name), file.workingCopy);
    }
    const result = spawnSync('/bin/bash', [source], options);
    const lines = result.stdout?.split('\n') ?? [];
    const placeholderStart = lines.findIndex(line => line.startsWith('PLACEHOLDER ATTRIBUTES'));
    const exampleStart = lines.findIndex(line => line.startsWith('EXAMPLE PATTERNS'));
    const summaryStart = lines.findIndex(line => line.startsWith('SUMMARY:'));
    const matchingLines = (section: string[]) => section.filter(line => /^(?:.*:)?\d+:/.test(line));
    return {
      status: result.status,
      signal: result.signal,
      error: result.error,
      stderr: result.stderr,
      stdout: result.stdout,
      placeholders: matchingLines(lines.slice(placeholderStart, exampleStart)),
      examples: matchingLines(lines.slice(exampleStart, summaryStart)),
      summary: lines[summaryStart],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
