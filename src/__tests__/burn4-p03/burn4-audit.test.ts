import { db } from '@/lib/db/client';
import { auditLogs } from '@/lib/db/schema';
import { logActivity } from '@/lib/services/auditLog';
import { cleanupOldAuditLogs } from '@/lib/services/auditCleanup';
import type { AuditStore, AuditRow } from './burn4-fakes';

jest.mock('@/lib/db/schema', () => {
  const { pgTable, timestamp } = jest.requireActual('drizzle-orm/pg-core') as typeof import('drizzle-orm/pg-core');
  return { auditLogs: pgTable('audit_logs', { createdAt: timestamp('created_at') }) };
});
jest.mock('@/lib/db/client', () => {
  const { AuditStore } = jest.requireActual('./burn4-fakes') as typeof import('./burn4-fakes');
  const { auditLogs } = jest.requireMock('@/lib/db/schema');
  return { db: new AuditStore(auditLogs) };
});

const store = db as unknown as AuditStore;
const params = { userId: 'synthetic-user', action: 'recipe.updated', entityType: 'recipe', summary: 'Updated a synthetic recipe' };
const now = new Date('2026-10-21T18:23:00.000Z');
const age = 30 * 24 * 60 * 60 * 1000;
const cutoff = new Date(now.getTime() - age);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function row(id: string, createdAt: Date): AuditRow {
  return { ...params, entityId: null, metadata: null, id, createdAt };
}

