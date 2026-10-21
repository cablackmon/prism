import { lookupBarcode } from '@/lib/integrations/product-lookup';
import { getRedisClient } from '@/lib/cache/getRedisClient';

jest.mock('@/lib/cache/getRedisClient', () => ({ getRedisClient: jest.fn() }));

const mockRedis = jest.mocked(getRedisClient);
const mockSet = jest.fn();
const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
const BARCODE = '0123456789012';
const OFF_URL = `https://world.openfoodfacts.org/api/v0/product/${BARCODE}.json`;
const UPC_URL = `https://api.upcitemdb.com/prod/trial/lookup?upc=${BARCODE}`;

function response(payload: unknown, ok = true): Response {
  return { ok, json: jest.fn().mockResolvedValue(payload) } as unknown as Response;
}

function offProduct(overrides: Record<string, unknown> = {}): Response {
  return response({ status: 1, product: { product_name: '  Oat cereal  ', brands: '  Farm Brand , Other Brand', categories_tags: ['en:breakfast-cereal'], ...overrides } });
}

function upcProduct(overrides: Record<string, unknown> = {}): Response {
  return response({ code: 'OK', items: [{ title: '  Laundry soap  ', brand: '  Clean Brand  ', category: 'Household > Laundry', ...overrides }] });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset().mockRejectedValue(new Error('Unexpected mocked request'));
  jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);
  mockSet.mockReset().mockResolvedValue('OK');
  mockRedis.mockReset().mockResolvedValue({ set: mockSet } as unknown as NonNullable<Awaited<ReturnType<typeof getRedisClient>>>);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('barcode provider cascade', () => {
  test('prefers Open Food Facts, trims the first brand and caches the normalized result for seven days', async () => {
    mockFetch.mockResolvedValueOnce(offProduct());
    const result = { name: 'Oat cereal', brand: 'Farm Brand', category: 'pantry', source: 'open-food-facts' };
    await expect(lookupBarcode(BARCODE)).resolves.toEqual(result);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(OFF_URL, { headers: { 'User-Agent': 'Prism-Dashboard/1.0' } });
    expect(mockRedis).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(`barcode:${BARCODE}`, JSON.stringify(result), { EX: 604800 });
  });

  test.each([
    ['HTTP rejection', () => response(null, false)],
    ['not found status', () => response({ status: 0 })],
    ['missing product', () => response({ status: 1 })],
    ['missing product name', () => response({ status: 1, product: { brands: 'Fixture' } })],
    ['malformed category type', () => offProduct({ categories_tags: [123] })],
  ])('falls back to UPCitemdb after Open Food Facts %s', async (_reason, firstResponse) => {
    mockFetch.mockResolvedValueOnce(firstResponse()).mockResolvedValueOnce(upcProduct());
    const result = { name: 'Laundry soap', brand: 'Clean Brand', category: 'household', source: 'upcitemdb' };
    await expect(lookupBarcode(BARCODE)).resolves.toEqual(result);
    expect(mockFetch).toHaveBeenNthCalledWith(1, OFF_URL, expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, UPC_URL);
    expect(mockSet).toHaveBeenCalledWith(`barcode:${BARCODE}`, JSON.stringify(result), { EX: 604800 });
  });

  test('falls back after provider fetch rejection or invalid JSON', async () => {
    const malformed = response(null);
    jest.mocked(malformed.json).mockRejectedValue(new SyntaxError('fixture invalid JSON'));
    mockFetch.mockRejectedValueOnce(new Error('fixture connection failure')).mockResolvedValueOnce(upcProduct())
      .mockResolvedValueOnce(malformed).mockResolvedValueOnce(upcProduct());
    await expect(lookupBarcode(BARCODE)).resolves.toMatchObject({ source: 'upcitemdb' });
    await expect(lookupBarcode(BARCODE)).resolves.toMatchObject({ source: 'upcitemdb' });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  test.each([
    ['HTTP rejection', () => response(null, false)],
    ['non-OK code', () => response({ code: 'INVALID_QUERY', items: [{ title: 'Ignore' }] })],
    ['missing items', () => response({ code: 'OK' })],
    ['empty items', () => response({ code: 'OK', items: [] })],
    ['untitled item', () => response({ code: 'OK', items: [{ brand: 'Fixture' }] })],
    ['null first item', () => response({ code: 'OK', items: [null] })],
  ])('returns null without contacting Redis after both providers miss, including UPC %s', async (_reason, secondResponse) => {
    mockFetch.mockResolvedValueOnce(response({ status: 0 })).mockResolvedValueOnce(secondResponse());
    await expect(lookupBarcode(BARCODE)).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockRedis).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('returns null after UPC network or JSON failures', async () => {
    const malformed = response(null);
    jest.mocked(malformed.json).mockRejectedValue(new SyntaxError('fixture invalid JSON'));
    mockFetch.mockResolvedValueOnce(response({ status: 0 })).mockRejectedValueOnce(new Error('fixture offline'))
      .mockResolvedValueOnce(response({ status: 0 })).mockResolvedValueOnce(malformed);
    await expect(lookupBarcode(BARCODE)).resolves.toBeNull();
    await expect(lookupBarcode(BARCODE)).resolves.toBeNull();
    expect(mockRedis).not.toHaveBeenCalled();
  });

  test('falls back at the Open Food Facts fetch deadline and ignores a late response', async () => {
    let resolveFirst!: (value: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(upcProduct());
    const pending = lookupBarcode(BARCODE);
    await jest.advanceTimersByTimeAsync(2999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ source: 'upcitemdb' });
    resolveFirst(offProduct());
    await Promise.resolve();
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSet.mock.calls[0]![1] as string).source).toBe('upcitemdb');
  });

  test('returns null when both fetches time out and does not attempt a cache write', async () => {
    mockFetch.mockImplementation(() => new Promise<Response>(() => undefined));
    const pending = lookupBarcode(BARCODE);
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBeNull();
    expect(mockRedis).not.toHaveBeenCalled();
  });

  test('preserves a successful provider result when Redis is absent, rejects connection, or rejects a write', async () => {
    mockFetch.mockImplementation(async () => offProduct());
    mockRedis.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('fixture cache unavailable'));
    mockSet.mockRejectedValueOnce(new Error('fixture write failure'));
    for (let index = 0; index < 3; index += 1) {
      await expect(lookupBarcode(BARCODE)).resolves.toMatchObject({ name: 'Oat cereal', source: 'open-food-facts' });
    }
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  test('omits blank optional brands and uses other for unrecognized categories', async () => {
    mockFetch.mockResolvedValueOnce(offProduct({ brands: ' ', categories_tags: undefined }))
      .mockResolvedValueOnce(response({ status: 0 })).mockResolvedValueOnce(upcProduct({ brand: ' ', category: undefined }));
    await expect(lookupBarcode(BARCODE)).resolves.toEqual({ name: 'Oat cereal', brand: undefined, category: 'other', source: 'open-food-facts' });
    await expect(lookupBarcode(BARCODE)).resolves.toEqual({ name: 'Laundry soap', brand: undefined, category: 'other', source: 'upcitemdb' });
  });

  test.each([
    ['en:yogurt', 'dairy'], ['en:seafood', 'meat'], ['en:vegetables', 'produce'],
    ['en:frozen-desserts', 'frozen'], ['en:bread', 'bakery'],
    ['en:cleaning', 'household'], ['en:canned-food', 'pantry'], ['en:unknown', 'other'],
  ])('maps provider category %s to shopping category %s', async (raw, category) => {
    mockFetch.mockResolvedValueOnce(offProduct({ categories_tags: [raw] }));
    await expect(lookupBarcode(BARCODE)).resolves.toMatchObject({ category });
  });

  test.failing('KNOWN GAP: a whitespace-only Open Food Facts name prevents fallback to a usable UPC product', async () => {
    mockFetch.mockResolvedValueOnce(offProduct({ product_name: '   ' })).mockResolvedValueOnce(upcProduct());
    await expect(lookupBarcode(BARCODE)).resolves.toMatchObject({ name: 'Laundry soap', source: 'upcitemdb' });
  });

  test.failing('KNOWN GAP: only the first Open Food Facts category is considered even when a later tag identifies dairy', async () => {
    mockFetch.mockResolvedValueOnce(offProduct({ categories_tags: ['en:foods', 'en:milk'] }));
    await expect(lookupBarcode(BARCODE)).resolves.toMatchObject({ category: 'dairy' });
  });

  test.failing('KNOWN GAP: completed provider requests leave their three-second timeout timers pending', async () => {
    mockFetch.mockResolvedValueOnce(offProduct());
    await expect(lookupBarcode(BARCODE)).resolves.toMatchObject({ source: 'open-food-facts' });
    expect(jest.getTimerCount()).toBe(0);
  });

  test.failing('KNOWN GAP: a stalled response body bypasses the provider timeout and blocks fallback', async () => {
    const stalled = response(null);
    jest.mocked(stalled.json).mockImplementation(() => new Promise(() => undefined));
    mockFetch.mockResolvedValueOnce(stalled).mockResolvedValueOnce(upcProduct());
    const pending = lookupBarcode(BARCODE);
    let result: unknown;
    let completed = false;
    void pending.then((value) => { result = value; completed = true; });
    await jest.advanceTimersByTimeAsync(3001);
    expect(completed).toBe(true);
    expect(result).toMatchObject({ name: 'Laundry soap', source: 'upcitemdb' });
  });
});
