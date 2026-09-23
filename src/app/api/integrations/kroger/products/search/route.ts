/**
 * POST /api/integrations/kroger/products/search
 *
 * Body: { items: [{ id: shoppingItemId, query: string, cachedProductId?: string }] }
 *
 * For each shopping item, returns up to 5 Kroger product candidates. If a
 * cachedProductId is supplied, it's surfaced as the pre-selected default —
 * but we still search to catch the case where the cached SKU no longer
 * exists (rare; Kroger discontinues items).
 *
 * Returns: { results: [{ id, query, candidates: KrogerProductCandidate[], preselectedProductId?: string }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getUserTokens } from '@/lib/integrations/kroger/tokens';
import { searchProducts } from '@/lib/integrations/kroger/client';
import { rateLimitGuard } from '@/lib/cache/rateLimit';
import { logError } from '@/lib/utils/logError';

interface SearchItem {
  id: string;
  query: string;
  cachedProductId?: string | null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = await rateLimitGuard(auth.userId, 'kroger-search', 30, 60);
  if (limited) return limited;

  try {
    const body = (await request.json()) as { items?: SearchItem[] };
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ results: [] });
    }
    if (items.length > 200) {
      return NextResponse.json({ error: 'Too many items (max 200 per request)' }, { status: 400 });
    }

    const tokens = await getUserTokens(auth.userId);
    if (!tokens) {
      return NextResponse.json(
        { error: 'Not connected to Kroger', code: 'KROGER_NOT_CONNECTED' },
        { status: 401 }
      );
    }

    // Fire searches in parallel — Kroger's public tier allows ~10k calls/day
    // which is far more headroom than a single shopping trip needs.
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const candidates = await searchProducts(item.query, tokens, {
            locationId: tokens.preferredLocationId,
            limit: 5,
          });
          // If the user previously picked a SKU for this item and it still
          // shows up in the search results, surface it as the preselection.
          // Otherwise pre-select the first candidate.
          const preselectedProductId =
            item.cachedProductId && candidates.some((c) => c.productId === item.cachedProductId)
              ? item.cachedProductId
              : candidates[0]?.productId;
          return {
            id: item.id,
            query: item.query,
            candidates,
            preselectedProductId,
          };
        } catch (err) {
          logError(`Kroger search failed for "${item.query}":`, err);
          return {
            id: item.id,
            query: item.query,
            candidates: [],
            preselectedProductId: undefined,
          };
        }
      })
    );

    return NextResponse.json({ results });
  } catch (error) {
    logError('Error searching Kroger products:', error);
    return NextResponse.json({ error: 'Failed to search products' }, { status: 500 });
  }
}
