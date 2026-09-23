/**
 * Auth enumeration tests.
 *
 * Verifies that routes whose GET handler calls requireAuth() return 401
 * when accessed without credentials. Routes that use getDisplayAuth() are
 * intentionally guest-accessible (kiosk/display mode) and are not tested here.
 *
 * Pass/fail breakdown:
 *   requireAuth in GET  → must return 401 (tested here)
 *   getDisplayAuth in GET → intentionally public to guests (not tested here)
 */

import { NextRequest } from 'next/server';

// ---- Auth mock ----
const mockRequireAuth = jest.fn();
const mockRequireRole = jest.fn();

jest.mock('@/lib/auth', () => ({
  requireAuth: () => mockRequireAuth(),
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
  getDisplayAuth: jest.fn().mockResolvedValue(null),
  optionalAuth: jest.fn().mockResolvedValue(null),
}));

// ---- DB mock (chainable, returns empty arrays) ----
function makeChain(): unknown {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') {
          const p = Promise.resolve([]);
          return (p as Promise<unknown[]>).then.bind(p);
        }
        return (..._args: unknown[]) => makeChain();
      },
    }
  );
}

jest.mock('@/lib/db/client', () => ({
  db: new Proxy({}, { get: () => () => makeChain() }),
}));

jest.mock('@/lib/db/schema', () => ({}));
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(),
  and: jest.fn(),
  desc: jest.fn(),
  asc: jest.fn(),
  gte: jest.fn(),
  lte: jest.fn(),
  or: jest.fn(),
  isNull: jest.fn(),
  sql: jest.fn(),
  ne: jest.fn(),
  count: jest.fn(),
  inArray: jest.fn(),
  aliasedTable: jest.fn(() => ({})),
}));
jest.mock('drizzle-orm/pg-core', () => ({ alias: jest.fn(() => ({})) }));

jest.mock('@/lib/cache/redis', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
  rateLimitGuard: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/cache/rateLimit', () => ({ rateLimitGuard: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));
jest.mock('@/lib/services/auditLog', () => ({ logActivity: jest.fn() }));
jest.mock('@/lib/services/auditCleanup', () => ({ cleanupOldAuditLogs: jest.fn() }));
jest.mock('@/lib/utils/backup', () => ({ listBackups: jest.fn().mockResolvedValue([]) }));

import { NextResponse } from 'next/server';

function makeReq(url = 'http://localhost/api/test'): NextRequest {
  return new NextRequest(url);
}

function make401(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAuth.mockResolvedValue(make401());
  mockRequireRole.mockReturnValue(null);
});

describe('Protected GET routes return 401 without auth', () => {
  it('/api/audit-logs', async () => {
    const { GET } = await import('../audit-logs/route');
    const res = await GET(makeReq('http://localhost/api/audit-logs'));
    expect(res.status).toBe(401);
  });

  it('/api/settings/wifi', async () => {
    const { GET } = await import('../settings/wifi/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('/api/gift-ideas', async () => {
    const { GET } = await import('../gift-ideas/route');
    const res = await GET(makeReq('http://localhost/api/gift-ideas'));
    expect(res.status).toBe(401);
  });

  it('/api/admin/backups', async () => {
    const { GET } = await import('../admin/backups/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('/api/photo-sources', async () => {
    const { GET } = await import('../photo-sources/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('Guest-accessible GET routes return data without auth (display mode)', () => {
  it('/api/chores is accessible to guests (getDisplayAuth)', async () => {
    // These routes intentionally support kiosk/display mode via getDisplayAuth
    // getDisplayAuth returns null → routes handle gracefully (empty data or guest view)
    // We just verify they do NOT crash (no 500)
    const { GET } = await import('../chores/route');
    const res = await GET(makeReq('http://localhost/api/chores'));
    expect(res.status).not.toBe(500);
  });

  it('/api/tasks is accessible to guests (getDisplayAuth)', async () => {
    const { GET } = await import('../tasks/route');
    const res = await GET(makeReq('http://localhost/api/tasks'));
    expect(res.status).not.toBe(500);
  });

  it('/api/photos is accessible to guests (getDisplayAuth)', async () => {
    const { GET } = await import('../photos/route');
    const res = await GET(makeReq('http://localhost/api/photos'));
    expect(res.status).not.toBe(500);
  });
});
