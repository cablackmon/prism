import { NextResponse } from 'next/server';
import { getDisplayAuth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shoppingItems, shoppingLists } from '@/lib/db/schema';
import { eq, and, ilike, isNull, or, asc } from 'drizzle-orm';
import { invalidateEntity } from '@/lib/cache/cacheKeys';
import { lookupBarcode } from '@/lib/integrations/product-lookup';

async function getSetting(key: string): Promise<unknown> {
  try {
    const { settings } = await import('@/lib/db/schema');
    const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function resolveTargetList(defaultListId: string | null): Promise<string | null> {
  if (defaultListId) {
    const list = await db.query.shoppingLists.findFirst({
      where: eq(shoppingLists.id, defaultListId),
    });
    if (list) return list.id;
  }
  const all = await db
    .select({ id: shoppingLists.id, name: shoppingLists.name })
    .from(shoppingLists)
    .orderBy(asc(shoppingLists.sortOrder));
  const groceries = all.find((l) => l.name.toLowerCase().includes('groceries'));
  return groceries?.id ?? all[0]?.id ?? null;
}

export async function POST(req: Request) {
  const auth = await getDisplayAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await req.json()) as {
      barcode?: string;
      listId?: string;
      category?: string;
      dryRun?: boolean;
    };
    const barcode = body.barcode?.trim();
    const requestedListId = body.listId?.trim() || null;

    if (!barcode) return NextResponse.json({ error: 'barcode is required' }, { status: 400 });
    if (!/^[a-zA-Z0-9-]{1,20}$/.test(barcode)) {
      return NextResponse.json({ error: 'invalid barcode' }, { status: 400 });
    }

    const scannerEnabled = await getSetting('scanner.enabled');
    if (scannerEnabled === false) {
      return NextResponse.json({ error: 'Scanner is disabled' }, { status: 403 });
    }

    const product = await lookupBarcode(barcode);
    if (!product) {
      return NextResponse.json({ found: false, barcode });
    }

    // dryRun: return product info + cross-list duplicate check without writing anything
    if (body.dryRun) {
      const existingRows = await db
        .select({
          itemId: shoppingItems.id,
          listId: shoppingItems.listId,
          listName: shoppingLists.name,
        })
        .from(shoppingItems)
        .innerJoin(shoppingLists, eq(shoppingItems.listId, shoppingLists.id))
        .where(
          and(
            ilike(shoppingItems.name, product.name),
            or(eq(shoppingItems.checked, false), isNull(shoppingItems.checked))
          )
        );

      return NextResponse.json({
        found: true,
        product: { name: product.name, brand: product.brand, suggestedCategory: product.category },
        existingInLists: existingRows.map((r) => ({
          listId: r.listId,
          listName: r.listName,
          itemId: r.itemId,
        })),
      });
    }

    // Actual add
    const defaultListId =
      requestedListId ?? ((await getSetting('scanner.defaultListId')) as string | null);
    const listId = await resolveTargetList(defaultListId);
    if (!listId) return NextResponse.json({ error: 'No shopping list found' }, { status: 500 });

    const categoryToUse = body.category ?? product.category ?? null;

    // Duplicate check within the target list
    const existing = await db
      .select({ id: shoppingItems.id })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.listId, listId),
          ilike(shoppingItems.name, product.name),
          or(eq(shoppingItems.checked, false), isNull(shoppingItems.checked))
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(shoppingItems)
        .set({ source: 'scan' })
        .where(eq(shoppingItems.id, existing[0]!.id));
      await invalidateEntity('shopping-lists');
      return NextResponse.json({
        found: true,
        item: { name: product.name, brand: product.brand, category: categoryToUse },
        action: 'updated_existing',
        listId,
        itemId: existing[0]!.id,
      });
    }

    const [newItem] = await db
      .insert(shoppingItems)
      .values({
        listId,
        name: product.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        category: categoryToUse as any,
        source: 'scan',
        notes: product.brand ?? null,
      })
      .returning({ id: shoppingItems.id });

    await invalidateEntity('shopping-lists');
    return NextResponse.json({
      found: true,
      item: { name: product.name, brand: product.brand, category: categoryToUse },
      action: 'added',
      listId,
      itemId: newItem!.id,
    });
  } catch (err) {
    console.error('Scan route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
