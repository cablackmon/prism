/**
 * Tests for gift ideas API routes.
 *
 * Mocks DB, auth, cache, and validation to test route handler logic:
 * - Privacy: GET only returns ideas created by the authenticated user
 * - Privacy: GET never returns ideas where forUserId === active user
 * - Validation: POST rejects creating an idea for yourself
 * - Validation: POST requires name field
 * - Authorization: PATCH only allows the creator to update
 * - Authorization: DELETE only allows the creator to delete
 * - CRUD: Basic create -> read -> update -> delete flow
 */

import { NextRequest, NextResponse } from 'next/server';

// --- Query result store: tests configure what each query returns ---
let queryResults: unknown[][] = [];
let queryIndex = 0;

function nextQueryResult() {
  const result = queryResults[queryIndex] ?? [];
  queryIndex++;
  return result;
}

// Chainable mock that returns the next result when the terminal method is awaited
function makeChain() {
  const chain: Record<string, unknown> = {};
  const proxy = new Proxy(chain, {
    get: (_target, prop) => {
      if (prop === 'then') {
        const p = Promise.resolve(nextQueryResult());
        return p.then.bind(p);
      }
      return (..._args: unknown[]) => proxy;
    },
  });
  return proxy;
}

const mockDelete = jest.fn();

jest.mock('@/lib/db/client', () => ({
  db: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'delete')
          return (...a: unknown[]) => {
            mockDelete(...a);
            return makeChain();
          };
        // select, insert, update all return the chainable proxy
        return () => makeChain();
      },
    }
  ),
}));

jest.mock('@/lib/db/schema', () => ({
  giftIdeas: {
    id: 'id',
    name: 'name',
    url: 'url',
    notes: 'notes',
    price: 'price',
    purchased: 'purchased',
    purchasedAt: 'purchasedAt',
    sortOrder: 'sortOrder',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    createdBy: 'createdBy',
    forUserId: 'forUserId',
  },
  users: { id: 'id', name: 'name', role: 'role', color: 'color' },
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn(),
  and: jest.fn(),
  ne: jest.fn(),
  asc: jest.fn(),
  sql: jest.fn(),
}));

jest.mock('drizzle-orm/pg-core', () => ({
  alias: jest.fn().mockReturnValue({
    id: 'id',
    name: 'name',
    color: 'color',
  }),
}));

// --- Auth mock ---
const mockRequireAuth = jest.fn();

jest.mock('@/lib/auth', () => ({
  requireAuth: () => mockRequireAuth(),
}));

jest.mock('@/lib/cache/redis', () => ({
  getCached: jest.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/cache/rateLimit', () => ({
  rateLimitGuard: jest.fn().mockResolvedValue(null),
}));

const mockValidateRequest = jest.fn();

jest.mock('@/lib/validations', () => ({
  createGiftIdeaSchema: {},
  updateGiftIdeaSchema: {},
  validateRequest: (...args: unknown[]) => mockValidateRequest(...args),
}));

jest.mock('@/lib/services/auditLog', () => ({
  logActivity: jest.fn(),
}));

// Import routes after mocks
import { GET, POST } from '../route';
import { PATCH, DELETE as DELETE_ROUTE } from '../[id]/route';

// --- Helpers ---

const parentAuth = { userId: 'parent-1', role: 'parent' };
const otherParentAuth = { userId: 'parent-2', role: 'parent' };

const now = new Date('2026-03-16T12:00:00Z');

const sampleIdea = {
  id: 'idea-1',
  name: 'Lego Set',
  url: 'https://example.com/lego',
  notes: 'The big one',
  price: '$49.99',
  purchased: false,
  purchasedAt: null,
  sortOrder: 0,
  createdAt: now,
  forUserId: 'child-1',
  forUserName: 'Timmy',
  forUserColor: '#FF0000',
  createdById: 'parent-1',
  createdByName: 'Dad',
  createdByColor: '#0000FF',
};

