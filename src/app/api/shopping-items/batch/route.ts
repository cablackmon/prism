import { randomUUID } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { auditLogs, shoppingItems, shoppingLists } from '@/lib/db/schema';
import { rateLimitGuard } from '@/lib/cache/rateLimit';
import { invalidateEntity } from '@/lib/cache/cacheKeys';

const maximumBodyBytes = 512 * 1024;
const quantitySchema = z.number().int().positive().max(2147483647);
// PostgreSQL text cannot store NUL; lone surrogates cannot round-trip as UTF-8.
const databaseText = (maximum: number) => z.string().max(maximum)
  .refine(value => !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value));
const itemSchema = z.object({
  name: databaseText(255).refine(name => name.trim().length > 0),
  quantity: quantitySchema.optional(),
  unit: databaseText(50).optional(),
  category: databaseText(50).optional(),
  notes: databaseText(500).optional(),
}).strict();
const batchSchema = z.object({
  listId: z.string().uuid().transform(id => id.toLowerCase()),
  items: z.array(itemSchema).min(1).max(200),
}).strict();
const returnedItemSchema = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  name: z.string(),
  quantity: quantitySchema.nullable(),
  unit: z.string().nullable(),
  category: z.string().nullable(),
  checked: z.literal(false),
  recurring: z.literal(false),
  recurrenceInterval: z.null(),
  notes: z.string().nullable(),
  createdAt: z.date(),
}).strict();

class RequestBodyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
class MissingListError extends Error {}

async function readBody(request: NextRequest): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError(400, 'Invalid JSON body');
  const bytes = new Uint8Array(maximumBodyBytes);
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBodyBytes) {
        // Cancellation must not delay the response if transport cleanup stalls.
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyError(413, 'Request body exceeds 512 KiB');
      }
      bytes.set(chunk.value, size - chunk.value.byteLength);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, 'Invalid JSON body');
  } finally {
    reader.releaseLock();
  }
}

/**
 * Create 1 through 200 prepared shopping items with one atomic audit-backed write.
 * A 201 response always means the items committed, including cache warnings.
 * Replaying a request creates new items; callers must not retry a 201 response.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const authorized = auth.scopes !== undefined
      ? auth.scopes.includes('*')
      : auth.role === 'parent' || auth.role === 'child';
    if (!authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const limited = await rateLimitGuard(auth.userId, 'shopping-item-batches', 30, 60);
    if (limited) return limited;

    const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
    }
    const validation = batchSchema.safeParse(await readBody(request));
    if (!validation.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: validation.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
      }, { status: 400 });
    }
    const { listId, items } = validation.data;
    const createdItems = await db.transaction(async tx => {
      const [list] = await tx.select({ id: shoppingLists.id }).from(shoppingLists)
        .where(eq(shoppingLists.id, listId)).limit(1).for('key share');
      if (!list) throw new MissingListError();

      // Explicit record IDs let the response preserve input order independently
      // of the database's RETURNING order. These IDs are ordinary item identities.
      const rows = items.map(item => ({
        id: randomUUID(),
        listId,
        name: item.name,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        category: item.category ?? null,
        notes: item.notes ?? null,
        addedBy: auth.userId,
        checked: false,
        recurring: false,
        recurrenceInterval: null,
      }));
      const returned = await tx.insert(shoppingItems).values(rows).returning({
        id: shoppingItems.id,
        listId: shoppingItems.listId,
        name: shoppingItems.name,
        quantity: shoppingItems.quantity,
        unit: shoppingItems.unit,
        category: shoppingItems.category,
        checked: shoppingItems.checked,
        recurring: shoppingItems.recurring,
        recurrenceInterval: shoppingItems.recurrenceInterval,
        notes: shoppingItems.notes,
        createdAt: shoppingItems.createdAt,
      });
      const parsed = z.array(returnedItemSchema).length(rows.length).parse(returned);
      const byId = new Map(parsed.map(row => [row.id, row]));
      if (byId.size !== rows.length) throw new Error('Invalid returned item identities');
      const formatted = rows.map(expected => {
        const row = byId.get(expected.id);
        if (!row || row.listId !== listId || row.name !== expected.name ||
          row.quantity !== expected.quantity || row.unit !== expected.unit ||
          row.category !== expected.category || row.notes !== expected.notes) {
          throw new Error('Invalid returned shopping item');
        }
        return { ...row, createdAt: row.createdAt.toISOString() };
      });
      await tx.insert(auditLogs).values(formatted.map(item => ({
        userId: auth.userId,
        action: 'create',
        entityType: 'shopping_item',
        entityId: item.id,
        summary: 'Added shopping item in batch',
      })));
      return formatted;
    });

    try {
      await invalidateEntity('shopping-lists');
    } catch {
      return NextResponse.json({
        items: createdItems,
        count: createdItems.length,
        warnings: [{
          code: 'CACHE_INVALIDATION_FAILED',
          message: 'Items were saved. Refresh the list. Do not resubmit this batch.',
        }],
      }, { status: 201 });
    }
    return NextResponse.json({ items: createdItems, count: createdItems.length }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof MissingListError) {
      return NextResponse.json({ error: 'Shopping list not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to create shopping item batch' }, { status: 500 });
  }
}
