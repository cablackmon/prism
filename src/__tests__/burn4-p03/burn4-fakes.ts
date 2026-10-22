import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export class ImageStore {
  files = new Map<string, Buffer>();
  directories = new Set<string>();
  operations: { name: string; args: unknown[] }[] = [];
  mkdirError: unknown;
  unlinkError: unknown;
  transformError: unknown;
  writeError: unknown;
  directoryGate: Promise<void> | undefined;

  reset() {
    this.files.clear();
    this.directories.clear();
    this.operations = [];
    this.mkdirError = undefined;
    this.unlinkError = undefined;
    this.transformError = undefined;
    this.writeError = undefined;
    this.directoryGate = undefined;
  }

  fs = {
    mkdir: jest.fn(async (directory: string, options: unknown) => {
      this.operations.push({ name: 'mkdir', args: [directory, options] });
      if (this.mkdirError) throw this.mkdirError;
      await this.directoryGate;
      this.directories.add(directory);
    }),
    unlink: jest.fn(async (filename: string) => {
      this.operations.push({ name: 'unlink', args: [filename] });
      if (this.unlinkError) throw this.unlinkError;
      if (!this.files.delete(filename)) {
        throw Object.assign(new Error('Synthetic file does not exist'), { code: 'ENOENT' });
      }
    }),
  };

  sharp = jest.fn((input: Buffer) => {
    this.operations.push({ name: 'sharp', args: [input] });
    if (this.transformError) throw this.transformError;
    const chain = {
      rotate: () => {
        this.operations.push({ name: 'rotate', args: [] });
        return chain;
      },
      resize: (...args: unknown[]) => {
        this.operations.push({ name: 'resize', args });
        return chain;
      },
      jpeg: (options: unknown) => {
        this.operations.push({ name: 'jpeg', args: [options] });
        return chain;
      },
      toFile: async (filename: string) => {
        this.operations.push({ name: 'toFile', args: [filename] });
        if (this.writeError) throw this.writeError;
        // A transformed marker, never an actual image or host file.
        this.files.set(filename, Buffer.concat([Buffer.from('synthetic-jpeg:'), input]));
        return { width: 800, height: 600, size: input.length, format: 'jpeg' };
      },
    };
    return chain;
  });
}

export type AuditInput = {
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
};
export type AuditRow = AuditInput & { id: string; createdAt: Date };

/** Offline persistence model with deferred insert completion and strict age filtering. */
export class AuditStore {
  rows: AuditRow[] = [];
  writes: AuditInput[] = [];
  pending: ReturnType<typeof deferred<void>>[] = [];
  deleteQueries: { sql: string; params: unknown[] }[] = [];
  holdWrites = false;
  insertFailure: unknown;
  cleanupFailure: unknown;
  private dialect = new PgDialect();

  constructor(private table: unknown) {}

  reset() {
    this.rows = [];
    this.writes = [];
    this.pending = [];
    this.deleteQueries = [];
    this.holdWrites = false;
    this.insertFailure = undefined;
    this.cleanupFailure = undefined;
  }

  insert = jest.fn((table: unknown) => {
    if (table !== this.table) throw new Error('Unexpected audit insert table');
    return {
      values: (values: AuditInput) => {
        this.writes.push(values);
        const gate = deferred<void>();
        if (this.holdWrites) this.pending.push(gate);
        else if (this.insertFailure) gate.reject(this.insertFailure);
        else gate.resolve();
        return gate.promise.then(() => {
          this.rows.push({ ...values, id: `audit-${this.rows.length + 1}`, createdAt: new Date() });
        });
      },
    };
  });

  delete = jest.fn((table: unknown) => {
    if (table !== this.table) throw new Error('Unexpected audit delete table');
    return {
      where: async (predicate: SQL) => {
        const query = this.dialect.sqlToQuery(predicate);
        this.deleteQueries.push({ sql: query.sql, params: query.params as unknown[] });
        if (this.cleanupFailure) throw this.cleanupFailure;
        if (query.params.length !== 1 || !query.sql.includes('"created_at" < $1')) {
          throw new Error('Unsupported audit cleanup predicate');
        }
        const cutoff = new Date(query.params[0] as string).getTime();
        if (!Number.isFinite(cutoff)) throw new Error('Invalid synthetic audit cutoff');
        this.rows = this.rows.filter((row) => row.createdAt.getTime() >= cutoff);
      },
    };
  });
}
