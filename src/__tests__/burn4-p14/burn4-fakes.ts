import type { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

/** JSON response boundary with native serialization, without loading Next runtime. */
export class JsonResponse extends Response {
  static json(body: unknown, init?: ResponseInit): JsonResponse {
    const headers = new Headers(init?.headers);
    headers.set('content-type', 'application/json');
    return new JsonResponse(JSON.stringify(body), { ...init, headers });
  }
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function jsonRequest(body: unknown) {
  const json = jest.fn(async () => body);
  return { request: { json } as unknown as NextRequest, json };
}

export function malformedRequest() {
  const json = jest.fn(async () => JSON.parse('{this is not JSON}'));
  return { request: { json } as unknown as NextRequest, json };
}

export type Tombstone = { id: string; name: string };

/** Persistence boundary only. The excluded tombstone service is never loaded. */
export class TombstoneStore {
  namespaces = new Map<string, Tombstone[]>();
  writes: { key: string; entries: Tombstone[] }[] = [];
  listFailure: unknown;
  restoreFailure: unknown;
  restoreGate: Promise<void> | undefined;

  reset() {
    this.namespaces.clear();
    this.writes = [];
    this.listFailure = undefined;
    this.restoreFailure = undefined;
    this.restoreGate = undefined;
  }

  list = jest.fn(async (key: string) => {
    if (this.listFailure) throw this.listFailure;
    return (this.namespaces.get(key) ?? []).map((entry) => ({ ...entry }));
  });

  remove = jest.fn(async (key: string, id: string) => {
    if (this.restoreFailure) throw this.restoreFailure;
    await this.restoreGate;
    const entries = this.namespaces.get(key) ?? [];
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length !== entries.length) {
      this.namespaces.set(key, next);
      this.writes.push({ key, entries: next.map((entry) => ({ ...entry })) });
    }
  });
}

export type SourceRow = { id: string; name: string; provider: 'mealie' | 'tandoor' };
export type RecipeRow = { id: string; name: string; sourceId: string | null; notes: string };

/** Models source deletion plus ON DELETE SET NULL, never deleting a recipe. */
export class RecipeStore {
  sources: SourceRow[] = [];
  recipes: RecipeRow[] = [];
  queries: { sql: string; params: unknown[] }[] = [];
  deleteFailure: unknown;
  deleteGate: Promise<void> | undefined;
  private dialect = new PgDialect();

  constructor(private sourceTable: unknown) {}

  reset() {
    this.sources = [];
    this.recipes = [];
    this.queries = [];
    this.deleteFailure = undefined;
    this.deleteGate = undefined;
  }

  delete = jest.fn((table: unknown) => {
    if (table !== this.sourceTable) throw new Error('Only recipe source deletion is supported by the fake');
    return {
      where: async (predicate: SQL) => {
        const compiled = this.dialect.sqlToQuery(predicate);
        this.queries.push({ sql: compiled.sql, params: compiled.params as unknown[] });
        if (compiled.params.length !== 1 || compiled.sql !== '"recipe_sources"."id" = $1') {
          throw new Error('Unsupported recipe source predicate');
        }
        const id = compiled.params[0];
        if (typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) {
          throw Object.assign(new Error('Synthetic invalid input syntax for UUID'), { code: '22P02' });
        }
        if (this.deleteFailure) throw this.deleteFailure;
        await this.deleteGate;
        const exists = this.sources.some((source) => source.id === id);
        this.sources = this.sources.filter((source) => source.id !== id);
        if (exists) {
          this.recipes = this.recipes.map((recipe) => recipe.sourceId === id ? { ...recipe, sourceId: null } : recipe);
        }
      },
    };
  });
}
