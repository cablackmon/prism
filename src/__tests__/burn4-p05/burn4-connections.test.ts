import { NextResponse } from 'next/server';
import { getDisplayAuth, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getGoogleCredentials, getMicrosoftCredentials, getKrogerCredentials } from '@/lib/integrations/credentialStore';
import { deleteUserTokens } from '@/lib/integrations/kroger/tokens';
import { logError } from '@/lib/utils/logError';
import { GET as oauthStatus } from '@/app/api/integrations/oauth-status/route';
import { GET as krogerStatus } from '@/app/api/integrations/kroger/status/route';
import { POST as disconnectKroger } from '@/app/api/integrations/kroger/disconnect/route';
import { type DatabaseFake } from './burn4-fixtures';

jest.mock('next/server', () => ({
  NextResponse: class OfflineNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new this(JSON.stringify(body), {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
    }
  },
}));
jest.mock('@/lib/auth', () => ({ getDisplayAuth: jest.fn(), requireAuth: jest.fn() }));
jest.mock('@/lib/db/client', () => ({ db: jest.requireActual('./burn4-fixtures').createDatabaseFake() }));
jest.mock('@/lib/db/schema', () => jest.requireActual('./burn4-fixtures').fakeSchema);
jest.mock('drizzle-orm', () => jest.requireActual('./burn4-fixtures').fakeOrm);
jest.mock('@/lib/integrations/credentialStore', () => ({
  getGoogleCredentials: jest.fn(), getMicrosoftCredentials: jest.fn(), getKrogerCredentials: jest.fn(),
}));
jest.mock('@/lib/integrations/kroger/tokens', () => ({ deleteUserTokens: jest.fn() }));
jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));

const fakeDb = db as unknown as DatabaseFake;
const displayAuthMock = jest.mocked(getDisplayAuth);
const authMock = jest.mocked(requireAuth);
const googleMock = jest.mocked(getGoogleCredentials);
const microsoftMock = jest.mocked(getMicrosoftCredentials);
const krogerMock = jest.mocked(getKrogerCredentials);
const deleteMock = jest.mocked(deleteUserTokens);
const logMock = jest.mocked(logError);
const signedIn = { userId: 'user-a', role: 'parent' as const };
const syntheticConfig = Object.freeze({
  clientId: 'synthetic-app-id', clientSecret: 'synthetic-placeholder',
  redirectUri: 'https://oauth.example.invalid/callback',
  gmailRedirectUri: 'https://oauth.example.invalid/gmail', tasksRedirectUri: 'https://oauth.example.invalid/tasks',
});

beforeEach(() => {
  jest.resetAllMocks();
  fakeDb.reset();
  displayAuthMock.mockResolvedValue(signedIn);
  authMock.mockResolvedValue(signedIn);
  googleMock.mockResolvedValue(null);
  microsoftMock.mockResolvedValue(null);
  krogerMock.mockResolvedValue(null);
  deleteMock.mockResolvedValue(undefined);
});

