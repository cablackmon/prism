import { NextRequest, NextResponse } from 'next/server';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import { auditLogs, shoppingItems, shoppingLists } from './burn4-db-fixture';
import type { AuthResult } from '@/lib/auth';

export const listId = '10000000-abcd-4000-8000-000000000001';
export const userId = '20000000-0000-4000-8000-000000000001';
export const otherId = '30000000-0000-4000-8000-000000000001';
export const createdAt = new Date('2026-01-02T03:04:05.000Z');
type ItemInsert = typeof shoppingItems.$inferInsert;
type AuditInsert = typeof auditLogs.$inferInsert;
export type ReturnedItem = Omit<typeof shoppingItems.$inferSelect, 'addedBy' | 'sourceId'>;
type FailureStage = 'select' | 'item' | 'audit' | 'commit' | undefined;
export interface QueryEvidence { kind: 'list' | 'items' | 'audit'; sql: string; params: unknown[] }

// This real SQL builder only compiles toSQL(). Its transport always throws.
const sqlBuilder = drizzle(async () => { throw new Error('SQL execution is forbidden'); });
export const state = {
  auth: { userId, role: 'parent' } as AuthResult | NextResponse,
  authError: false,
  rateError: false,
  limited: null as NextResponse | null,
  listExists: true,
  failure: undefined as FailureStage,
  cacheError: false,
  transformReturned: undefined as ((rows: ReturnedItem[]) => unknown[]) | undefined,
  transactions: 0,
  commits: 0,
  rollbacks: 0,
  committedItems: [] as ItemInsert[],
  committedAudits: [] as AuditInsert[],
  queries: [] as QueryEvidence[],
  events: [] as string[],
  idCounter: 0,
};

class TransactionFixture {
  items: ItemInsert[] = [];
  audits: AuditInsert[] = [];
  select(projection: Record<string, AnyPgColumn>) {
    return { from: (table: typeof shoppingLists) => ({
      where: (condition: SQL) => ({ limit: (limit: number) => ({
        for: async (lock: 'key share') => {
          state.events.push('list');
          state.queries.push({ kind: 'list', ...sqlBuilder.select(projection).from(table)
            .where(condition).limit(limit).for(lock).toSQL() });
          if (state.failure === 'select') throw new Error('injected select failure');
          return state.listExists ? [{ id: listId }] : [];
        },
      }) }),
    }) };
  }
  insert(table: typeof shoppingItems | typeof auditLogs) {
    return { values: (values: Record<string, unknown>[]) => {
      if (table === shoppingItems) {
        const rows = values as ItemInsert[];
        return { returning: async (projection: Record<string, AnyPgColumn>) => {
          state.events.push('items');
          state.queries.push({ kind: 'items', ...sqlBuilder.insert(shoppingItems)
            .values(rows).returning(projection).toSQL() });
          if (state.failure === 'item') throw new Error('injected item failure');
          this.items = rows;
          const returned: ReturnedItem[] = rows.map(row => ({
            id: row.id!, listId: row.listId, name: row.name,
            quantity: row.quantity ?? null, unit: row.unit ?? null,
            category: row.category ?? null, notes: row.notes ?? null,
            checked: row.checked ?? false, recurring: row.recurring ?? false,
            recurrenceInterval: row.recurrenceInterval ?? null, createdAt,
          }));
          return state.transformReturned ? state.transformReturned(returned) : returned;
        } };
      }
      const rows = values as AuditInsert[];
      return (async () => {
        state.events.push('audit');
        state.queries.push({ kind: 'audit', ...sqlBuilder.insert(auditLogs).values(rows).toSQL() });
        if (state.failure === 'audit') throw new Error('injected audit failure');
        this.audits = rows;
      })();
    } };
  }
}
const database = {
  transaction: async (callback: (tx: TransactionFixture) => Promise<unknown>) => {
    state.transactions++;
    state.events.push('begin');
    const tx = new TransactionFixture();
    try {
      const result = await callback(tx);
      if (state.failure === 'commit') throw new Error('injected commit failure');
      state.committedItems.push(...tx.items);
      state.committedAudits.push(...tx.audits);
      state.commits++;
      state.events.push('commit');
      return result;
    } catch (error) {
      state.rollbacks++;
      state.events.push('rollback');
      throw error;
    }
  },
};
export const requireAuthMock = jest.fn(async () => {
  state.events.push('auth');
  if (state.authError) throw new Error('injected auth failure');
  return state.auth;
});
export const rateLimitMock = jest.fn(async (..._args: [string, string, number, number]) => {
  state.events.push('rate');
  if (state.rateError) throw new Error('injected rate failure');
  return state.limited;
});
export const invalidateMock = jest.fn(async (_entity: string) => {
  state.events.push('cache');
  if (state.cacheError) throw new Error('injected cache failure');
});

