/** @jest-environment node */
import {
  parseRecipeId, parseReaderRecipe, parseReaderIndex, recipeReaderUrl,
  readRecipeJson, loadReaderIndex, loadReaderRecipe,
} from '../../lib/burn4-recipe-reader';
import { firstId, recipe, response, secondId } from './burn4-fixtures';

const signal = () => new AbortController().signal;

describe('recipe projection and link boundaries', () => {
  test.each([null, undefined, 1, '', '../recipes', firstId + '?x=1', firstId + '\n', 'x'.repeat(10000)])('rejects invalid id %p', (id) => {
    expect(parseRecipeId(id)).toBeNull();
  });
  test('normalizes a complete hexadecimal identifier', () => {
    const id = 'ABCDEF01-1234-5678-ABCD-EF0123456789';
    expect(parseRecipeId(id)).toBe(id.toLowerCase());
  });
  test('projects only recipe display data and preserves order and text', () => {
    const original = { ...recipe(), notes: 'Private note', createdByName: 'Internal author', imageUrl: '/image', extra: 123 };
    expect(parseReaderRecipe(original, firstId)).toEqual(recipe());
    expect(original).toHaveProperty('notes');
  });
  test('supports absent optional fields, empty ingredient list and decimal serving values', () => {
    expect(parseReaderRecipe({ id: firstId, name: 'Toast', ingredients: [], servings: 1.5 }, firstId))
      .toMatchObject({ description: null, instructions: null, ingredients: [], servings: 1.5, prepTime: null });
  });
  test('renders valid structured ingredients without changing their amount or unit strings', () => {
    const value = { ...recipe(), ingredients: [{ name: 'flour', amount: '1/2', unit: 'cup', notes: 'sifted' }, { name: 'salt' }] };
    expect(parseReaderRecipe(value, firstId).ingredients).toEqual([{ text: '1/2 cup flour (sifted)' }, { text: 'salt' }]);
  });
  test.each([
    null, [], {}, { ...recipe(), id: secondId }, { ...recipe(), name: '' },
    { ...recipe(), description: 'x'.repeat(20001) }, { ...recipe(), instructions: 'x'.repeat(200001) },
    { ...recipe(), ingredients: undefined }, { ...recipe(), ingredients: Array(501).fill({ text: 'x' }) },
    { ...recipe(), ingredients: [null] }, { ...recipe(), ingredients: [{ amount: '2' }] },
    { ...recipe(), ingredients: [{ heading: 2 }] }, { ...recipe(), ingredients: [{ text: 'x'.repeat(4001) }] },
    { ...recipe(), prepTime: -1 }, { ...recipe(), cookTime: Infinity }, { ...recipe(), servings: '2' },
    { ...recipe(), category: {} },
  ])('rejects malformed recipe %p', (value) => expect(() => parseReaderRecipe(value, firstId)).toThrow());
  test('accepts bounded field values exactly at their limits', () => {
    expect(parseReaderRecipe({ ...recipe(), name: 'x'.repeat(500), prepTime: 100000, ingredients: Array(500).fill({ text: 'x'.repeat(4000) }) }, firstId).ingredients).toHaveLength(500);
  });
  test('projects recipe-list names only', () => {
    expect(parseReaderIndex({ recipes: [recipe()], total: 2, offset: 0, limit: 100 })).toEqual({ recipes: [{ id: firstId, name: 'Sample soup' }], total: 2 });
  });
  test.each([null, {}, { recipes: {}, total: 0 }, { recipes: [], total: -1 }, { recipes: [], total: 1.5 }, { recipes: [recipe()], total: 0 }, { recipes: [recipe(), recipe()], total: 2 }, { recipes: [{ id: 'bad', name: 'Bad' }], total: 1 }, { recipes: Array(101).fill(recipe()), total: 101 }])('rejects invalid list %p', (value) => expect(() => parseReaderIndex(value)).toThrow());
  test('creates a canonical same-installation link without unrelated query or fragment', () => {
    expect(recipeReaderUrl('https://prism.test/other?private=unused#fragment', firstId)).toBe(`https://prism.test/recipes/read?id=${firstId}`);
  });
  test.each(['javascript:alert(1)', 'file:///tmp/example', 'not an origin'])('rejects unsupported link origin %s', (origin) => expect(() => recipeReaderUrl(origin, firstId)).toThrow());
  test('rejects invalid link identity', () => expect(() => recipeReaderUrl('http://prism.test', '../bad')).toThrow());
});

