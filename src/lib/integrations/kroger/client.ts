/**
 * Kroger API client.
 *
 * Wraps the public Kroger Developer API for product search and cart writes.
 * Auth: OAuth 2.0 Authorization Code flow. Each Prism user holds their own
 * access + refresh tokens (see user_kroger_connections).
 *
 * Docs: https://developer.kroger.com/reference
 * - Products API:  GET /v1/products?filter.term=&filter.locationId=&filter.limit=
 * - Cart API:      PUT /v1/cart/add  (body: { items: [{ upc, quantity }] })
 *
 * The Cart API takes Kroger UPCs (the inner `items[].upc` field on products),
 * not the productId. We surface both — UI shows productId for caching,
 * client.addToCart() resolves UPCs from productIds.
 */

import { getKrogerCredentials } from '@/lib/integrations/credentialStore';

const KROGER_API_BASE = 'https://api.kroger.com/v1';
const KROGER_AUTH_BASE = 'https://api.kroger.com/v1/connect/oauth2';

export interface KrogerTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export interface KrogerLocation {
  locationId: string;
  chain: string;
  name: string;
  address: {
    addressLine1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  phone?: string;
}

interface KrogerLocationRaw {
  locationId: string;
  chain: string;
  name: string;
  address?: {
    addressLine1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  phone?: string;
}

interface KrogerLocationsResponse {
  data: KrogerLocationRaw[];
}

export interface KrogerProductCandidate {
  productId: string;
  upc: string;
  brand?: string;
  description: string;
  size?: string;
  imageUrl?: string;
  price?: number;
  /** Price as displayed — Kroger sometimes returns no price for items not
   *  sold at the queried location. */
  priceDisplay?: string;
}

interface KrogerProductImage {
  perspective: string;
  sizes: Array<{ size: string; url: string }>;
}

interface KrogerProductPrice {
  regular: number;
  promo?: number;
}

interface KrogerProductItem {
  itemId: string;
  upc?: string;
  size?: string;
  price?: KrogerProductPrice;
}

interface KrogerProductRaw {
  productId: string;
  upc?: string;
  brand?: string;
  description: string;
  images?: KrogerProductImage[];
  items?: KrogerProductItem[];
}

interface KrogerProductsResponse {
  data: KrogerProductRaw[];
}

interface KrogerTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/**
 * Pull the front-of-shelf image (perspective="front") at "medium" size if
 * available, falling back through perspectives and sizes.
 */
function pickImage(images?: KrogerProductImage[]): string | undefined {
  if (!images?.length) return undefined;
  const front = images.find((i) => i.perspective === 'front') ?? images[0]!;
  const medium = front.sizes.find((s) => s.size === 'medium') ?? front.sizes[0];
  return medium?.url;
}

function normalizeProduct(raw: KrogerProductRaw): KrogerProductCandidate {
  const first = raw.items?.[0];
  const price = first?.price?.promo ?? first?.price?.regular;
  return {
    productId: raw.productId,
    upc: first?.upc ?? raw.upc ?? raw.productId,
    brand: raw.brand,
    description: raw.description,
    size: first?.size,
    imageUrl: pickImage(raw.images),
    price,
    priceDisplay: price != null ? `$${price.toFixed(2)}` : undefined,
  };
}

/**
 * Search for products. Returns up to `limit` candidates ranked by Kroger's
 * default relevance order.
 */
export async function searchProducts(
  query: string,
  tokens: KrogerTokens,
  options: { locationId?: string | null; limit?: number } = {}
): Promise<KrogerProductCandidate[]> {
  const { locationId, limit = 5 } = options;

  const params = new URLSearchParams({
    'filter.term': query,
    'filter.limit': String(Math.min(Math.max(limit, 1), 50)),
  });
  if (locationId) params.set('filter.locationId', locationId);

  const res = await fetch(`${KROGER_API_BASE}/products?${params.toString()}`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kroger products search failed: ${res.status} ${text}`);
  }

  const data: KrogerProductsResponse = await res.json();
  return data.data.map(normalizeProduct);
}

/**
 * Search Kroger banner locations near a zip code. Used by the store picker
 * so Mariano's customers can pin their preferred store for location-aware
 * pricing and stock.
 *
 * Pass chain="MARIANOS" for Mariano's only; omit it to include all banners.
 */
export async function searchLocations(
  zipCode: string,
  tokens: KrogerTokens,
  options: { chain?: string; radiusInMiles?: number; limit?: number } = {}
): Promise<KrogerLocation[]> {
  const { chain, radiusInMiles = 10, limit = 10 } = options;

  const params = new URLSearchParams({
    'filter.zipCode.near': zipCode,
    'filter.radiusInMiles': String(radiusInMiles),
    'filter.limit': String(Math.min(Math.max(limit, 1), 50)),
  });
  if (chain) params.set('filter.chain', chain);

  const res = await fetch(`${KROGER_API_BASE}/locations?${params.toString()}`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kroger locations search failed: ${res.status} ${text}`);
  }

  const data: KrogerLocationsResponse = await res.json();
  return data.data.map((l) => ({
    locationId: l.locationId,
    chain: l.chain,
    name: l.name,
    address: l.address ?? {},
    phone: l.phone,
  }));
}

/**
 * Add UPCs to the authenticated user's online cart. Kroger requires UPCs
 * (the inner items[].upc), not the productId, so callers must resolve those
 * via searchProducts first.
 *
 * Returns nothing on success — the API responds 204 No Content.
 */
export async function addToCart(
  items: Array<{ upc: string; quantity?: number }>,
  tokens: KrogerTokens
): Promise<void> {
  if (items.length === 0) return;

  const body = {
    items: items.map((i) => ({
      upc: i.upc,
      quantity: i.quantity ?? 1,
      modality: 'PICKUP' as const,
    })),
  };

  const res = await fetch(`${KROGER_API_BASE}/cart/add`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kroger cart/add failed: ${res.status} ${text}`);
  }
}

/**
 * Exchange a refresh token for a new access token.
 * Returns null if the refresh fails (caller should force the user to
 * re-authenticate).
 */
export async function refreshTokens(refreshToken: string): Promise<KrogerTokens | null> {
  const creds = await getKrogerCredentials();
  if (!creds) return null;

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');

  const res = await fetch(`${KROGER_AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) return null;

  const data: KrogerTokenResponse = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Exchange an authorization code for tokens during the OAuth callback.
 *
 * `redirectUri` must match the one passed to /authorize — Kroger validates
 * exact-string equality. Pass the value from `resolveKrogerRedirectUri`.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<KrogerTokens> {
  const creds = await getKrogerCredentials();
  if (!creds) throw new Error('Kroger OAuth not configured');

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');

  const res = await fetch(`${KROGER_AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kroger token exchange failed: ${res.status} ${text}`);
  }

  const data: KrogerTokenResponse = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Build the consent screen URL. Kroger requires explicit user opt-in for
 * the cart.basic:write scope.
 *
 * `redirectUri` is the host-specific URI the user will land back on after
 * consent; it must be one of the URIs the user registered with Kroger.
 */
export async function buildAuthorizeUrl(
  state: string,
  redirectUri: string
): Promise<string | null> {
  const creds = await getKrogerCredentials();
  if (!creds) return null;

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'product.compact cart.basic:write profile.compact',
    state,
  });

  return `${KROGER_AUTH_BASE}/authorize?${params.toString()}`;
}
