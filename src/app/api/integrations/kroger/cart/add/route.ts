/**
 * POST /api/integrations/kroger/cart/add
 *
 * Body: { selections: [{ shoppingItemId: string, productId: string, upc: string, quantity?: number }] }
 *
 * Pushes the selected UPCs into the user's Kroger cart and caches the chosen
 * productId on each shopping item for the "remember last pick" UX.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getUserTokens } from '@/lib/integrations/kroger/tokens';
import { addToCart } from '@/lib/integrations/kroger/client';
import { db } from '@/lib/db/client';
import { shoppingItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rateLimitGuard } from '@/lib/cache/rateLimit';
import { logError } from '@/lib/utils/logError';

interface Selection {
  shoppingItemId: string;
  productId: string;
  upc: string;
  quantity?: number;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = await rateLimitGuard(auth.userId, 'kroger-cart-add', 10, 60);
  if (limited) return limited;

  try {
    const body = (await request.json()) as { selections?: Selection[] };
    const selections = Array.isArray(body.selections) ? body.selections : [];
    if (selections.length === 0) {
      return NextResponse.json({ error: 'No selections provided' }, { status: 400 });
    }

    const tokens = await getUserTokens(auth.userId);
    if (!tokens) {
      return NextResponse.json(
        { error: 'Not connected to Kroger', code: 'KROGER_NOT_CONNECTED' },
        { status: 401 }
      );
    }

    await addToCart(
      selections.map((s) => ({ upc: s.upc, quantity: s.quantity ?? 1 })),
      tokens
    );

    // Cache the chosen productId on each shopping item so the next send
    // pre-selects the same SKU.
    await Promise.all(
      selections.map((s) =>
        db
          .update(shoppingItems)
          .set({ krogerProductId: s.productId, updatedAt: new Date() })
          .where(eq(shoppingItems.id, s.shoppingItemId))
      )
    );

    return NextResponse.json({ ok: true, count: selections.length });
  } catch (error) {
    logError('Error adding to Kroger cart:', error);
    return NextResponse.json({ error: 'Failed to add items to Kroger cart' }, { status: 500 });
  }
}