describe('offline bounded response and GET contracts', () => {
  afterEach(() => jest.restoreAllMocks());
  test('reads a JSON response through the body stream', async () => {
    await expect(readRecipeJson(response({ text: 'Café' }), signal())).resolves.toEqual({ text: 'Café' });
  });
  test('rejects an advertised oversize body and cancels it before reading', async () => {
    const res = response({});
    jest.spyOn(res.headers, 'get').mockReturnValue('1048577');
    await expect(readRecipeJson(res, signal())).rejects.toThrow('too large');
    expect(res.body!.cancel).toHaveBeenCalledTimes(1);
  });
  test('rejects an empty body', async () => {
    await expect(readRecipeJson({ ...response({}), body: null } as Response, signal())).rejects.toThrow('empty');
  });
  test.each(['not json', '\u007b'])('rejects invalid JSON %s', async (value) => {
    await expect(readRecipeJson(new Response(value), signal())).rejects.toThrow('not valid JSON');
  });
  test('rejects invalid UTF-8 instead of corrupting recipe text', async () => {
    await expect(readRecipeJson(new Response(new Uint8Array([0xff])), signal())).rejects.toThrow('not valid JSON');
  });
  test('enforces the streamed byte limit without a content-length header', async () => {
    await expect(readRecipeJson(new Response('x'.repeat(1048577)), signal())).rejects.toThrow('too large');
  });
  test('stops an already aborted read', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readRecipeJson(response({}), controller.signal)).rejects.toHaveProperty('name', 'AbortError');
  });
  test('cancels an in-progress body read on abort', async () => {
    const controller = new AbortController();
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({ pull() { reads++; } });
    const promise = readRecipeJson(new Response(stream), controller.signal);
    controller.abort();
    await expect(promise).rejects.toHaveProperty('name', 'AbortError');
    expect(reads).toBeLessThanOrEqual(1);
  });
  test('loads index using a bounded same-origin GET and projects it', async () => {
    const mock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ recipes: [recipe()], total: 101 }));
    const abort = signal();
    await expect(loadReaderIndex(100, abort)).resolves.toMatchObject({ total: 101 });
    expect(mock).toHaveBeenCalledWith('/api/recipes?limit=100&offset=100', { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: abort, redirect: 'error' });
  });
  test.each([-1, 0.5, 100001, NaN])('rejects invalid index offset %p before fetch', async (offset) => {
    const mock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Must not run'));
    await expect(loadReaderIndex(offset, signal())).rejects.toThrow('page is invalid');
    expect(mock).not.toHaveBeenCalled();
  });
  test('loads detail through its encoded canonical identity', async () => {
    const mock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(recipe()));
    await expect(loadReaderRecipe(firstId, signal())).resolves.toEqual(recipe());
    expect(mock.mock.calls[0]![0]).toBe(`/api/recipes/${firstId}`);
  });
  test('rejects invalid detail identity before a request', async () => {
    const mock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Must not run'));
    await expect(loadReaderRecipe('../bad', signal())).rejects.toThrow('link is invalid');
    expect(mock).not.toHaveBeenCalled();
  });
  test.each([[401, 'Sign in'], [403, 'cannot read'], [404, 'not found'], [500, 'Try again']])('honors status %i without exposing server response details', async (status, message) => {
    const res = response({ error: 'Internal detail' }, status as number);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(res);
    await expect(loadReaderRecipe(firstId, signal())).rejects.toThrow(message as string);
    expect(res.body!.cancel).toHaveBeenCalledTimes(1);
  });
  test('maps transport failures to a bounded public error', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Internal detail'));
    await expect(loadReaderIndex(0, signal())).rejects.toThrow('Could not load recipes. Try again.');
  });
  test('preserves abort identity after transport failure', async () => {
    const controller = new AbortController(); controller.abort();
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Transport stopped'));
    await expect(loadReaderIndex(0, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
  });
  test('rejects a wrong-identity response from the HTTP detail boundary', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(recipe(secondId)));
    await expect(loadReaderRecipe(firstId, signal())).rejects.toThrow('identity does not match');
  });
  test('propagates stream read errors and releases the reader lock', async () => {
    const cancel = jest.fn(async () => undefined);
    const releaseLock = jest.fn();
    const res = { ...response({}), body: { getReader: () => ({ read: async () => { throw new Error('stream failed'); }, cancel, releaseLock }) } } as unknown as Response;
    await expect(readRecipeJson(res, signal())).rejects.toThrow('stream failed');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});
