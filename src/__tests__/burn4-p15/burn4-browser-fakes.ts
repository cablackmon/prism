export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

export function response(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    json: jest.fn().mockResolvedValue(data),
  };
}

/** Install a strict local fetch fake and restore its original descriptor afterward. */
export function installFetch(fetch: jest.Mock) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'fetch', previous);
    else Reflect.deleteProperty(globalThis, 'fetch');
  };
}

export function browserTimezone(zone = 'Etc/UTC') {
  const resolvedOptions = jest.fn(() => ({ timeZone: zone }));
  const formatter = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() =>
    ({ resolvedOptions }) as unknown as Intl.DateTimeFormat);
  return { formatter, resolvedOptions };
}
