import path from 'path';
import { saveRecipeImage, deleteRecipeImage, getRecipeImagePath } from '@/lib/services/recipe-image-storage';
import { assertSafePathId } from '@/lib/utils/safePathId';
import type { ImageStore } from './burn4-fakes';
import { deferred } from './burn4-fakes';

jest.mock('./burn4-image-store', () => {
  const { ImageStore } = jest.requireActual('./burn4-fakes') as typeof import('./burn4-fakes');
  return { store: new ImageStore() };
}, { virtual: true });
jest.mock('fs', () => ({ promises: jest.requireMock('./burn4-image-store').store.fs }));
jest.mock('sharp', () => ({ __esModule: true, default: jest.requireMock('./burn4-image-store').store.sharp }));
jest.mock('@/lib/utils/safePathId', () => ({ assertSafePathId: jest.fn() }));

const store = (jest.requireMock('./burn4-image-store') as { store: ImageStore }).store;
const mockGuard = jest.mocked(assertSafePathId);
const recipeId = '11111111-2222-4333-8444-555555555555';
const secondId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const directory = path.join(process.cwd(), 'data', 'recipe-images');
const filename = `${recipeId}.jpg`;
const target = path.join(directory, filename);

beforeEach(() => {
  store.reset();
  jest.clearAllMocks();
  mockGuard.mockReset();
});

test('saves through orientation, bounded resize, and JPEG encoding before persisting', async () => {
  const input = Buffer.from('synthetic image input');
  const original = Buffer.from(input);
  expect(await saveRecipeImage(input, recipeId)).toBe(filename);
  expect(mockGuard).toHaveBeenCalledWith(recipeId);
  expect(store.operations).toEqual([
    { name: 'mkdir', args: [directory, { recursive: true }] },
    { name: 'sharp', args: [input] },
    { name: 'rotate', args: [] },
    { name: 'resize', args: [1200, undefined, { fit: 'inside', withoutEnlargement: true }] },
    { name: 'jpeg', args: [{ quality: 85 }] },
    { name: 'toFile', args: [target] },
  ]);
  expect(store.files.get(target)).toEqual(Buffer.concat([Buffer.from('synthetic-jpeg:'), input]));
  expect(store.directories).toEqual(new Set([directory]));
  expect(input).toEqual(original);
});

test('waits for directory creation before invoking the decoder', async () => {
  const gate = deferred<void>();
  store.directoryGate = gate.promise;
  const saving = saveRecipeImage(Buffer.from('synthetic input'), recipeId);
  expect(store.sharp).not.toHaveBeenCalled();
  expect(store.files.size).toBe(0);
  gate.resolve();
  await expect(saving).resolves.toBe(filename);
  expect(store.sharp).toHaveBeenCalledTimes(1);
});

test('replaces only the requested recipe image and preserves neighboring images', async () => {
  const neighbor = path.join(directory, `${secondId}.jpg`);
  const neighborBytes = Buffer.from('neighbor');
  store.files.set(target, Buffer.from('previous image'));
  store.files.set(neighbor, neighborBytes);
  await saveRecipeImage(Buffer.from('replacement'), recipeId);
  expect(store.files.get(target)).toEqual(Buffer.from('synthetic-jpeg:replacement'));
  expect(store.files.get(neighbor)).toBe(neighborBytes);
  expect(store.files.size).toBe(2);
});

test('repeated saves return a stable public filename', async () => {
  await expect(saveRecipeImage(Buffer.from('first'), recipeId)).resolves.toBe(filename);
  await expect(saveRecipeImage(Buffer.from('second'), recipeId)).resolves.toBe(filename);
  expect(store.files.size).toBe(1);
  expect(store.files.get(target)).toEqual(Buffer.from('synthetic-jpeg:second'));
});

test('directory failures propagate before decode or image write', async () => {
  const error = Object.assign(new Error('Synthetic directory failure'), { code: 'EACCES' });
  store.mkdirError = error;
  await expect(saveRecipeImage(Buffer.from('input'), recipeId)).rejects.toBe(error);
  expect(store.sharp).not.toHaveBeenCalled();
  expect(store.files.size).toBe(0);
});

