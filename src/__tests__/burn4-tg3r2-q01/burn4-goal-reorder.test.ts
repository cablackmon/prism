import { NextRequest, NextResponse } from 'next/server';

type Auth = { userId: string; role: 'parent' | 'child' | 'guest'; scopes?: string[] };
type Goal = { priority: number; updatedAt: Date };
type Predicate = { column: unknown; id: string };
type Write = Goal & Predicate & { table: unknown };
type Transaction = {
  update: (table: unknown) => {
    set: (values: Goal) => { where: (predicate: Predicate) => Promise<void> };
  };
};

const mockRequireAuth = jest.fn<Promise<Auth | NextResponse>, []>();
const mockRequireRole = jest.fn<NextResponse | null, [Auth, string]>();
const mockInvalidateEntity = jest.fn<Promise<void>, [string]>();
const mockLogError = jest.fn<void, [string, unknown]>();
const mockTransaction = jest.fn<Promise<void>, [(tx: Transaction) => Promise<void>]>();

jest.mock('@/lib/auth', () => ({
  requireAuth: () => mockRequireAuth(),
  requireRole: (auth: Auth, permission: string) => mockRequireRole(auth, permission),
}));
jest.mock('@/lib/db/client', () => ({
  db: { transaction: (callback: (tx: Transaction) => Promise<void>) => mockTransaction(callback) },
}));
jest.mock('@/lib/db/schema', () => ({ goals: { id: 'goals.id' } }));
jest.mock('drizzle-orm', () => ({
  eq: (column: unknown, id: string): Predicate => ({ column, id }),
}));
jest.mock('@/lib/cache/cacheKeys', () => ({
  invalidateEntity: (entity: string) => mockInvalidateEntity(entity),
}));
jest.mock('@/lib/utils/logError', () => ({
  logError: (message: string, error: unknown) => mockLogError(message, error),
}));

import { POST } from '@/app/api/goals/reorder/route';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const C = '10000000-0000-4000-8000-000000000003';
const auth: Auth = { userId: 'offline-parent', role: 'parent' };
const clock = new Date('2026-10-21T12:00:00.000Z');
const initialTime = new Date('2026-01-01T00:00:00.000Z');
let rows: Map<string, Goal>;
let writes: Write[];
let events: string[];
let failWriteAt: number | undefined;
let writeError: Error;
let commitError: Error | undefined;
let beforeWrite: ((index: number) => Promise<void>) | undefined;

