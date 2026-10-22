import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Stage = 'tmpdir' | 'time' | 'join' | 'write' | 'exec' | 'unlink';
type SourceTransform = (source: string) => string;

type Options = {
  platform?: 'windows' | 'linux';
  root?: string;
  now?: () => number;
  fail?: ReadonlySet<Stage>;
  partialWrite?: boolean;
  disk?: Map<string, string>;
  pid?: number;
  beforeConsume?: () => void;
  transform?: SourceTransform;
};

type Execution = {
  path: string;
  sql: string;
};

/** Load only the unchanged teardown. All capabilities available to it are inert. */
export function loadTeardown(options: Options = {}) {
  const disk = options.disk ?? new Map<string, string>();
  const trace: Stage[] = [];
  const warnings: string[] = [];
  const denials: string[] = [];
  const writes: string[] = [];
  const executions: Execution[] = [];
  const commandOptions: { stdio: string; shell?: string }[] = [];

  function denied(message: string): never {
    denials.push(message);
    throw new Error(message);
  }

  function inertModule(name: string, members: Record<string, unknown>) {
    return new Proxy(Object.freeze(members), {
      get(target, key) {
        if (typeof key !== 'string' || !Object.hasOwn(target, key)) {
          return denied(`Denied capability: ${name}.${String(key)}`);
        }
        return target[key];
      },
    });
  }

  function stage(name: Stage) {
    trace.push(name);
    if (options.fail?.has(name)) throw new Error(`Inert ${name} failure detail`);
  }

  const modules: Record<string, unknown> = {
    os: inertModule('os', {
      tmpdir() {
        stage('tmpdir');
        return options.root ?? '/inert-tmp';
      },
    }),
    path: inertModule('path', {
      join(root: unknown, leaf: unknown) {
        stage('join');
        assert.equal(typeof root, 'string');
        assert.equal(typeof leaf, 'string');
        return `${root}/${leaf}`;
      },
    }),
    fs: inertModule('fs', {
      writeFileSync(path: string, data: string, encoding: unknown) {
        assert.equal(typeof path, 'string');
        assert.equal(typeof data, 'string');
        assert.equal(encoding, 'utf-8');
        if (options.partialWrite) {
          trace.push('write');
          disk.set(path, data.slice(0, 12));
          writes.push(path);
          throw new Error('Inert partial write failure detail');
        }
        stage('write');
        disk.set(path, data);
        writes.push(path);
      },
      unlinkSync(path: string) {
        stage('unlink');
        if (!disk.delete(path)) throw new Error('Inert missing input');
      },
    }),
    child_process: inertModule('child_process', {
      execSync(command: unknown, settings: { stdio: string; shell?: string }) {
        stage('exec');
        if (typeof command !== 'string') return denied('Denied non-string command');
        const input = /^docker exec -i prism-db psql -U prism -d prism < "([^"\n]+)"$/.exec(command)?.[1];
        if (!input) return denied('Denied unknown command');
        if (settings.stdio !== 'pipe') return denied('Denied subprocess output');
        commandOptions.push({ ...settings });
        if (options.platform === 'linux' && settings.shell === 'cmd.exe') {
          throw new Error('Inert unavailable Windows shell');
        }
        options.beforeConsume?.();
        const sql = disk.get(input);
        if (sql === undefined) throw new Error('Inert deleted input');
        executions.push({ path: input, sql });
      },
    }),
  };
  const exports: { default?: unknown } = {};
  const sandbox = {
    exports,
    module: { exports },
    require(name: string) {
      if (!Object.hasOwn(modules, name)) return denied(`Denied import: ${name}`);
      return modules[name];
    },
    Date: inertModule('Date', {
      now() {
        stage('time');
        return options.now?.() ?? 1000;
      },
    }),
    console: inertModule('console', {
      warn(message: unknown, ...extra: unknown[]) {
        if (typeof message !== 'string' || extra.length) return denied('Denied warning payload');
        warnings.push(message);
      },
    }),
    process: inertModule('process', { pid: options.pid ?? 1 }),
  };
  const original = readFileSync(resolve(__dirname, '../../..', 'e2e/global-teardown.ts'), 'utf8');
  const source = options.transform?.(original) ?? original;
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'global-teardown.ts',
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length, 0, 'teardown transpiles without diagnostics');
  runInNewContext(compiled.outputText, sandbox, {
    timeout: 1000,
    filename: 'inert-global-teardown.cjs',
    contextCodeGeneration: { strings: false, wasm: false },
  });
  assert.equal(typeof exports.default, 'function', 'default teardown export exists');
  const teardown = exports.default as () => unknown;
  return {
    disk, trace, warnings, denials, writes, executions, commandOptions,
    run() {
      const result = teardown();
      assert.deepEqual(denials, [], 'tested source requested only explicitly inert capabilities');
      return result;
    },
  };
}

/** These contracts are shared by test.failing cases and direct inverse probes. */
export const gapContracts = {
  linux(transform?: SourceTransform) {
    const unit = loadTeardown({ platform: 'linux', transform });
    unit.run();
    assert.equal(unit.executions.length, 1, 'KNOWN GAP: supported Linux teardown must execute cleanup');
  },
  partial(transform?: SourceTransform) {
    const unit = loadTeardown({ partialWrite: true, transform });
    unit.run();
    assert.equal(unit.disk.size, 0, 'KNOWN GAP: failed temporary writes must leave no artifact');
  },
  concurrent(transform?: SourceTransform) {
    const disk = new Map<string, string>();
    const inner = loadTeardown({ disk, pid: 2, transform });
    const outer = loadTeardown({ disk, pid: 1, transform, beforeConsume: () => { inner.run(); } });
    outer.run();
    assert.equal(outer.executions.length + inner.executions.length, 2,
      'KNOWN GAP: same-millisecond teardowns must both consume their input');
  },
};

/** Minimal hypothetical repairs are evaluated in VM copies, never written to source. */
export const intendedRepairs: Record<keyof typeof gapContracts, SourceTransform> = {
  linux: (source) => source.replace("shell: 'cmd.exe',", "shell: '/bin/sh',"),
  partial: (source) => source.replace(
    "writeFileSync(tmpFile, sql, 'utf-8');\n  try {",
    "try {\n    writeFileSync(tmpFile, sql, 'utf-8');",
  ),
  concurrent: (source) => source.replace('Date.now()', "(String(process.pid) + '-' + Date.now())"),
};
