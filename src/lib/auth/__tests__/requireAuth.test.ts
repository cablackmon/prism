/**
 * Tests for requireAuth, optionalAuth, and getDisplayAuth.
 *
 * Mocks next/headers (cookies, headers), session validation,
 * API token validation, and DB to test auth cascade:
 * Bearer token → cookie session → display user fallback.
 */

import { NextResponse } from 'next/server';

// --- Mock stores ---
let mockCookies: Record<string, string> = {};
let mockHeaders: Record<string, string> = {};

jest.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = mockCookies[name];
        return value ? { value } : undefined;
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeaders[name.toLowerCase()] ?? null,
    }),
}));

const mockValidateSession = jest.fn();
jest.mock('../session', () => ({
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

const mockValidateApiToken = jest.fn();
jest.mock('../apiTokens', () => ({
  validateApiToken: (...args: unknown[]) => mockValidateApiToken(...args),
}));

// DB mock for getDisplayAuth
let mockDbResult: unknown[] = [];
jest.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(mockDbResult) }) }),
  },
}));

jest.mock('@/lib/db/schema', () => ({
  settings: { key: 'key', value: 'value' },
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn(),
}));

import { requireAuth, optionalAuth, getDisplayAuth } from '../requireAuth';

describe('requireAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCookies = {};
    mockHeaders = {};
    mockValidateSession.mockResolvedValue({ ok: false, reason: 'invalid' });
    mockValidateApiToken.mockResolvedValue(null);
  });

  it('authenticates via Bearer token when present', async () => {
    mockHeaders['authorization'] = 'Bearer valid-token-123';
    mockValidateApiToken.mockResolvedValue({ userId: 'api-user', role: 'parent' });

    const result = await requireAuth();
    expect(result).toEqual({ userId: 'api-user', role: 'parent' });
    expect(mockValidateApiToken).toHaveBeenCalledWith('valid-token-123');
  });

  it('falls back to cookie session when no Bearer token', async () => {
    mockCookies['prism_session'] = 'session-token-abc';
    mockValidateSession.mockResolvedValue({
      ok: true,
      session: {
        userId: 'user-1',
        role: 'child',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
      },
    });

    const result = await requireAuth();
    expect(result).toEqual({ userId: 'user-1', role: 'child' });
    expect(mockValidateSession).toHaveBeenCalledWith('session-token-abc');
  });

  it('returns 401 when no Bearer token and no session cookie', async () => {
    const result = await requireAuth();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('returns 401 when session cookie exists but session is invalid', async () => {
    mockCookies['prism_session'] = 'expired-token';
    mockValidateSession.mockResolvedValue({ ok: false, reason: 'invalid' });

    const result = await requireAuth();
    expect(result).toBeInstanceOf(NextResponse);

    const body = await (result as NextResponse).json();
    expect(body.error).toContain('Invalid or expired');
  });

  it('returns 503 when Redis is unavailable', async () => {
    mockCookies['prism_session'] = 'some-token';
    mockValidateSession.mockResolvedValue({ ok: false, reason: 'unavailable' });

    const result = await requireAuth();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(503);

    const body = await (result as NextResponse).json();
    expect(body.error).toContain('unavailable');
  });

  it('prefers Bearer token over session cookie', async () => {
    mockHeaders['authorization'] = 'Bearer api-token';
    mockCookies['prism_session'] = 'session-token';
    mockValidateApiToken.mockResolvedValue({ userId: 'api-user', role: 'parent' });

    const result = await requireAuth();
    expect(result).toEqual({ userId: 'api-user', role: 'parent' });
    // Should not even check session
    expect(mockValidateSession).not.toHaveBeenCalled();
  });

  it('ignores Authorization header without Bearer prefix', async () => {
    mockHeaders['authorization'] = 'Basic dXNlcjpwYXNz';

    const result = await requireAuth();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
    expect(mockValidateApiToken).not.toHaveBeenCalled();
  });

  it('ignores empty Bearer token', async () => {
    mockHeaders['authorization'] = 'Bearer ';

    const result = await requireAuth();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
    expect(mockValidateApiToken).not.toHaveBeenCalled();
  });
});

describe('optionalAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCookies = {};
    mockHeaders = {};
    mockValidateSession.mockResolvedValue({ ok: false, reason: 'invalid' });
    mockValidateApiToken.mockResolvedValue(null);
  });

  it('returns auth result when Bearer token is valid', async () => {
    mockHeaders['authorization'] = 'Bearer valid';
    mockValidateApiToken.mockResolvedValue({ userId: 'u1', role: 'parent' });

    const result = await optionalAuth();
    expect(result).toEqual({ userId: 'u1', role: 'parent' });
  });

  it('returns auth result when session cookie is valid', async () => {
    mockCookies['prism_session'] = 'valid-session';
    mockValidateSession.mockResolvedValue({
      ok: true,
      session: {
        userId: 'u2',
        role: 'child',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
      },
    });

    const result = await optionalAuth();
    expect(result).toEqual({ userId: 'u2', role: 'child' });
  });

  it('returns null when not authenticated (no token, no cookie)', async () => {
    const result = await optionalAuth();
    expect(result).toBeNull();
  });

  it('returns null when session cookie is invalid', async () => {
    mockCookies['prism_session'] = 'bad-session';
    mockValidateSession.mockResolvedValue({ ok: false, reason: 'invalid' });

    const result = await optionalAuth();
    expect(result).toBeNull();
  });

  it('returns null when Redis is unavailable (degraded gracefully)', async () => {
    mockCookies['prism_session'] = 'some-token';
    mockValidateSession.mockResolvedValue({ ok: false, reason: 'unavailable' });

    const result = await optionalAuth();
    expect(result).toBeNull();
  });
});

describe('getDisplayAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCookies = {};
    mockHeaders = {};
    mockValidateSession.mockResolvedValue({ ok: false, reason: 'invalid' });
    mockValidateApiToken.mockResolvedValue(null);
    mockDbResult = [];
  });

  it('returns auth from optionalAuth when session exists', async () => {
    mockCookies['prism_session'] = 'valid';
    mockValidateSession.mockResolvedValue({
      ok: true,
      session: {
        userId: 'u1',
        role: 'parent',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
      },
    });

    const result = await getDisplayAuth();
    expect(result).toEqual({ userId: 'u1', role: 'parent' });
  });

  it('falls back to displayUserId setting when no session', async () => {
    mockDbResult = [{ key: 'displayUserId', value: 'display-user-id' }];

    const result = await getDisplayAuth();
    expect(result).toEqual({ userId: 'display-user-id', role: 'guest' });
  });

  it('returns null when no session and no displayUserId setting', async () => {
    mockDbResult = [];

    const result = await getDisplayAuth();
    expect(result).toBeNull();
  });

  it('returns null when displayUserId setting has no value', async () => {
    mockDbResult = [{ key: 'displayUserId', value: null }];

    const result = await getDisplayAuth();
    expect(result).toBeNull();
  });
});
