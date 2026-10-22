import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export type Reply = {
  ok: jest.Mock<boolean, []>;
  json: jest.Mock<Promise<unknown>, []>;
};

export type FakePage = {
  request: {
    get: jest.Mock<Promise<Reply>, [string]>;
    delete: jest.Mock<Promise<Reply>, [string]>;
  };
};

export type Cleanup = {
  deleteTaskByTitle: (page: FakePage, title: string) => Promise<boolean>;
  deleteEventByTitle: (page: FakePage, title: string) => Promise<boolean>;
  deleteMessageByContent: (page: FakePage, content: string) => Promise<boolean>;
  deleteShoppingList: (page: FakePage, id: string) => Promise<boolean>;
  deleteChoreByTitle: (page: FakePage, title: string) => Promise<boolean>;
  deleteShoppingItem: (page: FakePage, id: string) => Promise<boolean>;
};

const sourcePath = resolve(__dirname, '../../../e2e/helpers/cleanup.ts');
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
}).outputText;

/** Only the constructor forms used by the helper are supplied to its VM. */
export function fixedClock(
  year = 2026,
  month = 0,
  day = 15,
  utcOffsetMinutes = 0,
): DateConstructor {
  const offset = utcOffsetMinutes * 60_000;
  class ClockDate extends Date {
    constructor(...parts: number[]) {
      if (parts.length !== 0 && parts.length !== 3) {
        throw new Error('Unexpected date constructor');
      }
      super(
        parts.length === 0
          ? Date.UTC(year, month, day, 12) - offset
          : Date.UTC(parts[0]!, parts[1]!, parts[2]!) - offset,
      );
    }

    getFullYear(): number {
      return new Date(this.getTime() + offset).getUTCFullYear();
    }

    getMonth(): number {
      return new Date(this.getTime() + offset).getUTCMonth();
    }
  }
  return ClockDate as DateConstructor;
}

/** The unchanged source has no runtime imports after its Page type is erased. */
export function loadCleanup(clock: DateConstructor = fixedClock()): Cleanup {
  const exported: Record<string, unknown> = {};
  runInNewContext(
    compiled,
    {
      exports: exported,
      Date: clock,
      require: (name: string): never => {
        throw new Error(`Runtime imports are forbidden: ${name}`);
      },
    },
    { filename: sourcePath, timeout: 1_000 },
  );
  return exported as Cleanup;
}

export function reply(body: unknown = [], ok = true): Reply {
  return {
    ok: jest.fn(() => ok),
    json: jest.fn<Promise<unknown>, []>().mockResolvedValue(body),
  };
}

export function fakePage(body: unknown = [], ok = true): FakePage {
  return {
    request: {
      get: jest.fn<Promise<Reply>, [string]>().mockResolvedValue(reply(body, ok)),
      delete: jest.fn<Promise<Reply>, [string]>().mockResolvedValue(reply()),
    },
  };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: Error) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

export const collections = [
  { method: 'deleteTaskByTitle', key: 'tasks', path: 'tasks', field: 'title' },
  { method: 'deleteEventByTitle', key: 'events', path: 'events', field: 'title' },
  { method: 'deleteMessageByContent', key: 'messages', path: 'messages', field: 'message' },
  { method: 'deleteChoreByTitle', key: 'chores', path: 'chores', field: 'title' },
] as const;
