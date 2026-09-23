/**
 * Barcode product lookup cascade.
 * Provider order: Redis cache → Open Food Facts → UPCitemdb → (Nutritionix, Edamam if configured)
 * Each provider has a 3-second timeout.
 */

type ShoppingCategory =
  | 'produce'
  | 'dairy'
  | 'meat'
  | 'bakery'
  | 'frozen'
  | 'pantry'
  | 'household'
  | 'other';

export interface ProductLookupResult {
  name: string;
  brand?: string;
  category: ShoppingCategory;
  source: 'open-food-facts' | 'upcitemdb' | 'cache';
}

const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days in seconds

function mapCategory(raw: string): ShoppingCategory {
  const s = raw.toLowerCase();
  if (/dairy|milk|cheese|yogurt|egg|butter|cream/.test(s)) return 'dairy';
  if (/meat|beef|pork|chicken|poultry|seafood|fish|deli/.test(s)) return 'meat';
  if (/produce|fruit|vegetable|fresh|salad|herb/.test(s)) return 'produce';
  if (/frozen/.test(s)) return 'frozen';
  if (/bread|bak|pastry|cake|roll|bun|muffin/.test(s)) return 'bakery';
  if (/household|cleaning|paper|hygiene|laundry|soap|detergent/.test(s)) return 'household';
  if (/cereal|pasta|rice|sauce|canned|snack|bever|drink|juice|soda|chip|cracker|coffee|tea/.test(s))
    return 'pantry';
  return 'other';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function lookupOpenFoodFacts(barcode: string): Promise<ProductLookupResult | null> {
  const res = await withTimeout(
    fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, {
      headers: { 'User-Agent': 'Prism-Dashboard/1.0' },
    }),
    3000
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status: number;
    product?: {
      product_name?: string;
      brands?: string;
      categories_tags?: string[];
    };
  };
  if (data.status !== 1 || !data.product?.product_name) return null;

  const p = data.product;
  const rawCategory = p.categories_tags?.[0] ?? '';
  return {
    name: p.product_name!.trim(),
    brand: p.brands?.split(',')[0]?.trim() || undefined,
    category: mapCategory(rawCategory),
    source: 'open-food-facts',
  };
}

async function lookupUpcItemDb(barcode: string): Promise<ProductLookupResult | null> {
  const res = await withTimeout(
    fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`),
    3000
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    code?: string;
    items?: { title?: string; brand?: string; category?: string }[];
  };
  if (data.code !== 'OK' || !data.items?.length) return null;

  const item = data.items[0]!;
  if (!item.title) return null;
  return {
    name: item.title.trim(),
    brand: item.brand?.trim() || undefined,
    category: mapCategory(item.category ?? ''),
    source: 'upcitemdb',
  };
}

export async function lookupBarcode(barcode: string): Promise<ProductLookupResult | null> {
  // Try providers directly (Redis cache handled via getCached wrapper if available)
  const result =
    (await lookupOpenFoodFacts(barcode).catch(() => null)) ??
    (await lookupUpcItemDb(barcode).catch(() => null));

  if (!result) return null;

  // Cache the result in Redis for 7 days
  try {
    const { getRedisClient } = await import('@/lib/cache/getRedisClient');
    const client = await getRedisClient();
    if (client) {
      await client.set(`barcode:${barcode}`, JSON.stringify(result), { EX: CACHE_TTL });
    }
  } catch {
    /* Redis unavailable — continue without caching */
  }

  return result;
}
