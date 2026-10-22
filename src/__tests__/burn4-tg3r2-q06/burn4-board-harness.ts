import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';

export const ARTIFACT_DIR = 'e2e/ui-audit-artifacts';
export const REPORT_PATH = `${ARTIFACT_DIR}/report.json`;
export const BOARD_PATH = `${ARTIFACT_DIR}/board.html`;

export type Finding = {
  route: string;
  viewport: string;
  width: number;
  height: number;
  scale: number;
  severity: 'high' | 'medium' | 'ok';
  summary: string;
  screenshot: string;
  probe?: { overflowers?: { desc: string; overflow: number; w: number }[] } | null;
};

export type AuditReport = {
  totals?: { checks: number; high: number; medium: number; ok: number };
  findings?: Finding[] | null;
};

export function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    route: '/synthetic-route',
    viewport: 'desktop',
    width: 1440,
    height: 900,
    scale: 100,
    severity: 'high',
    summary: 'Synthetic overflow finding',
    screenshot: 'synthetic.png',
    ...overrides,
  };
}

export function report(findings: Finding[] = [finding()]): AuditReport {
  return {
    totals: {
      checks: findings.length,
      high: findings.filter((item) => item.severity === 'high').length,
      medium: findings.filter((item) => item.severity === 'medium').length,
      ok: findings.filter((item) => item.severity === 'ok').length,
    },
    findings,
  };
}

// Only this unchanged local source is read from disk. All script I/O is fake.
const source = readFileSync(path.resolve(__dirname, '../../..', 'scripts/ui-audit-board.mjs'), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'ui-audit-board.js',
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`Fake process exit ${code}`);
  }
}

type RunOptions = {
  report?: unknown;
  reportText?: string;
  reportPresent?: boolean;
  files?: Readonly<Record<string, string | Buffer>>;
  readFailureFor?: string;
  writeFailure?: Error;
};

export function renderBoard(options: RunOptions = {}) {
  const files = new Map<string, Buffer>();
  for (const [file, contents] of Object.entries(options.files ?? {})) {
    files.set(path.posix.normalize(file), Buffer.from(contents));
  }
  if (options.reportPresent !== false) {
    files.set(REPORT_PATH, Buffer.from(options.reportText ?? JSON.stringify(options.report ?? report())));
  }

  const reads: string[] = [];
  const existenceChecks: string[] = [];
  const writes = new Map<string, string>();
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | undefined;
  let error: unknown;

  const fakeFs = {
    existsSync(file: string): boolean {
      existenceChecks.push(file);
      return files.has(file);
    },
    readFileSync(file: string, encoding?: BufferEncoding): Buffer | string {
      reads.push(file);
      if (file === options.readFailureFor) throw new Error(`Synthetic read failure: ${file}`);
      const contents = files.get(file);
      if (!contents) throw new Error(`Memory filesystem has no file: ${file}`);
      return encoding ? contents.toString(encoding) : Buffer.from(contents);
    },
    writeFileSync(file: string, contents: string): void {
      if (options.writeFailure) throw options.writeFailure;
      writes.set(file, contents);
    },
  };

  try {
    new Script(compiled, { filename: 'scripts/ui-audit-board.mjs' }).runInNewContext({
      exports: {},
      require(id: string): unknown {
        if (id === 'fs') return fakeFs;
        if (id === 'path') return path.posix;
        throw new Error(`Unapproved script import: ${id}`);
      },
      process: {
        exit(code: number): never {
          throw new ExitSignal(code);
        },
      },
      console: {
        log: (...messages: unknown[]) => logs.push(messages.map(String).join(' ')),
        error: (...messages: unknown[]) => errors.push(messages.map(String).join(' ')),
      },
    }, {
      timeout: 1000,
      contextCodeGeneration: { strings: false, wasm: false },
    });
  } catch (caught) {
    if (caught instanceof ExitSignal) exitCode = caught.code;
    else error = caught;
  }

  return { html: writes.get(BOARD_PATH), writes, reads, existenceChecks, logs, errors, exitCode, error };
}
