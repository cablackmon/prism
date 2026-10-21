import {
  fetchMealieMealPlan,
  fetchMealieRecipeBySlug,
  fetchMealieRecipes,
  normalizeMealieRecipe,
  testMealieConnection,
  UnsafeUrlError,
  type MealieRecipeDetail,
} from '@/lib/integrations/mealie';
import { safeFetch, validatePublicUrl } from '@/lib/utils/safeFetch';

jest.mock('@/lib/utils/safeFetch', () => {
  const actual = jest.requireActual<typeof import('@/lib/utils/safeFetch')>('@/lib/utils/safeFetch');
  return {
    UnsafeUrlError: actual.UnsafeUrlError,
    safeFetch: jest.fn(),
    // Explicit options avoid reading deployment configuration or environment values.
    validatePublicUrl: jest.fn((url: string) => actual.validatePublicUrl(url, {
      isProduction: true,
      allowedInternalHosts: [],
    })),
  };
});

const mockFetch = jest.mocked(safeFetch);
const mockValidate = jest.mocked(validatePublicUrl);
const BASE = 'https://mealie.invalid';
const FIXTURE_AUTH = 'fixture-only';
const headers = { Authorization: `Bearer ${FIXTURE_AUTH}`, Accept: 'application/json' };

function response(payload: unknown, status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function recipe(overrides: Partial<MealieRecipeDetail> = {}): MealieRecipeDetail {
  return { id: 'recipe-1', slug: 'vegetable-soup', name: 'Vegetable soup', ...overrides };
}

beforeEach(() => {
  mockFetch.mockReset().mockRejectedValue(new Error('Unexpected mocked request'));
  mockValidate.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Mealie connection and URL boundary', () => {
  test('normalizes the base URL and checks the authenticated user without reading a response body', async () => {
    const res = response({ unused: true });
    mockFetch.mockResolvedValue(res);
    await expect(testMealieConnection(`  ${BASE}///  `, FIXTURE_AUTH)).resolves.toEqual({ ok: true });
    expect(mockValidate).toHaveBeenCalledWith(`  ${BASE}///  `);
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/users/self`, { headers });
    expect(res.json).not.toHaveBeenCalled();
  });

  test.each([401, 403])('reports authentication rejection for HTTP %s', async (status) => {
    mockFetch.mockResolvedValue(response(null, status, 'Denied'));
    await expect(testMealieConnection(BASE, FIXTURE_AUTH)).rejects.toThrow(/rejected the API token/);
  });

  test('reports HTTP status details and preserves transport failures', async () => {
    mockFetch.mockResolvedValueOnce(response(null, 503, 'Unavailable'));
    await expect(testMealieConnection(BASE, FIXTURE_AUTH)).rejects.toThrow('503 Unavailable');
    const failure = new Error('fixture network failure');
    mockFetch.mockRejectedValueOnce(failure);
    await expect(testMealieConnection(BASE, FIXTURE_AUTH)).rejects.toBe(failure);
  });

  test.each([
    ['connection', (url: string) => testMealieConnection(url, FIXTURE_AUTH)],
    ['recipe collection', (url: string) => fetchMealieRecipes(url, FIXTURE_AUTH)],
    ['single recipe', (url: string) => fetchMealieRecipeBySlug(url, FIXTURE_AUTH, 'soup')],
    ['meal plan', (url: string) => fetchMealieMealPlan(url, FIXTURE_AUTH)],
  ])('%s rejects a private host before requesting anything', async (_name, call) => {
    await expect(call('http://169.254.169.254/')).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  test.each(['file:///etc/hosts', 'http://[::1]/', 'not a URL'])('rejects unsafe URL %s', async (url) => {
    await expect(fetchMealieRecipes(url, FIXTURE_AUTH)).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('re-exports the URL safety error so callers can recognize validation failures', () => {
    const actual = jest.requireActual<typeof import('@/lib/utils/safeFetch')>('@/lib/utils/safeFetch');
    const error = new UnsafeUrlError('fixture rejection');
    expect(error).toBeInstanceOf(actual.UnsafeUrlError);
    expect(error.name).toBe('UnsafeUrlError');
  });
});

describe('Mealie recipe mapping', () => {
  test('maps rich recipe fields, headings, instruction titles and image URLs without changing provider data', () => {
    const detail = recipe({
      description: '  A warm lunch  ', orgURL: '  https://recipes.invalid/soup  ',
      updatedAt: '2026-10-20T12:30:00Z', image: 'image-cache-key', recipeServings: 3.6,
      prepTime: '1 hour 15 min', performTime: 'PT1H30M',
      recipeIngredient: [
        { title: '  Soup  ', display: '  2 carrots  ', originalText: 'ignored duplicate' },
        { originalText: '  1 cup broth  ' }, { title: '   ', display: '   ' },
      ],
      recipeInstructions: [
        { title: '  Prepare  ', text: '  Chop vegetables.  ' },
        { text: '  Simmer gently.  ' }, { title: 'No text', text: '   ' },
      ],
      tags: [{ name: '  lunch  ' }, { name: null }, { name: ' ' }, { name: 'soup' }],
    });
    const original = JSON.parse(JSON.stringify(detail)) as MealieRecipeDetail;
    Object.freeze(detail.recipeIngredient?.[0]);
    Object.freeze(detail.recipeIngredient);
    Object.freeze(detail.recipeInstructions);
    Object.freeze(detail.tags);
    Object.freeze(detail);

    expect(normalizeMealieRecipe(detail, BASE)).toEqual({
      externalId: 'recipe-1', externalUpdatedAt: new Date('2026-10-20T12:30:00Z'),
      name: 'Vegetable soup', description: 'A warm lunch', url: 'https://recipes.invalid/soup',
      ingredients: [{ heading: 'Soup' }, { text: '2 carrots' }, { text: '1 cup broth' }],
      instructions: 'Prepare\nChop vegetables.\n\nSimmer gently.',
      prepTime: 75, cookTime: 90, servings: 4, tags: ['lunch', 'soup'],
      remoteImageUrl: `${BASE}/api/media/recipes/recipe-1/images/original.webp`,
    });
    expect(detail).toEqual(original);
  });

  test('uses stable recipe links and null defaults when optional fields are absent', () => {
    expect(normalizeMealieRecipe(recipe({ description: ' ', orgURL: ' ' }), BASE)).toEqual({
      externalId: 'recipe-1', externalUpdatedAt: null, name: 'Vegetable soup', description: null,
      url: `${BASE}/g/home/r/vegetable-soup`, ingredients: [], instructions: null,
      prepTime: null, cookTime: null, servings: null, tags: [], remoteImageUrl: null,
    });
  });

  test.each([
    ['PT45M', 45], ['2 hours', 120], ['35 minutes', 35], ['90', 90],
    ['unknown', null], ['', null],
  ])('normalizes supported duration %s through the public mapper', (prepTime, minutes) => {
    expect(normalizeMealieRecipe(recipe({ prepTime }), BASE).prepTime).toBe(minutes);
  });

  test('uses total time as cooking time only when both split durations are unavailable', () => {
    expect(normalizeMealieRecipe(recipe({ totalTime: 'PT50M' }), BASE)).toMatchObject({ prepTime: null, cookTime: 50 });
    expect(normalizeMealieRecipe(recipe({ prepTime: '10 min', totalTime: 'PT50M' }), BASE)).toMatchObject({ prepTime: 10, cookTime: null });
    expect(normalizeMealieRecipe(recipe({ performTime: '0 min', totalTime: 'PT50M' }), BASE).cookTime).toBe(0);
  });

  test.each([null, 0, -2])('does not invent servings for provider value %s', (recipeServings) => {
    expect(normalizeMealieRecipe(recipe({ recipeServings }), BASE).servings).toBeNull();
  });

  test.failing('KNOWN GAP: invalid provider updatedAt becomes an Invalid Date instead of a missing timestamp', () => {
    expect(normalizeMealieRecipe(recipe({ updatedAt: 'not-a-date' }), BASE).externalUpdatedAt).toBeNull();
  });

  test.failing('KNOWN GAP: ISO durations containing only seconds are interpreted as minutes', () => {
    expect(normalizeMealieRecipe(recipe({ prepTime: 'PT120S' }), BASE).prepTime).toBe(2);
  });
});

describe('Mealie recipe retrieval', () => {
  test('pages by local page number, encodes slugs and skips failed or unnamed details', async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({ slug: index === 0 ? 'soup / spicy?' : '' }));
    mockFetch
      .mockResolvedValueOnce(response({ items: first, next: 'https://untrusted.invalid/ignored' }))
      .mockResolvedValueOnce(response({ items: [{ slug: 'broken' }, { slug: 'unnamed' }, { slug: 'rice' }] }))
      .mockResolvedValueOnce(response(recipe()))
      .mockResolvedValueOnce(response(null, 500, 'Provider failure'))
      .mockResolvedValueOnce(response({ name: '' }))
      .mockResolvedValueOnce(response(recipe({ id: 'recipe-2', name: 'Rice' })));

    const result = await fetchMealieRecipes(` ${BASE}/// `, FIXTURE_AUTH);
    expect(result.total).toBe(4);
    expect(result.recipes.map((item) => item.name)).toEqual(['Vegetable soup', 'Rice']);
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/api/recipes?page=1&perPage=50`, `${BASE}/api/recipes?page=2&perPage=50`,
      `${BASE}/api/recipes/soup%20%2F%20spicy%3F`, `${BASE}/api/recipes/broken`,
      `${BASE}/api/recipes/unnamed`, `${BASE}/api/recipes/rice`,
    ]);
    expect(mockFetch.mock.calls.every(([, init]) => JSON.stringify(init) === JSON.stringify({ headers }))).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('[mealie] skipping recipe broken:', expect.stringContaining('500 Provider failure'));
  });

  test.each([
    { items: [{ slug: 'one' }], next: '/api/recipes?page=2' },
    { items: Array.from({ length: 50 }, () => ({ slug: '' })), next: null },
    {},
  ])('stops when a page is short or has no next link', async (page) => {
    mockFetch.mockResolvedValueOnce(response(page)).mockResolvedValue(response(recipe()));
    await fetchMealieRecipes(BASE, FIXTURE_AUTH);
    expect(mockFetch.mock.calls.filter(([url]) => url.includes('?page='))).toHaveLength(1);
  });

  test('caps recipes at 1000 even when a provider keeps returning full pages', async () => {
    mockFetch.mockImplementation(async (url) => {
      const page = new URL(url).searchParams.get('page');
      return page
        ? response({ items: Array.from({ length: 50 }, (_, index) => ({ slug: `${page}-${index}` })), next: '/more' })
        : response(recipe({ id: url.split('/').at(-1)! }));
    });
    const result = await fetchMealieRecipes(BASE, FIXTURE_AUTH);
    expect(result.total).toBe(1000);
    expect(result.recipes).toHaveLength(1000);
    expect(mockFetch.mock.calls.filter(([url]) => url.includes('?page='))).toHaveLength(20);
    expect(mockFetch).toHaveBeenCalledTimes(1020);
  });

  test('guards endless pages with no usable slugs at 200 requests', async () => {
    mockFetch.mockResolvedValue(response({ items: Array.from({ length: 50 }, () => ({})), next: '/more' }));
    await expect(fetchMealieRecipes(BASE, FIXTURE_AUTH)).resolves.toEqual({ recipes: [], total: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(200);
  });

  test('fails the collection on a list HTTP or JSON failure before loading details', async () => {
    mockFetch.mockResolvedValueOnce(response(null, 502, 'Bad Gateway'));
    await expect(fetchMealieRecipes(BASE, FIXTURE_AUTH)).rejects.toThrow('Failed to list Mealie recipes: 502 Bad Gateway');
    const malformed = response(null);
    const failure = new SyntaxError('fixture invalid JSON');
    jest.mocked(malformed.json).mockRejectedValue(failure);
    mockFetch.mockResolvedValueOnce(malformed);
    await expect(fetchMealieRecipes(BASE, FIXTURE_AUTH)).rejects.toBe(failure);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('skips a malformed detail and continues the collection', async () => {
    mockFetch.mockResolvedValueOnce(response({ items: [{ slug: 'bad' }, { slug: 'good' }] }))
      .mockResolvedValueOnce(response(recipe({ tags: [null] } as unknown as Partial<MealieRecipeDetail>)))
      .mockResolvedValueOnce(response(recipe()));
    const result = await fetchMealieRecipes(BASE, FIXTURE_AUTH);
    expect(result.total).toBe(2);
    expect(result.recipes).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith('[mealie] skipping recipe bad:', expect.any(String));
  });

  test('fetches and normalizes a single encoded slug', async () => {
    mockFetch.mockResolvedValue(response(recipe({ prepTime: '15 min' })));
    await expect(fetchMealieRecipeBySlug(`${BASE}/`, FIXTURE_AUTH, 'soup?#/')).resolves.toMatchObject({ name: 'Vegetable soup', prepTime: 15 });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/recipes/soup%3F%23%2F`, { headers });
    expect(mockValidate).toHaveBeenCalledWith(`${BASE}/`);
  });

  test.each([null, { name: '' }])('returns null for an absent or unnamed single detail', async (detail) => {
    mockFetch.mockResolvedValue(response(detail));
    await expect(fetchMealieRecipeBySlug(BASE, FIXTURE_AUTH, 'missing')).resolves.toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  test('returns null and records HTTP, JSON, and transport single-detail failures', async () => {
    const malformed = response(null);
    jest.mocked(malformed.json).mockRejectedValue(new SyntaxError('invalid JSON'));
    mockFetch.mockResolvedValueOnce(response(null, 404, 'Not Found'))
      .mockResolvedValueOnce(malformed).mockRejectedValueOnce(new Error('offline fixture'));
    for (let index = 0; index < 3; index += 1) {
      await expect(fetchMealieRecipeBySlug(BASE, FIXTURE_AUTH, 'broken')).resolves.toBeNull();
    }
    expect(console.error).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenNthCalledWith(1, '[mealie] failed to fetch recipe broken:', expect.stringContaining('404 Not Found'));
  });

  test.failing('KNOWN GAP: a null recipe-list row aborts the entire import instead of retaining valid rows', async () => {
    mockFetch.mockResolvedValueOnce(response({ items: [null, { slug: 'good' }] }))
      .mockResolvedValueOnce(response(recipe()));
    await expect(fetchMealieRecipes(BASE, FIXTURE_AUTH)).resolves.toMatchObject({ total: 1, recipes: [{ name: 'Vegetable soup' }] });
  });
});

describe('Mealie meal plans', () => {
  test('collects paginated plans while ignoring invalid rows and leaves valid entries unchanged', async () => {
    const entry = Object.freeze({ id: 7, date: '2026-10-21', entryType: 'dinner', title: 'Soup night', recipeId: 'recipe-1', recipe: { id: 'recipe-1', slug: 'soup' } });
    const first = [entry, ...Array.from({ length: 49 }, () => null)];
    mockFetch.mockResolvedValueOnce(response({ items: first, next: '/more' }))
      .mockResolvedValueOnce(response({ items: [null, { id: '8', date: '2026-10-22' }, { id: 8 }, { id: 9, date: '' }, { id: 10, date: '2026-10-23', text: 'Leftovers' }] }));
    const result = await fetchMealieMealPlan(` ${BASE}/// `, FIXTURE_AUTH);
    expect(result).toEqual([entry, { id: 10, date: '2026-10-23', text: 'Leftovers' }]);
    expect(result[0]).toBe(entry);
    expect(mockFetch).toHaveBeenNthCalledWith(1, `${BASE}/api/households/mealplans?page=1&perPage=50`, { headers });
    expect(mockFetch).toHaveBeenNthCalledWith(2, `${BASE}/api/households/mealplans?page=2&perPage=50`, { headers });
  });

  test('treats a missing items collection as an empty meal plan', async () => {
    mockFetch.mockResolvedValue(response({ total: 0 }));
    await expect(fetchMealieMealPlan(BASE, FIXTURE_AUTH)).resolves.toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('stops after a full page without a next link', async () => {
    mockFetch.mockResolvedValue(response({ items: Array.from({ length: 50 }, (_, id) => ({ id, date: '2026-10-21' })) }));
    await expect(fetchMealieMealPlan(BASE, FIXTURE_AUTH)).resolves.toHaveLength(50);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('caps meal-plan rows at 2000 even if the provider returns oversized pages', async () => {
    mockFetch.mockImplementation(async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      return response({ items: Array.from({ length: 60 }, (_, index) => ({ id: (page - 1) * 60 + index, date: '2026-10-21' })), next: '/more' });
    });
    const result = await fetchMealieMealPlan(BASE, FIXTURE_AUTH);
    expect(result).toHaveLength(2000);
    expect(result[1999]?.id).toBe(1999);
    expect(mockFetch).toHaveBeenCalledTimes(34);
  });

  test('guards an endless sequence of invalid full pages', async () => {
    mockFetch.mockResolvedValue(response({ items: Array.from({ length: 50 }, () => null), next: '/more' }));
    await expect(fetchMealieMealPlan(BASE, FIXTURE_AUTH)).resolves.toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(200);
  });

  test('propagates provider HTTP, transport and JSON errors', async () => {
    const failure = new Error('fixture transport error');
    const malformed = response(null);
    jest.mocked(malformed.json).mockRejectedValue(new SyntaxError('fixture invalid JSON'));
    mockFetch.mockResolvedValueOnce(response(null, 503, 'Unavailable'))
      .mockRejectedValueOnce(failure).mockResolvedValueOnce(malformed);
    await expect(fetchMealieMealPlan(BASE, FIXTURE_AUTH)).rejects.toThrow('Failed to list Mealie meal plan: 503 Unavailable');
    await expect(fetchMealieMealPlan(BASE, FIXTURE_AUTH)).rejects.toBe(failure);
    await expect(fetchMealieMealPlan(BASE, FIXTURE_AUTH)).rejects.toThrow('fixture invalid JSON');
  });
});