beforeEach(() => {
  store.reset();
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(now);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('fire-and-forget activity logging', () => {
  test('persists the complete caller payload without modifying frozen inputs', async () => {
    const metadata = Object.freeze({ field: 'title', previous: 'Old title', next: 'New title' });
    const input = Object.freeze({ ...params, entityId: 'synthetic-recipe', metadata });
    expect(logActivity(input)).toBeUndefined();
    await flush();
    expect(store.insert).toHaveBeenCalledWith(auditLogs);
    expect(store.rows).toEqual([{ ...input, id: 'audit-1', createdAt: now }]);
    expect(input.metadata).toEqual(metadata);
    expect(console.error).not.toHaveBeenCalled();
  });

  test('omitted optional values become null and anonymous actors remain null', async () => {
    logActivity({ ...params, userId: null });
    await flush();
    expect(store.writes).toEqual([{ ...params, userId: null, entityId: null, metadata: null }]);
    expect(store.rows[0]).toMatchObject({ userId: null, entityId: null, metadata: null });
  });

  test.each([null, ''] as const)('preserves an explicit nullable or empty entity ID: %j', async (entityId) => {
    logActivity({ ...params, entityId, metadata: {} });
    await flush();
    expect(store.rows[0]).toMatchObject({ entityId, metadata: {} });
  });

  test('returns immediately while a database insert remains pending', async () => {
    store.holdWrites = true;
    expect(logActivity(params)).toBeUndefined();
    expect(store.pending).toHaveLength(1);
    expect(store.rows).toEqual([]);
    store.pending[0]!.resolve();
    await flush();
    expect(store.rows[0]?.summary).toBe(params.summary);
  });

  test.each(['error', 'string'] as const)('reports an asynchronous %s rejection without leaking a rejected return promise', async (kind) => {
    const failure = kind === 'error' ? new Error('Synthetic insert rejection') : 'synthetic insert rejection';
    store.insertFailure = failure;
    expect(logActivity(params)).toBeUndefined();
    await flush();
    expect(store.rows).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('Audit log failed:', failure);
  });

  test('deferred write failure is observed after the caller has already returned', async () => {
    store.holdWrites = true;
    logActivity(params);
    expect(console.error).not.toHaveBeenCalled();
    const failure = new Error('Synthetic late failure');
    store.pending[0]!.reject(failure);
    await flush();
    expect(console.error).toHaveBeenCalledWith('Audit log failed:', failure);
    expect(store.rows).toEqual([]);
  });

  test('an earlier failed write does not prevent a later activity from persisting', async () => {
    store.insertFailure = new Error('Synthetic first write failure');
    logActivity(params);
    store.insertFailure = undefined;
    logActivity({ ...params, action: 'recipe.deleted', summary: 'Deleted another synthetic recipe' });
    await flush();
    expect(store.rows.map((entry) => entry.action)).toEqual(['recipe.deleted']);
    expect(store.writes).toHaveLength(2);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  test('concurrent caller events preserve their individual payloads and outcomes', async () => {
    store.holdWrites = true;
    logActivity({ ...params, entityId: 'recipe-first', metadata: { version: 1 } });
    logActivity({ ...params, entityId: 'recipe-second', metadata: { version: 2 } });
    store.pending[1]!.resolve();
    store.pending[0]!.resolve();
    await flush();
    expect(store.rows.map((entry) => ({ entityId: entry.entityId, metadata: entry.metadata }))).toEqual([
      { entityId: 'recipe-second', metadata: { version: 2 } },
      { entityId: 'recipe-first', metadata: { version: 1 } },
    ]);
  });
});

describe('age-based audit retention', () => {
  test('deletes strictly older than 30 days while preserving the boundary and future rows', async () => {
    const boundary = row('at-boundary', cutoff);
    const recent = row('recent', new Date(cutoff.getTime() + 1));
    const future = row('future', new Date(now.getTime() + age));
    store.rows.push(row('oldest', new Date('2000-01-01T00:00:00.000Z')),
      row('just-too-old', new Date(cutoff.getTime() - 1)), boundary, recent, future);
    await expect(cleanupOldAuditLogs()).resolves.toBeUndefined();
    expect(store.delete).toHaveBeenCalledWith(auditLogs);
    expect(store.rows).toEqual([boundary, recent, future]);
    expect(store.deleteQueries).toHaveLength(1);
    expect(new Date(store.deleteQueries[0]!.params[0] as string)).toEqual(cutoff);
    expect(console.error).not.toHaveBeenCalled();
  });

  test('an empty audit table is a successful no-op', async () => {
    await expect(cleanupOldAuditLogs()).resolves.toBeUndefined();
    expect(store.rows).toEqual([]);
    expect(store.deleteQueries).toHaveLength(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  test('repeated cleanup is idempotent', async () => {
    const recent = row('recent', now);
    store.rows.push(row('expired', new Date(cutoff.getTime() - 1)), recent);
    await cleanupOldAuditLogs();
    await cleanupOldAuditLogs();
    expect(store.rows).toEqual([recent]);
    expect(store.deleteQueries).toHaveLength(2);
  });

  test('recomputes the cutoff on each call as retained entries age out', async () => {
    const retained = row('aging', new Date(cutoff.getTime() + 1));
    store.rows.push(retained);
    await cleanupOldAuditLogs();
    expect(store.rows).toEqual([retained]);
    jest.setSystemTime(now.getTime() + 2);
    await cleanupOldAuditLogs();
    expect(store.rows).toEqual([]);
    expect(new Date(store.deleteQueries[1]!.params[0] as string).getTime()).toBe(cutoff.getTime() + 2);
  });

  test.each(['error', 'string'] as const)('reports a cleanup %s failure and leaves rows unchanged', async (kind) => {
    const failure = kind === 'error' ? new Error('Synthetic delete failure') : 'synthetic delete failure';
    const original = row('expired', new Date(cutoff.getTime() - 1));
    store.rows.push(original);
    store.cleanupFailure = failure;
    await expect(cleanupOldAuditLogs()).resolves.toBeUndefined();
    expect(store.rows).toEqual([original]);
    expect(console.error).toHaveBeenCalledWith('Audit log cleanup failed:', failure);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  test('cleanup recovers on the next invocation after a transient database failure', async () => {
    store.rows.push(row('expired', new Date(cutoff.getTime() - 1)));
    store.cleanupFailure = new Error('Synthetic transient delete failure');
    await cleanupOldAuditLogs();
    expect(store.rows).toHaveLength(1);
    store.cleanupFailure = undefined;
    await cleanupOldAuditLogs();
    expect(store.rows).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