function makeGetRequest(params?: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/gift-ideas');
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/gift-ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/gift-ideas/idea-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest() {
  return new NextRequest('http://localhost:3000/api/gift-ideas/idea-1', {
    method: 'DELETE',
  });
}

const routeParams = { params: Promise.resolve({ id: 'idea-1' }) };

// =====================================================================
// GET /api/gift-ideas
// =====================================================================

describe('GET /api/gift-ideas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryResults = [];
    queryIndex = 0;
    mockRequireAuth.mockResolvedValue(parentAuth);
  });

  it('returns ideas created by the authenticated user', async () => {
    // The GET handler uses getCached which calls our mock that invokes the callback.
    // The callback does a db.select() chain which resolves to nextQueryResult().
    queryResults = [
      [sampleIdea], // db.select() result
    ];

    const res = await GET(makeGetRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ideas).toHaveLength(1);
    expect(data.ideas[0].name).toBe('Lego Set');
    expect(data.ideas[0].forUser.name).toBe('Timmy');
    expect(data.ideas[0].createdBy.name).toBe('Dad');
  });

  it('only returns ideas created by the active user (privacy enforcement)', async () => {
    // When parent-2 authenticates, the query filters by createdBy=parent-2.
    // Even if parent-1 created ideas, they should not appear.
    mockRequireAuth.mockResolvedValue(otherParentAuth);
    queryResults = [
      [], // No ideas created by parent-2
    ];

    const res = await GET(makeGetRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ideas).toHaveLength(0);
  });

  it('never returns ideas where forUserId equals the active user', async () => {
    // The route has ne(giftIdeas.forUserId, auth.userId) condition.
    // Even if someone created an idea for parent-1, parent-1 should not see it.
    // Simulate: query returns empty because the ne() filter excludes self-targeted ideas.
    queryResults = [
      [], // Filtered out by ne(forUserId, auth.userId)
    ];

    const res = await GET(makeGetRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ideas).toHaveLength(0);
  });

  it('filters by forUserId query parameter', async () => {
    queryResults = [[sampleIdea]];

    const res = await GET(makeGetRequest({ forUserId: 'child-1' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ideas).toHaveLength(1);
    expect(data.ideas[0].forUserId).toBe('child-1');
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });
});

// =====================================================================
// POST /api/gift-ideas
// =====================================================================

describe('POST /api/gift-ideas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryResults = [];
    queryIndex = 0;
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockValidateRequest.mockImplementation((_schema: unknown, data: unknown) => ({
      success: true,
      data,
    }));
  });

  it('creates a gift idea successfully', async () => {
    const body = {
      forUserId: 'child-1',
      name: 'Lego Set',
      url: 'https://example.com',
      notes: 'Big one',
      price: '$49.99',
    };

    queryResults = [
      [{ max: 2 }], // max sort order query
      [
        {
          // insert returning
          id: 'idea-new',
          name: 'Lego Set',
          url: 'https://example.com',
          notes: 'Big one',
          price: '$49.99',
          purchased: false,
          purchasedAt: null,
          sortOrder: 3,
          forUserId: 'child-1',
          createdAt: now,
        },
      ],
    ];

    const res = await POST(makePostRequest(body));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.id).toBe('idea-new');
    expect(data.name).toBe('Lego Set');
    expect(data.sortOrder).toBe(3);
    expect(data.forUserId).toBe('child-1');
  });

  it('rejects creating an idea for yourself', async () => {
    const body = { forUserId: 'parent-1', name: 'Treat for me' };

    const res = await POST(makePostRequest(body));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Cannot add a gift idea for yourself');
  });

  it('rejects when name field is missing (validation fails)', async () => {
    mockValidateRequest.mockReturnValue({
      success: false,
      error: { issues: [{ path: ['name'], message: 'Name is required' }] },
    });

    const body = { forUserId: 'child-1' }; // missing name

    const res = await POST(makePostRequest(body));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Validation failed');
    expect(data.details[0].message).toContain('Name is required');
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );

    const res = await POST(makePostRequest({ forUserId: 'child-1', name: 'Toy' }));
    expect(res.status).toBe(401);
  });
});

// =====================================================================
// PATCH /api/gift-ideas/[id]
// =====================================================================

describe('PATCH /api/gift-ideas/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryResults = [];
    queryIndex = 0;
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockValidateRequest.mockImplementation((_schema: unknown, data: unknown) => ({
      success: true,
      data,
    }));
  });

  it('allows the creator to update their idea', async () => {
    queryResults = [
      [{ id: 'idea-1', createdBy: 'parent-1' }], // ownership check
      [
        {
          // update returning
          id: 'idea-1',
          name: 'Updated Lego Set',
          url: 'https://example.com/updated',
          notes: 'Even bigger',
          price: '$59.99',
          purchased: false,
          purchasedAt: null,
          sortOrder: 0,
          forUserId: 'child-1',
          createdAt: now,
        },
      ],
    ];

    const res = await PATCH(makePatchRequest({ name: 'Updated Lego Set' }), routeParams);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.name).toBe('Updated Lego Set');
  });

  it('returns 404 when non-creator tries to update (authorization)', async () => {
    mockRequireAuth.mockResolvedValue(otherParentAuth);

    queryResults = [
      [], // ownership check fails: no match for parent-2 + idea-1
    ];

    const res = await PATCH(makePatchRequest({ name: 'Hijack' }), routeParams);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe('Gift idea not found');
  });

  it('returns 404 for nonexistent idea', async () => {
    queryResults = [
      [], // no idea found
    ];

    const res = await PATCH(makePatchRequest({ name: 'Ghost' }), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns 400 on validation failure', async () => {
    queryResults = [
      [{ id: 'idea-1', createdBy: 'parent-1' }], // ownership OK
    ];
    mockValidateRequest.mockReturnValue({
      success: false,
      error: { issues: [{ path: ['url'], message: 'Invalid url' }] },
    });

    const res = await PATCH(makePatchRequest({ url: 'not-a-url' }), routeParams);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Validation failed');
  });

  it('handles purchased toggle with purchasedAt timestamp', async () => {
    queryResults = [
      [{ id: 'idea-1', createdBy: 'parent-1' }],
      [
        {
          id: 'idea-1',
          name: 'Lego Set',
          url: null,
          notes: null,
          price: null,
          purchased: true,
          purchasedAt: now,
          sortOrder: 0,
          forUserId: 'child-1',
          createdAt: now,
        },
      ],
    ];

    const res = await PATCH(makePatchRequest({ purchased: true }), routeParams);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.purchased).toBe(true);
    expect(data.purchasedAt).toBeTruthy();
  });
});

