import { setSettingsVerified, isSettingsVerified } from '../../lib/auth/settingsAuth';
import { GET } from '../../app/api/auth/settings-verified/route';

type StoredFlag = { value: string; expiresAt: number };
const mockStored = new Map<string, StoredFlag>();
let mockNow = 0;
const mockRedis = {
  setEx: jest.fn<Promise<void>, [string, number, string]>(),
  get: jest.fn<Promise<string | null>, [string]>(),
};
const mockGetRedisClient = jest.fn<Promise<typeof mockRedis | null>, []>();
const mockCookieGet = jest.fn<{ value: string } | undefined, [string]>();
const mockCookies = jest.fn<Promise<{ get: typeof mockCookieGet }>, []>();
const mockLogError = jest.fn<void, [string, unknown]>();

jest.mock('@/lib/cache/getRedisClient', () => ({
  getRedisClient: () => mockGetRedisClient(),
}));
jest.mock('next/headers', () => ({ cookies: () => mockCookies() }));
jest.mock('@/lib/utils/logError', () => ({
  logError: (message: string, error: unknown) => mockLogError(message, error),
}));
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockStored.clear();
  mockNow = 0;
  mockRedis.setEx.mockImplementation(async (key, ttlSeconds, value) => {
    mockStored.set(key, { value, expiresAt: mockNow + ttlSeconds * 1_000 });
  });
  mockRedis.get.mockImplementation(async (key) => {
    const entry = mockStored.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= mockNow) {
      mockStored.delete(key);
      return null;
    }
    return entry.value;
  });
  mockGetRedisClient.mockResolvedValue(mockRedis);
  mockCookieGet.mockReturnValue({ value: 'synthetic-session-a' });
  mockCookies.mockResolvedValue({ get: mockCookieGet });
});

