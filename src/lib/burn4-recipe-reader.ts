const MAX_BYTES = 1024 * 1024;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReaderRecipe {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  ingredients: Array<{ heading: string } | { text: string }>;
  prepTime: number | null;
  cookTime: number | null;
  servings: number | null;
  cuisine: string | null;
  category: string | null;
}

export interface ReaderIndex {
  recipes: Array<{ id: string; name: string }>;
  total: number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Recipe data has an invalid shape.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, limit: number, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new Error('Recipe text is missing or too long.');
  }
  return value;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) {
    throw new Error('Recipe timing or servings is invalid.');
  }
  return value;
}

export function parseRecipeId(value: unknown): string | null {
  return typeof value === 'string' && value.length === 36 && ID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function parseReaderRecipe(value: unknown, expectedId: string): ReaderRecipe {
  const row = record(value);
  const id = parseRecipeId(row.id);
  if (!id || id !== parseRecipeId(expectedId)) throw new Error('Recipe identity does not match this link.');
  if (!Array.isArray(row.ingredients) || row.ingredients.length > 500) {
    throw new Error('Recipe ingredients are invalid or too numerous.');
  }
  const ingredients = row.ingredients.map((value) => {
    const ingredient = record(value);
    if (ingredient.heading !== undefined && ingredient.heading !== null && ingredient.heading !== '') {
      return { heading: text(ingredient.heading, 2000)! };
    }
    if (ingredient.text !== undefined && ingredient.text !== null && ingredient.text !== '') {
      return { text: text(ingredient.text, 4000)! };
    }
    const name = text(ingredient.name, 2000)!;
    const amount = text(ingredient.amount, 200, true);
    const unit = text(ingredient.unit, 200, true);
    const notes = text(ingredient.notes, 1000, true);
    return { text: [amount, unit, name].filter(Boolean).join(' ') + (notes ? ` (${notes})` : '') };
  });
  return {
    id,
    name: text(row.name, 500)!,
    description: text(row.description, 20000, true),
    instructions: text(row.instructions, 200000, true),
    ingredients,
    prepTime: numeric(row.prepTime),
    cookTime: numeric(row.cookTime),
    servings: numeric(row.servings),
    cuisine: text(row.cuisine, 500, true),
    category: text(row.category, 500, true),
  };
}

export function parseReaderIndex(value: unknown): ReaderIndex {
  const row = record(value);
  if (!Array.isArray(row.recipes) || row.recipes.length > 100 ||
      typeof row.total !== 'number' || !Number.isSafeInteger(row.total) || row.total < 0 ||
      row.total < row.recipes.length) throw new Error('Recipe list is invalid.');
  const seen = new Set<string>();
  const recipes = row.recipes.map((value) => {
    const recipe = record(value);
    const id = parseRecipeId(recipe.id);
    if (!id || seen.has(id)) throw new Error('Recipe list contains an invalid or repeated identity.');
    seen.add(id);
    return { id, name: text(recipe.name, 500)! };
  });
  return { recipes, total: row.total };
}

export function recipeReaderUrl(origin: string, id: string): string {
  const parsedId = parseRecipeId(id);
  const url = new URL(origin);
  if (!parsedId || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Cannot create this recipe link.');
  }
  return `${url.origin}/recipes/read?id=${parsedId}`;
}

export async function readRecipeJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Recipe response is too large.');
  }
  if (!response.body) throw new Error('Recipe response is empty.');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Recipe response is too large.');
      }
      parts.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new Error('Recipe response is not valid JSON.'); }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal, redirect: 'error' }); }
  catch { signal.throwIfAborted(); throw new Error('Could not load recipes. Try again.'); }
  signal.throwIfAborted();
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401) throw new Error('Sign in to Prism to read this recipe.');
    if (response.status === 403) throw new Error('Your session cannot read this recipe.');
    if (response.status === 404) throw new Error('Recipe not found.');
    throw new Error('Could not load recipes. Try again.');
  }
  return readRecipeJson(response, signal);
}

export async function loadReaderIndex(offset: number, signal: AbortSignal): Promise<ReaderIndex> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error('Recipe page is invalid.');
  return parseReaderIndex(await getJson(`/api/recipes?limit=100&offset=${offset}`, signal));
}

export async function loadReaderRecipe(id: string, signal: AbortSignal): Promise<ReaderRecipe> {
  const parsedId = parseRecipeId(id);
  if (!parsedId) throw new Error('This recipe link is invalid.');
  return parseReaderRecipe(await getJson(`/api/recipes/${parsedId}`, signal), parsedId);
}
