import { TextDecoder, TextEncoder } from 'node:util';
Object.assign(globalThis, { TextDecoder, TextEncoder });
Object.defineProperty(globalThis, 'fetch', {
  configurable: true, writable: true,
  value: jest.fn(async () => { throw new Error('Offline test requires an explicit fetch fake.'); }),
});
beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true, writable: true,
    value: jest.fn(async () => { throw new Error('Offline test requires an explicit fetch fake.'); }),
  });
});
