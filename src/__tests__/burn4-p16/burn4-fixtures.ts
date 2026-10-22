import type { IntegrationStatus } from '@/app/settings/sections/integrations/shared/useIntegrationStatus';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function response(data: unknown, ok = true) {
  return {
    ok, status: ok ? 200 : 503,
    json: jest.fn<Promise<unknown>, []>().mockResolvedValue(data),
  } as unknown as Response & { json: jest.Mock<Promise<unknown>, []> };
}

export function integrationStatus(account = 'primary'): IntegrationStatus {
  return {
    google: {
      connected: true, expired: false, calendarCount: 2, taskSourceCount: 1,
      lastSynced: '2026-10-21T12:30:00.000Z', accountEmail: `${account}@example.invalid`,
      accountEmails: [`${account}@example.invalid`, 'second@example.invalid'],
    },
    microsoft: {
      connected: true, taskSourceCount: 3, shoppingSourceCount: 1,
      accountEmail: 'microsoft@example.invalid', accountEmails: ['microsoft@example.invalid'],
    },
    onedrive: {
      connected: false, sourceCount: 0, accountEmail: null, accountEmails: [],
    },
    gmail: { connected: true, accountEmail: 'gmail@example.invalid' },
  };
}

export const krogerLifecycle = { mount: jest.fn(), unmount: jest.fn() };
