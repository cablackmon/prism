import { act } from '@testing-library/react';

export function response(body: unknown, ok = true): Response {
  return { ok, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