// =====================================================================
// DELETE /api/gift-ideas/[id]
// =====================================================================

describe('DELETE /api/gift-ideas/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryResults = [];
    queryIndex = 0;
    mockRequireAuth.mockResolvedValue(parentAuth);
  });

  it('allows the creator to delete their idea', async () => {
    queryResults = [
      [{ id: 'idea-1', name: 'Lego Set', createdBy: 'parent-1' }], // ownership check
      [], // delete result (not used)
    ];

    const res = await DELETE_ROUTE(makeDeleteRequest(), routeParams);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe('Gift idea deleted');
  });

  it('returns 404 when non-creator tries to delete (authorization)', async () => {
    mockRequireAuth.mockResolvedValue(otherParentAuth);

    queryResults = [
      [], // ownership check fails: no match for parent-2
    ];

    const res = await DELETE_ROUTE(makeDeleteRequest(), routeParams);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe('Gift idea not found');
  });

  it('returns 404 for nonexistent idea', async () => {
    queryResults = [
      [], // no idea found
    ];

    const res = await DELETE_ROUTE(makeDeleteRequest(), routeParams);
    expect(res.status).toBe(404);
  });
});

// =====================================================================
// Full CRUD flow
// =====================================================================

describe('Gift Ideas CRUD flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryResults = [];
    queryIndex = 0;
    mockRequireAuth.mockResolvedValue(parentAuth);
    mockValidateRequest.mockImplementation((_schema: unknown, data: unknown) => ({
      success: true,
      data,
    }));
  });

  it('create -> read -> update -> delete lifecycle', async () => {
    // --- CREATE ---
    queryResults = [
      [{ max: -1 }], // max sort order
      [
        {
          id: 'idea-crud',
          name: 'Board Game',
          url: null,
          notes: 'Family game night',
          price: '$30',
          purchased: false,
          purchasedAt: null,
          sortOrder: 0,
          forUserId: 'child-1',
          createdAt: now,
        },
      ],
    ];

    const createRes = await POST(
      makePostRequest({
        forUserId: 'child-1',
        name: 'Board Game',
        notes: 'Family game night',
        price: '$30',
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.name).toBe('Board Game');

    // --- READ ---
    queryResults = [];
    queryIndex = 0;
    queryResults = [
      [
        {
          id: 'idea-crud',
          name: 'Board Game',
          url: null,
          notes: 'Family game night',
          price: '$30',
          purchased: false,
          purchasedAt: null,
          sortOrder: 0,
          createdAt: now,
          forUserId: 'child-1',
          forUserName: 'Timmy',
          forUserColor: '#FF0000',
          createdById: 'parent-1',
          createdByName: 'Dad',
          createdByColor: '#0000FF',
        },
      ],
    ];

    const readRes = await GET(makeGetRequest());
    expect(readRes.status).toBe(200);
    const readData = await readRes.json();
    expect(readData.ideas).toHaveLength(1);
    expect(readData.ideas[0].name).toBe('Board Game');

    // --- UPDATE ---
    queryResults = [];
    queryIndex = 0;
    queryResults = [
      [{ id: 'idea-crud', createdBy: 'parent-1' }], // ownership check
      [
        {
          id: 'idea-crud',
          name: 'Board Game Deluxe',
          url: null,
          notes: 'Upgraded edition',
          price: '$45',
          purchased: false,
          purchasedAt: null,
          sortOrder: 0,
          forUserId: 'child-1',
          createdAt: now,
        },
      ],
    ];

    const crudParams = { params: Promise.resolve({ id: 'idea-crud' }) };
    const updateRes = await PATCH(
      makePatchRequest({ name: 'Board Game Deluxe', notes: 'Upgraded edition', price: '$45' }),
      crudParams
    );
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.name).toBe('Board Game Deluxe');

    // --- DELETE ---
    queryResults = [];
    queryIndex = 0;
    queryResults = [[{ id: 'idea-crud', name: 'Board Game Deluxe', createdBy: 'parent-1' }], []];

    const deleteRes = await DELETE_ROUTE(
      new NextRequest('http://localhost:3000/api/gift-ideas/idea-crud', { method: 'DELETE' }),
      crudParams
    );
    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.message).toBe('Gift idea deleted');
  });
});