describe('OAuth app configuration status', () => {
  test('rejects an unauthenticated request before checking provider configuration', async () => {
    displayAuthMock.mockResolvedValue(null);
    const response = await oauthStatus();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication required' });
    expect(googleMock).not.toHaveBeenCalled();
    expect(microsoftMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  test.each([[false, false], [true, false], [false, true], [true, true]])(
    'returns only configuration booleans for Google %s and Microsoft %s', async (google, microsoft) => {
      displayAuthMock.mockResolvedValue({ userId: 'display-user', role: 'guest' });
      googleMock.mockResolvedValue(google ? syntheticConfig : null);
      microsoftMock.mockResolvedValue(microsoft ? syntheticConfig : null);
      const response = await oauthStatus();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ google, microsoft });
      expect(googleMock).toHaveBeenCalledTimes(1);
      expect(microsoftMock).toHaveBeenCalledTimes(1);
      expect(authMock).not.toHaveBeenCalled();
      expect(fakeDb.select).not.toHaveBeenCalled();
      expect(logMock).not.toHaveBeenCalled();
    },
  );

  test('starts both configuration lookups before waiting for either result', async () => {
    let resolveGoogle!: (value: null) => void;
    let resolveMicrosoft!: (value: null) => void;
    googleMock.mockReturnValue(new Promise((resolve) => { resolveGoogle = resolve; }));
    microsoftMock.mockReturnValue(new Promise((resolve) => { resolveMicrosoft = resolve; }));
    const pending = oauthStatus();
    await Promise.resolve();
    expect(googleMock).toHaveBeenCalledTimes(1);
    expect(microsoftMock).toHaveBeenCalledTimes(1);
    resolveGoogle(null);
    resolveMicrosoft(null);
    expect(await (await pending).json()).toEqual({ google: false, microsoft: false });
  });

  test.each(['google', 'microsoft'] as const)('returns a safe 500 response if the %s configuration lookup fails', async (provider) => {
    const failure = new Error('offline configuration store unavailable');
    (provider === 'google' ? googleMock : microsoftMock).mockRejectedValue(failure);
    const response = await oauthStatus();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to check OAuth configuration status' });
    expect(logMock).toHaveBeenCalledWith('Error checking OAuth configuration status:', failure);
  });

  test('preserves authentication rejection for the framework without querying configuration', async () => {
    const failure = new Error('offline display authentication unavailable');
    displayAuthMock.mockRejectedValue(failure);
    await expect(oauthStatus()).rejects.toBe(failure);
    expect(googleMock).not.toHaveBeenCalled();
    expect(microsoftMock).not.toHaveBeenCalled();
  });
});

describe('Kroger connection metadata status', () => {
  test.each([401, 403, 503])('forwards an authentication response with status %s unchanged', async (status) => {
    const denied = NextResponse.json({ error: 'offline auth response' }, { status });
    authMock.mockResolvedValue(denied);
    await expect(krogerStatus()).resolves.toBe(denied);
    expect(krogerMock).not.toHaveBeenCalled();
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  test.each([[false, false], [true, false], [false, true], [true, true]])(
    'keeps configured %s separate from connected %s with nullable metadata', async (configured, connected) => {
      krogerMock.mockResolvedValue(configured ? syntheticConfig : null);
      fakeDb.tables.kroger = connected ? [{ userId: 'user-a', tokenExpiresAt: null, preferredLocationId: null, preferredLocationName: null }] : [];
      const response = await krogerStatus();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        configured, connected, tokenExpiresAt: null, preferredLocationId: null, preferredLocationName: null,
      });
    },
  );

  test('selects only the authenticated user and returns ISO expiry plus store metadata', async () => {
    krogerMock.mockResolvedValue(syntheticConfig);
    fakeDb.tables.kroger = [
      { userId: 'user-b', tokenExpiresAt: new Date('2027-01-01T00:00:00Z'), preferredLocationId: 'store-b', preferredLocationName: 'Other store' },
      { userId: 'user-a', tokenExpiresAt: new Date('2026-10-22T12:30:00Z'), preferredLocationId: 'store-a', preferredLocationName: 'Neighborhood store', ignoredPrivateField: 'synthetic-unused-field' },
    ];
    const response = await krogerStatus();
    expect(await response.json()).toEqual({
      configured: true, connected: true, tokenExpiresAt: '2026-10-22T12:30:00.000Z',
      preferredLocationId: 'store-a', preferredLocationName: 'Neighborhood store',
    });
    expect(fakeDb.queries).toEqual([{ table: 'kroger', condition: { kind: 'eq', column: 'kroger.userId', value: 'user-a' } }]);
    expect(fakeDb.select).toHaveBeenCalledWith({
      tokenExpiresAt: 'kroger.tokenExpiresAt', preferredLocationId: 'kroger.preferredLocationId', preferredLocationName: 'kroger.preferredLocationName',
    });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  test('does not report another user connection as the current user connection', async () => {
    fakeDb.tables.kroger = [{ userId: 'user-b', preferredLocationId: 'other-store' }];
    expect(await (await krogerStatus()).json()).toEqual({
      configured: false, connected: false, tokenExpiresAt: null, preferredLocationId: null, preferredLocationName: null,
    });
  });

  test('reports an existing connection even if the stored expiry has passed', async () => {
    fakeDb.tables.kroger = [{ userId: 'user-a', tokenExpiresAt: new Date('2010-01-01T00:00:00Z') }];
    expect(await (await krogerStatus()).json()).toEqual({
      configured: false, connected: true, tokenExpiresAt: '2010-01-01T00:00:00.000Z', preferredLocationId: null, preferredLocationName: null,
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  test('preserves authentication rejection before configuration and storage access', async () => {
    const failure = new Error('offline authentication unavailable');
    authMock.mockRejectedValue(failure);
    await expect(krogerStatus()).rejects.toBe(failure);
    expect(krogerMock).not.toHaveBeenCalled();
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  test('preserves configuration failures for the framework without reading connection data', async () => {
    const failure = new Error('offline Kroger configuration unavailable');
    krogerMock.mockRejectedValue(failure);
    await expect(krogerStatus()).rejects.toBe(failure);
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  test('preserves storage failures for the framework', async () => {
    const failure = new Error('offline Kroger connection store unavailable');
    fakeDb.failures.kroger = failure;
    await expect(krogerStatus()).rejects.toBe(failure);
    expect(krogerMock).toHaveBeenCalledTimes(1);
  });
});

describe('Kroger disconnect', () => {
  test.each([401, 403, 503])('forwards an authentication response with status %s without deleting', async (status) => {
    const denied = NextResponse.json({ error: 'offline auth response' }, { status });
    authMock.mockResolvedValue(denied);
    await expect(disconnectKroger()).resolves.toBe(denied);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  test('deletes only the authenticated user connection and returns a minimal success body', async () => {
    const response = await disconnectKroger();
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith('user-a');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(krogerMock).not.toHaveBeenCalled();
    expect(fakeDb.select).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  test('waits until local deletion completes before returning success', async () => {
    let completeDelete!: () => void;
    deleteMock.mockReturnValue(new Promise<void>((resolve) => { completeDelete = resolve; }));
    let completed = false;
    const pending = disconnectKroger().then((response) => { completed = true; return response; });
    await Promise.resolve();
    expect(deleteMock).toHaveBeenCalledWith('user-a');
    expect(completed).toBe(false);
    completeDelete();
    expect(await (await pending).json()).toEqual({ ok: true });
  });

  test('reports a safe 500 body and logs the original local deletion failure', async () => {
    const failure = new Error('offline disconnect write failed');
    deleteMock.mockRejectedValue(failure);
    const response = await disconnectKroger();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to disconnect Kroger' });
    expect(logMock).toHaveBeenCalledWith('Failed to disconnect Kroger:', failure);
  });

  test('preserves authentication rejection without deleting a connection', async () => {
    const failure = new Error('offline authentication unavailable');
    authMock.mockRejectedValue(failure);
    await expect(disconnectKroger()).rejects.toBe(failure);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
