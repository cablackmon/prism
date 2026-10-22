import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { Script, createContext } from 'node:vm';

// Only this source read reaches the host filesystem. Every script dependency is fake.
const migrationSource = readFileSync(resolve(__dirname, '../../../scripts/migrate.js'), 'utf8');
const virtualDirectory = '/burn4/drizzle';
const configuration = Symbol('burn4 opaque configuration');

export type MemoryDatabase = {
  records: Set<string>;
  effects: string[];
};

export type RunnerOptions = {
  database?: MemoryDatabase;
  files?: Record<string, string>;
  directoryEntries?: string[];
  missingConfiguration?: boolean;
  unavailableAttempts?: number;
  factoryFailure?: string;
  createFailure?: string;
  selectFailureOnCall?: number;
  missingUpgrade?: boolean;
  existsFailure?: string;
  directoryFailure?: string;
  readFailures?: string[];
  executeFailures?: string[];
  recordFailures?: string[];
  beginFailureOnCall?: number;
  closeFailure?: string;
};

export type Event = {
  kind: string;
  name?: string;
  transaction?: number;
  milliseconds?: number;
};

type Row = { name: string };
type Query = (parts: readonly string[], ...values: unknown[]) => Promise<Row[]>;
type Transaction = Query & { unsafe: (content: string) => Promise<void> };
type FactoryOptions = { max: number; connect_timeout: number; onnotice: () => void };

export function fixtureFiles(...names: string[]): Record<string, string> {
  return Object.fromEntries(names.map(name => [name, `-- burn4 fixture ${name}\nSELECT 1;`]));
}

export function memoryDatabase(...names: string[]): MemoryDatabase {
  return { records: new Set(names), effects: [] };
}

