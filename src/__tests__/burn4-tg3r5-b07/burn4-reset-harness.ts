import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export type ResetName =
  | 'resetTasks'
  | 'resetShoppingItems'
  | 'resetChoreCompletions'
  | 'resetModes'
  | 'resetAll';
export type PayloadKind = 'tasks' | 'shopping' | 'chores' | 'modes' | 'unknown';
export type PayloadSummary = {
  kind: PayloadKind;
  nonempty: boolean;
  oneStatement: boolean;
  expectedMutation: boolean;
};
export type TraceEntry = {
  action: 'write' | 'execute' | 'read' | 'unlink';
  operation?: 'sql' | 'redis';
  path?: string;
  payload?: PayloadSummary;
  encoding?: string;
  pipe?: boolean;
  docker?: boolean;
  windowsShell?: boolean;
};

type ExecuteOptions = { stdio?: string; shell?: string };
type HarnessOptions = {
  world?: ResetWorld;
  now?: () => number;
  beforeWrite?: () => void;
  afterWrite?: () => void;
  partialWriteFailure?: Error;
  beforeExecute?: (entry: TraceEntry) => void;
  beforeUnlink?: () => void;
};
export type ResetApi = Record<ResetName, () => void>;

function summarize(sql: string): PayloadSummary {
  const kind: PayloadKind = /UPDATE\s+tasks\b/i.test(sql)
    ? 'tasks'
    : /UPDATE\s+shopping_items\b/i.test(sql)
      ? 'shopping'
      : /DELETE\s+FROM\s+chore_completions\b/i.test(sql)
        ? 'chores'
        : /DELETE\s+FROM\s+settings\b/i.test(sql)
          ? 'modes'
          : 'unknown';
  const expectedMutation = {
    tasks:
      /completed\s*=\s*false/i.test(sql) &&
      /completed_at\s*=\s*NULL/i.test(sql) &&
      /completed_by\s*=\s*NULL/i.test(sql) &&
      /WHERE\s+completed\s*=\s*true/i.test(sql),
    shopping: /SET\s+checked\s*=\s*false/i.test(sql),
    chores: /completed_at\s*>\s*now\(\)\s*-\s*interval\s*'1 day'/i.test(sql),
    modes: /WHERE\s+key\s+IN\s*\(\s*'awayMode'\s*,\s*'babysitterMode'\s*\)/i.test(sql),
    unknown: false,
  }[kind];
  return {
    kind,
    nonempty: sql.trim().length > 0,
    oneStatement: sql.split(';').filter((part) => part.trim()).length === 1,
    expectedMutation,
  };
}

/** Only summaries leave this in-memory store. SQL and commands never reach logs. */
export class ResetWorld {
  readonly trace: TraceEntry[] = [];
  private readonly files = new Map<string, string>();

  get remainingFileCount(): number {
    return this.files.size;
  }

  write(path: string, sql: string, encoding: string, hooks: HarnessOptions): void {
    hooks.beforeWrite?.();
    const content = hooks.partialWriteFailure ? sql.slice(0, 1) : sql;
    this.files.set(path, content);
    this.trace.push({ action: 'write', path, encoding, payload: summarize(content) });
    if (hooks.partialWriteFailure) throw hooks.partialWriteFailure;
    hooks.afterWrite?.();
  }

  execute(command: string, options: ExecuteOptions, hooks: HarnessOptions): void {
    const sqlPath = /< "([^"]+)"$/.exec(command)?.[1];
    const redis = command.startsWith('docker exec prism-redis redis-cli ') &&
      command.endsWith(' FLUSHDB');
    const sql = command.startsWith('docker exec -i prism-db psql -U prism -d prism ') &&
      sqlPath !== undefined;
    if (!redis && !sql) throw new Error('Unexpected inert subprocess operation');
    const entry: TraceEntry = {
      action: 'execute',
      operation: redis ? 'redis' : 'sql',
      pipe: options.stdio === 'pipe',
      docker: true,
      windowsShell: options.shell === 'cmd.exe',
      ...(sqlPath ? { path: sqlPath } : {}),
    };
    this.trace.push(entry);
    hooks.beforeExecute?.(entry);
    if (sqlPath) {
      const content = this.files.get(sqlPath);
      if (content === undefined) throw new Error('Synthetic SQL payload missing');
      this.trace.push({ action: 'read', path: sqlPath, payload: summarize(content) });
    }
  }

  unlink(path: string, hooks: HarnessOptions): void {
    this.trace.push({ action: 'unlink', path });
    hooks.beforeUnlink?.();
    if (!this.files.delete(path)) throw new Error('Synthetic file already absent');
  }
}

const sourcePath = resolve(__dirname, '../../../e2e/helpers/reset.ts');
const source = readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    strict: true,
  },
  fileName: sourcePath,
}).outputText;

export function loadResetHarness(options: HarnessOptions = {}): {
  api: ResetApi;
  world: ResetWorld;
  environmentKeys: () => string[];
} {
  const world = options.world ?? new ResetWorld();
  const environment: Record<string, never> = Object.freeze(Object.create(null));
  const exposed: Partial<ResetApi> = {};
  const modules: Record<string, unknown> = {
    child_process: {
      execSync: (command: string, executionOptions: ExecuteOptions) =>
        world.execute(command, executionOptions, options),
    },
    fs: {
      writeFileSync: (path: string, sql: string, encoding: string) =>
        world.write(path, sql, encoding, options),
      unlinkSync: (path: string) => world.unlink(path, options),
    },
    path: {
      join: (...parts: string[]) => {
        if (parts.length !== 2 || parts[0] !== '/burn4-memory') {
          throw new Error('Unexpected inert path request');
        }
        return parts.join('/');
      },
    },
    os: { tmpdir: () => '/burn4-memory' },
  };
  runInNewContext(compiled, {
    exports: exposed,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error('Unexpected inert module request');
      return modules[name];
    },
    process: Object.freeze({ env: environment }),
    Date: Object.freeze({ now: options.now ?? (() => 1000) }),
    console: Object.freeze({
      log: () => { throw new Error('Source logging is blocked'); },
      error: () => { throw new Error('Source logging is blocked'); },
    }),
  }, { timeout: 1000, filename: 'burn4-inert-reset-source.js' });
  const names: ResetName[] = [
    'resetTasks', 'resetShoppingItems', 'resetChoreCompletions', 'resetModes', 'resetAll',
  ];
  if (names.some((name) => typeof exposed[name] !== 'function')) {
    throw new Error('Missing reset export');
  }
  return { api: exposed as ResetApi, world, environmentKeys: () => Object.keys(environment) };
}

export function attempt(action: () => void): unknown {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
}