test('decoder failures propagate without creating an output file', async () => {
  const error = new Error('Synthetic unsupported image');
  store.transformError = error;
  await expect(saveRecipeImage(Buffer.from('not an image'), recipeId)).rejects.toBe(error);
  expect(store.operations.map((op) => op.name)).toEqual(['mkdir', 'sharp']);
  expect(store.files.size).toBe(0);
});

test('image write failures propagate without claiming a saved filename', async () => {
  const error = Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' });
  store.writeError = error;
  await expect(saveRecipeImage(Buffer.from('input'), recipeId)).rejects.toBe(error);
  expect(store.operations.at(-1)).toEqual({ name: 'toFile', args: [target] });
  expect(store.files.size).toBe(0);
});

test('getRecipeImagePath is deterministic and has no filesystem or transform effects', () => {
  expect(getRecipeImagePath(recipeId)).toBe(target);
  expect(getRecipeImagePath(secondId)).toBe(path.join(directory, `${secondId}.jpg`));
  expect(mockGuard.mock.calls).toEqual([[recipeId], [secondId]]);
  expect(store.operations).toEqual([]);
});

test('save forwards the raw candidate to the guard before filesystem access', async () => {
  const error = new Error('Synthetic invalid path id');
  mockGuard.mockImplementation(() => { throw error; });
  await expect(saveRecipeImage(Buffer.from('input'), '../outside')).rejects.toBe(error);
  expect(mockGuard).toHaveBeenCalledWith('../outside');
  expect(store.operations).toEqual([]);
});

test('delete does not suppress a path guard rejection', async () => {
  const error = new Error('Synthetic invalid path id');
  mockGuard.mockImplementation(() => { throw error; });
  await expect(deleteRecipeImage('../outside')).rejects.toBe(error);
  expect(mockGuard).toHaveBeenCalledWith('../outside');
  expect(store.operations).toEqual([]);
});

test('path lookup propagates a guard rejection before returning a path', () => {
  const error = new Error('Synthetic invalid path id');
  mockGuard.mockImplementation(() => { throw error; });
  expect(() => getRecipeImagePath('../outside')).toThrow(error);
  expect(mockGuard).toHaveBeenCalledWith('../outside');
  expect(store.operations).toEqual([]);
});

test('deletes the requested file while retaining a neighboring recipe', async () => {
  const neighbor = path.join(directory, `${secondId}.jpg`);
  store.files.set(target, Buffer.from('requested image'));
  store.files.set(neighbor, Buffer.from('neighbor image'));
  await expect(deleteRecipeImage(recipeId)).resolves.toBeUndefined();
  expect(mockGuard).toHaveBeenCalledWith(recipeId);
  expect(store.operations).toEqual([{ name: 'unlink', args: [target] }]);
  expect(store.files.has(target)).toBe(false);
  expect(store.files.get(neighbor)).toEqual(Buffer.from('neighbor image'));
});

test('deleting a missing file is idempotent without directory creation', async () => {
  await expect(deleteRecipeImage(recipeId)).resolves.toBeUndefined();
  await expect(deleteRecipeImage(recipeId)).resolves.toBeUndefined();
  expect(store.fs.unlink).toHaveBeenCalledTimes(2);
  expect(store.fs.mkdir).not.toHaveBeenCalled();
  expect(store.sharp).not.toHaveBeenCalled();
});

test.failing('KNOWN GAP: image deletion suppresses permission failures and leaves the file behind', async () => {
  const error = Object.assign(new Error('Synthetic permission denied'), { code: 'EACCES' });
  store.files.set(target, Buffer.from('existing image'));
  store.unlinkError = error;
  const deletion = deleteRecipeImage(recipeId);
  await deletion.catch(() => undefined);
  expect(store.fs.unlink).toHaveBeenCalledWith(target);
  expect(store.files.has(target)).toBe(true);
  await expect(deletion).rejects.toBe(error);
});