export async function runMigration(options: RunnerOptions = {}) {
  const database = options.database ?? memoryDatabase();
  const files = options.files ?? fixtureFiles('0000_upgrade.sql');
  const events: Event[] = [];
  const messages: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const configurations: unknown[] = [];
  const factoryOptions: FactoryOptions[] = [];
  const requiredModules: string[] = [];
  let configurationReads = 0;
  let readinessAttempts = 0;
  let selects = 0;
  let transactions = 0;

  class ExitSignal extends Error {}

  const query = (transaction?: number, staged?: MemoryDatabase): Query => async (parts, ...values) => {
    const text = parts.join('?').replace(/\s+/g, ' ').trim();
    if (text === 'SELECT 1' && transaction === undefined) {
      events.push({ kind: 'ready' });
      readinessAttempts += 1;
      if (readinessAttempts <= (options.unavailableAttempts ?? 0)) {
        throw new Error('readiness fixture failure');
      }
      return [];
    }
    if (text.startsWith('CREATE TABLE IF NOT EXISTS public.__prism_migrations')) {
      if (transaction !== undefined) throw new Error('tracking table unexpectedly inside transaction');
      events.push({ kind: 'create-table' });
      if (options.createFailure) throw new Error(options.createFailure);
      return [];
    }
    if (text === 'SELECT name FROM public.__prism_migrations') {
      events.push({ kind: 'select-records' });
      selects += 1;
      if (selects === options.selectFailureOnCall) throw new Error('record lookup fixture failure');
      return [...database.records].map(name => ({ name }));
    }
    if (text.startsWith('INSERT INTO public.__prism_migrations (name) VALUES (')) {
      if (transaction === undefined || !staged) throw new Error('migration record outside transaction');
      const name = values.length === 0 ? '0000_upgrade' : values[0];
      if (typeof name !== 'string') throw new Error('non-string migration name');
      events.push({ kind: 'record', name, transaction });
      if (options.recordFailures?.includes(name)) throw new Error(`record fixture failure: ${name}`);
      if (staged.records.has(name) && !text.includes('ON CONFLICT DO NOTHING')) {
        throw new Error(`duplicate migration fixture: ${name}`);
      }
      staged.records.add(name);
      return [];
    }
    throw new Error(`unexpected fake query: ${text}`);
  };

  const sql = Object.assign(query(), {
    begin: async (callback: (transaction: Transaction) => Promise<void>) => {
      transactions += 1;
      const transaction = transactions;
      events.push({ kind: 'begin', transaction });
      if (transaction === options.beginFailureOnCall) throw new Error('begin fixture failure');
      const staged = { records: new Set(database.records), effects: [...database.effects] };
      const transactionSql = Object.assign(query(transaction, staged), {
        unsafe: async (content: string) => {
          const entry = Object.entries(files).find(([, text]) => text === content);
          if (!entry) throw new Error('unrecognized migration content');
          const [name] = entry;
          events.push({ kind: 'execute', name, transaction });
          staged.effects.push(name);
          if (options.executeFailures?.includes(name)) throw new Error(`execution fixture failure: ${name}`);
        },
      });
      try {
        await callback(transactionSql);
        database.records = staged.records;
        database.effects = staged.effects;
        events.push({ kind: 'commit', transaction });
      } catch (error) {
        events.push({ kind: 'rollback', transaction });
        throw error;
      }
    },
    end: async () => {
      events.push({ kind: 'close' });
      if (options.closeFailure) throw new Error(options.closeFailure);
    },
  });

  const fileName = (filePath: string): string => {
    if (posix.dirname(filePath) !== virtualDirectory) throw new Error('unexpected fake filesystem path');
    return posix.basename(filePath);
  };
  const fakeFs = {
    existsSync: (filePath: string) => {
      const name = fileName(filePath);
      events.push({ kind: 'exists', name });
      if (options.existsFailure) throw new Error(options.existsFailure);
      return !options.missingUpgrade && Object.hasOwn(files, name);
    },
    readFileSync: (filePath: string, encoding: string) => {
      if (encoding !== 'utf8') throw new Error('unexpected fake encoding');
      const name = fileName(filePath);
      events.push({ kind: 'read', name });
      if (options.readFailures?.includes(name)) throw new Error(`read fixture failure: ${name}`);
      if (!Object.hasOwn(files, name)) throw new Error(`missing fixture file: ${name}`);
      return files[name];
    },
    readdirSync: (directory: string) => {
      if (directory !== virtualDirectory) throw new Error('unexpected fake migration directory');
      events.push({ kind: 'list' });
      if (options.directoryFailure) throw new Error(options.directoryFailure);
      return options.directoryEntries ?? Object.keys(files);
    },
  };
  const fakeEnvironment = Object.freeze(Object.defineProperty({}, 'DATABASE_URL', {
    get: () => {
      configurationReads += 1;
      return options.missingConfiguration ? undefined : configuration;
    },
  }));
  const fakeProcess = Object.freeze({
    env: fakeEnvironment,
    exit: (code: number): never => {
      exits.push(code);
      throw new ExitSignal('fake process exit');
    },
  });
  const allowedModules: Record<string, unknown> = {
    postgres: (input: unknown, inputOptions: FactoryOptions) => {
      configurations.push(input);
      factoryOptions.push(inputOptions);
      if (input !== configuration) throw new Error('unexpected fake configuration');
      if (options.factoryFailure) throw new Error(options.factoryFailure);
      return sql;
    },
    fs: fakeFs,
    path: Object.freeze({ join: posix.join }),
  };
  const context = createContext({
    __dirname: '/burn4/scripts',
    require: (name: string) => {
      requiredModules.push(name);
      if (!Object.hasOwn(allowedModules, name)) throw new Error(`module not allowlisted: ${name}`);
      return allowedModules[name];
    },
    process: fakeProcess,
    console: Object.freeze({
      log: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
    }),
    setTimeout: (callback: () => void, milliseconds: number) => {
      events.push({ kind: 'sleep', milliseconds });
      callback();
      return 1;
    },
  }, { codeGeneration: { strings: false, wasm: false } });

  try {
    // The last expression is main().catch(...), so this awaits the real runner.
    await new Script(migrationSource, { filename: 'scripts/migrate.js' }).runInContext(context, { timeout: 1000 });
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
  return {
    database, events, messages, errors, exits, configurations, factoryOptions,
    requiredModules, configurationReads, readinessAttempts,
  };
}