function request(body: unknown) {
  return new NextRequest('http://offline.invalid/api/goals/reorder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function priorities() {
  return [A, B, C].map((id) => rows.get(id)?.priority);
}

function expectNoMutation() {
  expect(mockTransaction).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
  expect(mockInvalidateEntity).not.toHaveBeenCalled();
  expect(priorities()).toEqual([10, 20, 30]);
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers({ now: clock });
  rows = new Map([A, B, C].map((id, index) => [id, {
    priority: (index + 1) * 10,
    updatedAt: initialTime,
  }]));
  writes = [];
  events = [];
  failWriteAt = undefined;
  beforeWrite = undefined;
  commitError = undefined;
  writeError = new Error('offline update failed');
  mockRequireAuth.mockResolvedValue(auth);
  mockRequireRole.mockReturnValue(null);
  mockInvalidateEntity.mockImplementation(async (entity) => {
    events.push(`invalidate:${entity}`);
  });
  mockTransaction.mockImplementation(async (callback) => {
    events.push('begin');
    const staged = new Map(rows);
    const tx: Transaction = {
      update: (table) => ({
        set: (values) => ({
          where: async (predicate) => {
            const index = writes.length + 1;
            writes.push({ ...values, ...predicate, table });
            events.push(`write:${index}:start`);
            await beforeWrite?.(index);
            if (index === failWriteAt) throw writeError;
            if (staged.has(predicate.id)) staged.set(predicate.id, values);
            events.push(`write:${index}:done`);
          },
        }),
      }),
    };
    try {
      await callback(tx);
      if (commitError) throw commitError;
      rows = staged;
      events.push('commit');
    } catch (error) {
      events.push('rollback');
      throw error;
    }
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('POST goal reorder authorization boundaries', () => {
  test.each([401, 503])('forwards an authentication %i without reading the request', async (status) => {
    const denial = NextResponse.json({ error: 'offline denial' }, { status });
    mockRequireAuth.mockResolvedValue(denial);
    const input = request({ order: [A] });
    const parse = jest.spyOn(input, 'json');

    expect(await POST(input)).toBe(denial);
    expect(parse).not.toHaveBeenCalled();
    expect(mockRequireRole).not.toHaveBeenCalled();
    expectNoMutation();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('requests canManageGoals authorization before parsing and forwards the denial', async () => {
    const deniedAuth: Auth = { userId: 'offline-child', role: 'child' };
    const denial = NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    mockRequireAuth.mockResolvedValue(deniedAuth);
    mockRequireRole.mockReturnValue(denial);
    const input = request({ order: [A] });
    const parse = jest.spyOn(input, 'json');

    expect(await POST(input)).toBe(denial);
    expect(mockRequireRole).toHaveBeenCalledTimes(1);
    expect(mockRequireRole).toHaveBeenCalledWith(deniedAuth, 'canManageGoals');
    expect(parse).not.toHaveBeenCalled();
    expectNoMutation();
  });

  test('propagates authentication service rejection before entering mutation handling', async () => {
    const failure = new Error('offline auth unavailable');
    mockRequireAuth.mockRejectedValue(failure);
    const input = request({ order: [A] });
    const parse = jest.spyOn(input, 'json');

    await expect(POST(input)).rejects.toBe(failure);
    expect(parse).not.toHaveBeenCalled();
    expect(mockRequireRole).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
    expectNoMutation();
  });
});

describe('POST goal reorder real request validation', () => {
  test.each([
    ['missing order', {}, ['order']],
    ['empty order', { order: [] }, ['order']],
    ['scalar order', { order: A }, ['order']],
    ['invalid UUID', { order: ['not-a-uuid'] }, ['order', 0]],
    ['numeric UUID', { order: [17] }, ['order', 0]],
    ['null UUID', { order: [null] }, ['order', 0]],
    ['late invalid UUID', { order: [A, 'bad'] }, ['order', 1]],
    ['null body', null, []],
    ['array body', [A], []],
  ])('rejects %s before a transaction starts', async (_label, body, path) => {
    const response = await POST(request(body));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path }),
    ]));
    expectNoMutation();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('ignores extra request fields rather than applying supplied database values', async () => {
    const response = await POST(request({
      order: [A], priority: 999, updatedAt: '1900-01-01', unrelated: true,
    }));

    expect(response.status).toBe(200);
    expect(rows.get(A)).toEqual({ priority: 1, updatedAt: clock });
    expect(writes).toEqual([{
      table: { id: 'goals.id' }, column: 'goals.id', id: A, priority: 1, updatedAt: clock,
    }]);
    expect(mockInvalidateEntity).toHaveBeenCalledTimes(1);
    expect(mockInvalidateEntity).toHaveBeenCalledWith('goals');
  });

  test('returns a controlled server error if request decoding fails unexpectedly', async () => {
    const input = request({ order: [A] });
    const failure = new Error('offline request stream failed');
    jest.spyOn(input, 'json').mockRejectedValue(failure);

    const response = await POST(input);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to reorder goals' });
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith('Error reordering goals:', failure);
    expectNoMutation();
  });

  test.failing('KNOWN GAP: malformed JSON is reported as a server error instead of a client error', async () => {
    const input = new NextRequest('http://offline.invalid/api/goals/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"order":',
    });
    const response = await POST(input);

    expectNoMutation();
    expect(response.status).toBe(400);
  });

  test.failing('KNOWN GAP: duplicate goal IDs are accepted and overwrite an earlier priority', async () => {
    const response = await POST(request({ order: [A, B, A] }));

    // This body is JSON and UUID-valid; rejection must come from uniqueness validation.
    // Accepting it writes A twice, loses priority 1, and leaves A at priority 3.
    expect({ status: response.status, priorities: priorities() }).toEqual({
      status: 400, priorities: [10, 20, 30],
    });
    expectNoMutation();
  });
});

describe('POST goal reorder transaction and cache sequencing', () => {
  test('writes requested one-based priorities with a shared timestamp inside one transaction', async () => {
    const response = await POST(request({ order: [C, A, B] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'Goals reordered' });
    expect(mockRequireRole).toHaveBeenCalledTimes(1);
    expect(mockRequireRole).toHaveBeenCalledWith(auth, 'canManageGoals');
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([C, A, B].map((id, index) => ({
      table: { id: 'goals.id' }, column: 'goals.id', id,
      priority: index + 1, updatedAt: clock,
    })));
    expect(writes[0]?.updatedAt).toBe(writes[1]?.updatedAt);
    expect(writes[1]?.updatedAt).toBe(writes[2]?.updatedAt);
    expect(priorities()).toEqual([2, 3, 1]);
    expect(events).toEqual([
      'begin', 'write:1:start', 'write:1:done', 'write:2:start', 'write:2:done',
      'write:3:start', 'write:3:done', 'commit', 'invalidate:goals',
    ]);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('leaves omitted goals untouched when reordering a subset', async () => {
    const response = await POST(request({ order: [B] }));

    expect(response.status).toBe(200);
    expect(priorities()).toEqual([10, 1, 30]);
    expect(rows.get(A)?.updatedAt).toBe(initialTime);
    expect(rows.get(C)?.updatedAt).toBe(initialTime);
    expect(writes.map(({ id }) => id)).toEqual([B]);
  });

  test('awaits each update before beginning the next and invalidates only after commit', async () => {
    const started = deferred();
    const resume = deferred();
    beforeWrite = async (index) => {
      if (index === 1) {
        started.release();
        await resume.promise;
      }
    };
    const pending = POST(request({ order: [B, A] }));
    await started.promise;

    expect(writes.map(({ id }) => id)).toEqual([B]);
    expect(events).toEqual(['begin', 'write:1:start']);
    expect(priorities()).toEqual([10, 20, 30]);
    expect(mockInvalidateEntity).not.toHaveBeenCalled();

    resume.release();
    const response = await pending;

    expect(response.status).toBe(200);
    expect(priorities()).toEqual([2, 1, 30]);
    expect(events.slice(-2)).toEqual(['commit', 'invalidate:goals']);
  });

  test('waits for cache invalidation before returning the success response', async () => {
    const started = deferred();
    const resume = deferred();
    let returned = false;
    mockInvalidateEntity.mockImplementation(async () => {
      started.release();
      await resume.promise;
    });
    const pending = POST(request({ order: [B, A] })).then((response) => {
      returned = true;
      return response;
    });
    await started.promise;

    expect(events.at(-1)).toBe('commit');
    expect(priorities()).toEqual([2, 1, 30]);
    expect(returned).toBe(false);

    resume.release();
    expect((await pending).status).toBe(200);
    expect(returned).toBe(true);
  });

  test.each([1, 2, 3])('stops at failed update %i and never invalidates rolled-back changes', async (index) => {
    failWriteAt = index;
    const response = await POST(request({ order: [C, B, A] }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to reorder goals' });
    expect(writes.map(({ id }) => id)).toEqual([C, B, A].slice(0, index));
    expect(priorities()).toEqual([10, 20, 30]);
    expect(events.at(-1)).toBe('rollback');
    expect(events).not.toContain('commit');
    expect(mockInvalidateEntity).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith('Error reordering goals:', writeError);
  });

  test('handles a transaction startup failure without applying updates', async () => {
    const failure = new Error('offline transaction unavailable');
    mockTransaction.mockRejectedValue(failure);

    const response = await POST(request({ order: [A] }));

    expect(response.status).toBe(500);
    expect(writes).toEqual([]);
    expect(priorities()).toEqual([10, 20, 30]);
    expect(mockInvalidateEntity).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith('Error reordering goals:', failure);
  });

  test('does not invalidate when transaction commit rejects after all updates', async () => {
    const failure = new Error('offline commit failed');
    commitError = failure;

    const response = await POST(request({ order: [B, A] }));

    expect(response.status).toBe(500);
    expect(writes).toHaveLength(2);
    expect(priorities()).toEqual([10, 20, 30]);
    expect(events.at(-1)).toBe('rollback');
    expect(mockInvalidateEntity).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith('Error reordering goals:', failure);
  });

  test('reports cache failure after commit without pretending that the database rolled back', async () => {
    const failure = new Error('offline cache unavailable');
    mockInvalidateEntity.mockRejectedValue(failure);

    const response = await POST(request({ order: [C, A] }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to reorder goals' });
    expect(priorities()).toEqual([2, 20, 1]);
    expect(events.at(-1)).toBe('commit');
    expect(events).not.toContain('rollback');
    expect(mockInvalidateEntity).toHaveBeenCalledTimes(1);
    expect(mockInvalidateEntity).toHaveBeenCalledWith('goals');
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith('Error reordering goals:', failure);
  });
});
