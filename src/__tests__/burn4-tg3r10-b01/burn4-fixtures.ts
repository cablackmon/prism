export const firstId = '10000000-0000-0000-0000-000000000001';
export const secondId = '20000000-0000-0000-0000-000000000002';

export function recipe(id = firstId, name = 'Sample soup') {
  return { id, name, description: 'Warm soup', ingredients: [{ heading: 'Soup' }, { text: '2 cups water' }], instructions: 'Boil.\nServe.', prepTime: 0, cookTime: 10, servings: 2, cuisine: 'Home', category: 'Dinner' };
}

export function response(value: unknown, status = 200): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: {
      cancel: jest.fn(async () => undefined),
      getReader: () => ({
        read: async () => sent ? { done: true } : (sent = true, { done: false, value: bytes }),
        cancel: jest.fn(async () => { sent = true; }),
        releaseLock: jest.fn(),
      }),
    },
  } as unknown as Response;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