describe('settings verification cache with an offline expiring store', () => {
  test('writes an expiring verification flag for exactly one synthetic session', async () => {
    await expect(setSettingsVerified('synthetic-session-a')).resolves.toBeUndefined();
    expect(mockRedis.setEx).toHaveBeenCalledWith('settings_verified:synthetic-session-a', 600, '1');
    expect(mockRedis.setEx).toHaveBeenCalledTimes(1);
    expect(await isSettingsVerified('synthetic-session-a')).toBe(true);
    expect(await isSettingsVerified('synthetic-session-b')).toBe(false);
    expect(mockRedis.get.mock.calls).toEqual([
      ['settings_verified:synthetic-session-a'], ['settings_verified:synthetic-session-b'],
    ]);
  });

  test('does not refresh verification expiry when the flag is read', async () => {
    await setSettingsVerified('synthetic-session-a');
    mockNow = 599_999;
    expect(await isSettingsVerified('synthetic-session-a')).toBe(true);
    mockNow = 600_000;
    expect(await isSettingsVerified('synthetic-session-a')).toBe(false);
    expect(mockRedis.setEx).toHaveBeenCalledTimes(1);
  });

  test('reverification renews only the selected session', async () => {
    await setSettingsVerified('synthetic-session-a');
    await setSettingsVerified('synthetic-session-b');
    mockNow = 300_000;
    await setSettingsVerified('synthetic-session-a');
    mockNow = 600_000;
    expect(await isSettingsVerified('synthetic-session-a')).toBe(true);
    expect(await isSettingsVerified('synthetic-session-b')).toBe(false);
    mockNow = 900_000;
    expect(await isSettingsVerified('synthetic-session-a')).toBe(false);
  });

  test('does not perform cache commands when Redis is unavailable', async () => {
    mockGetRedisClient.mockResolvedValue(null);
    await expect(setSettingsVerified('synthetic-session-a')).resolves.toBeUndefined();
    expect(await isSettingsVerified('synthetic-session-a')).toBe(false);
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.setEx).not.toHaveBeenCalled();
  });

  test.each([null, '0', 'true', '', '01'])('accepts only the exact stored verification marker, rejecting %j', async (value) => {
    mockRedis.get.mockResolvedValue(value);
    expect(await isSettingsVerified('synthetic-session-a')).toBe(false);
  });

  test('handles a failed verification write without leaving a readable flag', async () => {
    const error = new Error('Synthetic store write failure');
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mockRedis.setEx.mockRejectedValue(error);
      await expect(setSettingsVerified('synthetic-session-a')).resolves.toBeUndefined();
      expect(await isSettingsVerified('synthetic-session-a')).toBe(false);
      expect(log).toHaveBeenCalledWith('Failed to set settings verified:', error);
      expect(mockStored.size).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  test('denies verification when Redis read fails without attempting a write', async () => {
    const error = new Error('Synthetic store read failure');
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mockRedis.get.mockRejectedValue(error);
      expect(await isSettingsVerified('synthetic-session-a')).toBe(false);
      expect(log).toHaveBeenCalledWith('Failed to check settings verification:', error);
      expect(mockRedis.setEx).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test('acquires a client for each operation so service recovery is observable', async () => {
    mockGetRedisClient.mockResolvedValueOnce(null).mockResolvedValue(mockRedis);
    await setSettingsVerified('synthetic-session-a');
    expect(await isSettingsVerified('synthetic-session-a')).toBe(false);
    await setSettingsVerified('synthetic-session-a');
    expect(await isSettingsVerified('synthetic-session-a')).toBe(true);
    expect(mockGetRedisClient).toHaveBeenCalledTimes(4);
  });
});

describe('GET settings-verified with real verification logic and offline cookies', () => {
  test('returns true after verification and false at expiry without writing or refreshing the flag', async () => {
    await setSettingsVerified('synthetic-session-a');
    let response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true });
    mockNow = 600_000;
    response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: false });
    expect(mockCookieGet).toHaveBeenCalledWith('prism_session');
    expect(mockRedis.setEx).toHaveBeenCalledTimes(1);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test.each([undefined, { value: '' }])('denies an absent or empty session cookie without consulting Redis: %j', async (cookie) => {
    mockCookieGet.mockReturnValue(cookie);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: false });
    expect(mockGetRedisClient).not.toHaveBeenCalled();
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  test('does not expose another verified session to the current cookie', async () => {
    await setSettingsVerified('synthetic-session-b');
    const response = await GET();
    expect(await response.json()).toEqual({ verified: false });
    expect(mockRedis.get).toHaveBeenCalledWith('settings_verified:synthetic-session-a');
  });

  test('denies verification when the cookie store cannot be acquired', async () => {
    const error = new Error('Synthetic cookie access failure');
    mockCookies.mockRejectedValue(error);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: false });
    expect(mockLogError).toHaveBeenCalledWith('Error checking settings verification:', error);
    expect(mockGetRedisClient).not.toHaveBeenCalled();
  });

  test('denies verification when reading a cookie throws', async () => {
    const error = new Error('Synthetic cookie parsing failure');
    mockCookieGet.mockImplementation(() => { throw error; });
    const response = await GET();
    expect(await response.json()).toEqual({ verified: false });
    expect(mockLogError).toHaveBeenCalledWith('Error checking settings verification:', error);
    expect(mockGetRedisClient).not.toHaveBeenCalled();
  });

  test('contains a rejected Redis factory and returns only a false verification flag', async () => {
    const error = new Error('Synthetic connection acquisition failure');
    mockGetRedisClient.mockRejectedValue(error);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: false });
    expect(mockLogError).toHaveBeenCalledWith('Error checking settings verification:', error);
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  test('reports false for an unavailable Redis service without route-level errors', async () => {
    mockGetRedisClient.mockResolvedValue(null);
    const response = await GET();
    expect(await response.json()).toEqual({ verified: false });
    expect(mockLogError).not.toHaveBeenCalled();
    expect(mockRedis.setEx).not.toHaveBeenCalled();
  });
});