// Virtual exact-name mocks are installed before the route is required. Existing
// app files are never resolved to disk or executed, including their imports.
jest.doMock('@/lib/auth', () => ({ requireAuth: requireAuthMock }), { virtual: true });
jest.doMock('@/lib/db/client', () => ({ db: database }), { virtual: true });
jest.doMock('@/lib/db/schema', () => ({ auditLogs, shoppingItems, shoppingLists }), { virtual: true });
jest.doMock('@/lib/cache/rateLimit', () => ({ rateLimitGuard: rateLimitMock }), { virtual: true });
jest.doMock('@/lib/cache/cacheKeys', () => ({ invalidateEntity: invalidateMock }), { virtual: true });
jest.doMock('node:crypto', () => ({ randomUUID: () => {
  state.idCounter++;
  return `40000000-0000-4000-8000-${String(state.idCounter).padStart(12, '0')}`;
} }));
export const { POST } = require('../../app/api/shopping-items/batch/route') as
  typeof import('../../app/api/shopping-items/batch/route');

export function reset() {
  state.auth = { userId, role: 'parent' };
  state.authError = false;
  state.rateError = false;
  state.limited = null;
  state.listExists = true;
  state.failure = undefined;
  state.cacheError = false;
  state.transformReturned = undefined;
  state.transactions = state.commits = state.rollbacks = state.idCounter = 0;
  state.committedItems = [];
  state.committedAudits = [];
  state.queries = [];
  state.events = [];
  requireAuthMock.mockClear();
  rateLimitMock.mockClear();
  invalidateMock.mockClear();
}
export function payload(items: unknown[] = [{ name: '1/2 cup rice' }]) {
  return { listId, items };
}
export function request(body: unknown = payload(), contentType = 'application/json') {
  return new NextRequest('http://offline.invalid/api/shopping-items/batch', {
    method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify(body),
  });
}
export function streamRequest(chunks: Uint8Array[], options: {
  contentLength?: string; rejectRead?: boolean; rejectCancel?: boolean; neverCancel?: boolean;
} = {}) {
  let offset = 0;
  const cancelled = jest.fn(() => {
    if (options.rejectCancel) return Promise.reject(new Error('injected cancellation failure'));
    if (options.neverCancel) return new Promise<void>(() => undefined);
    return undefined;
  });
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.rejectRead) { controller.error(new Error('injected read failure')); return; }
      if (offset === chunks.length) { controller.close(); return; }
      controller.enqueue(chunks[offset++]!);
    },
    cancel: cancelled,
  });
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength);
  return { request: { body, headers } as NextRequest, cancelled };
}
export function noBodyRequest() {
  return { body: null, headers: new Headers({ 'content-type': 'application/json' }) } as NextRequest;
}
export function unreadableRequest() {
  const bodyRead = jest.fn(() => { throw new Error('Body must remain unread'); });
  return { request: { get body() { return bodyRead(); } } as unknown as NextRequest, bodyRead };
}
export function committedCounts() {
  return [state.committedItems.length, state.committedAudits.length];
}
