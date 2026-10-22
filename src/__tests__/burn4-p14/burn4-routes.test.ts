import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth';
import type { AuthResult } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { recipeSources } from '@/lib/db/schema';
import { logError } from '@/lib/utils/logError';
import { listTombstones, removeTombstone } from '@/lib/services/settingsTombstone';
import { DISMISSED_GOOGLE_CALENDARS_KEY } from '@/lib/integrations/google-calendar';
import { detectBirthdaysFromEvents } from '@/lib/services/birthday-detect';
import { GET as removedGET, POST as restorePOST } from '@/app/api/calendars/removed/route';
import { POST as birthdayPOST } from '@/app/api/birthdays/sync/route';
import { DELETE as sourceDELETE } from '@/app/api/recipe-sources/[id]/route';
import { deferred, jsonRequest, malformedRequest } from './burn4-fakes';
import type { RecipeStore, TombstoneStore } from './burn4-fakes';

jest.mock('next/server', () => ({ NextResponse: jest.requireActual('./burn4-fakes').JsonResponse }));
jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn(), requireRole: jest.fn() }));
jest.mock('@/lib/utils/logError', () => ({ logError: jest.fn() }));
jest.mock('@/lib/integrations/google-calendar', () => ({ DISMISSED_GOOGLE_CALENDARS_KEY: 'burn4.removed-calendars' }));
jest.mock('@/lib/services/birthday-detect', () => ({ detectBirthdaysFromEvents: jest.fn() }));
jest.mock('@/lib/services/settingsTombstone', () => {
  const { TombstoneStore } = jest.requireActual('./burn4-fakes') as typeof import('./burn4-fakes');
  const store = new TombstoneStore();
  return { listTombstones: store.list, removeTombstone: store.remove, burn4Store: store };
});
jest.mock('@/lib/db/schema', () => {
  const { pgTable, uuid } = jest.requireActual('drizzle-orm/pg-core') as typeof import('drizzle-orm/pg-core');
  return { recipeSources: pgTable('recipe_sources', { id: uuid('id') }) };
});
jest.mock('@/lib/db/client', () => {
  const { RecipeStore } = jest.requireActual('./burn4-fakes') as typeof import('./burn4-fakes');
  const { recipeSources } = jest.requireMock('@/lib/db/schema');
  return { db: new RecipeStore(recipeSources) };
});

const auth = jest.mocked(requireAuth);
const role = jest.mocked(requireRole);
const logger = jest.mocked(logError);
const detect = jest.mocked(detectBirthdaysFromEvents);
const tombstones = (jest.requireMock('@/lib/services/settingsTombstone') as { burn4Store: TombstoneStore }).burn4Store;
const recipes = db as unknown as RecipeStore;
const parent: AuthResult = { userId: 'synthetic-parent', role: 'parent' };
const sourceA = '11111111-2222-4333-8444-555555555555';
const sourceB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const emptyRequest = {} as NextRequest;
const context = (id = sourceA) => ({ params: Promise.resolve({ id }) });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  tombstones.reset();
  recipes.reset();
  jest.clearAllMocks();
  auth.mockReset().mockResolvedValue(parent);
  role.mockReset().mockImplementation((principal, permission) => {
    const allowed = principal.scopes !== undefined
      ? principal.scopes.includes('*') || principal.scopes.includes(permission)
      : principal.role === 'parent';
    return allowed ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  });
  detect.mockReset().mockResolvedValue({ added: 2, updated: 3, total: 11, errors: [] });
});

const handlers = [
  { label: 'removed GET', run: () => removedGET() },
  { label: 'removed POST', run: () => restorePOST(jsonRequest({ id: 'calendar-alpha' }).request) },
  { label: 'birthdays POST', run: () => birthdayPOST() },
  { label: 'source DELETE', run: () => sourceDELETE(emptyRequest, context()) },
];

describe('authentication boundary for every handler', () => {
  test.each(handlers)('$label forwards the authentication denial response unchanged', async ({ run }) => {
    const denial = NextResponse.json({ error: 'Synthetic authentication required' }, { status: 401, headers: { 'x-burn4-auth': 'denied' } });
    auth.mockResolvedValue(denial);
    const response = await run();
    expect(response).toBe(denial);
    expect(response.headers.get('x-burn4-auth')).toBe('denied');
    expect(auth).toHaveBeenCalledTimes(1);
    expect(role).not.toHaveBeenCalled();
    expect(listTombstones).not.toHaveBeenCalled();
    expect(removeTombstone).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
    expect(recipes.delete).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalled();
  });

  test('denied restoration does not parse an invalid request body', async () => {
    const denial = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    auth.mockResolvedValue(denial);
    const input = malformedRequest();
    expect(await restorePOST(input.request)).toBe(denial);
    expect(input.json).not.toHaveBeenCalled();
  });

  test('denied deletion returns before awaiting route parameters', async () => {
    const denial = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    auth.mockResolvedValue(denial);
    const params = deferred<{ id: string }>();
    expect(await sourceDELETE(emptyRequest, { params: params.promise })).toBe(denial);
    expect(recipes.delete).not.toHaveBeenCalled();
  });
});

const roleProtected = [
  { label: 'removed GET', permission: 'canModifySettings', run: () => removedGET() },
  { label: 'removed POST', permission: 'canModifySettings', run: () => restorePOST(jsonRequest({ id: 'calendar-alpha' }).request) },
  { label: 'source DELETE', permission: 'canManageIntegrations', run: () => sourceDELETE(emptyRequest, context()) },
];

describe('role and scope boundary for protected handlers', () => {
  test.each(roleProtected)('$label checks its specific permission for the authorized principal', async ({ run, permission }) => {
    expect((await run()).status).toBe(200);
    expect(role).toHaveBeenCalledWith(parent, permission);
  });

  test.each(roleProtected.flatMap((handler) => (['child', 'guest'] as const).map((principalRole) => ({ ...handler, principalRole }))))('$label denies a $principalRole before persistence', async ({ run, permission, principalRole }) => {
    const principal: AuthResult = { userId: 'synthetic-restricted-user', role: principalRole };
    auth.mockResolvedValue(principal);
    const response = await run();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(role).toHaveBeenCalledWith(principal, permission);
    expect(tombstones.list).not.toHaveBeenCalled();
    expect(tombstones.remove).not.toHaveBeenCalled();
    expect(recipes.delete).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalled();
  });

  test.each(roleProtected)('$label denies a parent with insufficient explicit scopes', async ({ run }) => {
    auth.mockResolvedValue({ ...parent, scopes: [] });
    expect((await run()).status).toBe(403);
    expect(tombstones.list).not.toHaveBeenCalled();
    expect(tombstones.remove).not.toHaveBeenCalled();
    expect(recipes.delete).not.toHaveBeenCalled();
  });

  test('role denial is forwarded by identity before parsing the restore body', async () => {
    const forbidden = NextResponse.json({ error: 'Synthetic forbidden' }, { status: 403 });
    role.mockReturnValue(forbidden);
    const input = malformedRequest();
    expect(await restorePOST(input.request)).toBe(forbidden);
    expect(input.json).not.toHaveBeenCalled();
  });
});

describe('removed calendar listing and restoration', () => {
  test('lists synthetic tombstones from the Google calendar namespace without changing storage', async () => {
    const entries = [{ id: 'calendar-alpha', name: 'Synthetic School' }, { id: 'calendar-beta', name: 'Synthetic Music' }];
    tombstones.namespaces.set(DISMISSED_GOOGLE_CALENDARS_KEY, entries);
    tombstones.namespaces.set('burn4.unrelated', [{ id: 'unrelated', name: 'Other category' }]);
    const response = await removedGET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: entries });
    expect(listTombstones).toHaveBeenCalledWith(DISMISSED_GOOGLE_CALENDARS_KEY);
    expect(tombstones.namespaces.get(DISMISSED_GOOGLE_CALENDARS_KEY)).toBe(entries);
    expect(tombstones.writes).toEqual([]);
  });

  test('an empty tombstone namespace produces an empty removed list', async () => {
    expect(await (await removedGET()).json()).toEqual({ removed: [] });
  });

  test.each(['error', 'string'] as const)('listing %s failures produce the stable public 500 response', async (kind) => {
    const failure = kind === 'error' ? new Error('Synthetic settings read failure') : 'synthetic settings read rejection';
    tombstones.listFailure = failure;
    const response = await removedGET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to list removed calendars' });
    expect(logger).toHaveBeenCalledWith('Error listing removed calendars:', failure);
    expect(tombstones.writes).toEqual([]);
  });

  test('restores only the requested ID and retains other tombstones and namespaces', async () => {
    const remaining = { id: 'calendar-beta', name: 'Synthetic Music' };
    const other = [{ id: 'calendar-alpha', name: 'Unrelated tombstone' }];
    tombstones.namespaces.set(DISMISSED_GOOGLE_CALENDARS_KEY, [{ id: 'calendar-alpha', name: 'Synthetic School' }, remaining]);
    tombstones.namespaces.set('burn4.unrelated', other);
    const input = jsonRequest(Object.freeze({ id: 'calendar-alpha', extra: 'ignored' }));
    const response = await restorePOST(input.request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ restored: true });
    expect(input.json).toHaveBeenCalledTimes(1);
    expect(removeTombstone).toHaveBeenCalledWith(DISMISSED_GOOGLE_CALENDARS_KEY, 'calendar-alpha');
    expect(tombstones.namespaces.get(DISMISSED_GOOGLE_CALENDARS_KEY)).toEqual([remaining]);
    expect(tombstones.namespaces.get('burn4.unrelated')).toBe(other);
  });

  test('restoring an already absent ID is idempotent', async () => {
    const input = jsonRequest({ id: 'already-restored' });
    expect(await (await restorePOST(input.request)).json()).toEqual({ restored: true });
    expect(await (await restorePOST(input.request)).json()).toEqual({ restored: true });
    expect(tombstones.writes).toEqual([]);
  });

  test('GET observes the persisted restored state after POST', async () => {
    tombstones.namespaces.set(DISMISSED_GOOGLE_CALENDARS_KEY, [{ id: 'calendar-alpha', name: 'Synthetic School' }]);
    expect(await (await removedGET()).json()).toEqual({ removed: [{ id: 'calendar-alpha', name: 'Synthetic School' }] });
    await restorePOST(jsonRequest({ id: 'calendar-alpha' }).request);
    expect(await (await removedGET()).json()).toEqual({ removed: [] });
  });

  test.each([{}, { id: '' }, { id: null }, { id: 12 }, { id: false }, { id: {} }, { id: [] }, []])('rejects an absent, empty or non-string ID in %j without persistence', async (body) => {
    const response = await restorePOST(jsonRequest(body).request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'id is required' });
    expect(removeTombstone).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalled();
  });

  test.each(['error', 'string'] as const)('restore %s failures preserve tombstones and return the stable 500 response', async (kind) => {
    const failure = kind === 'error' ? new Error('Synthetic settings write failure') : 'synthetic settings write rejection';
    const entries = [{ id: 'calendar-alpha', name: 'Synthetic School' }];
    tombstones.namespaces.set(DISMISSED_GOOGLE_CALENDARS_KEY, entries);
    tombstones.restoreFailure = failure;
    const response = await restorePOST(jsonRequest({ id: 'calendar-alpha' }).request);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to restore calendar' });
    expect(tombstones.namespaces.get(DISMISSED_GOOGLE_CALENDARS_KEY)).toBe(entries);
    expect(logger).toHaveBeenCalledWith('Error restoring calendar:', failure);
  });

  test('does not acknowledge a restoration before persistence finishes', async () => {
    const gate = deferred<void>();
    tombstones.restoreGate = gate.promise;
    tombstones.namespaces.set(DISMISSED_GOOGLE_CALENDARS_KEY, [{ id: 'calendar-alpha', name: 'Synthetic School' }]);
    let completed = false;
    const pending = restorePOST(jsonRequest({ id: 'calendar-alpha' }).request).then((response) => { completed = true; return response; });
    await flush();
    expect(removeTombstone).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    expect(tombstones.writes).toEqual([]);
    gate.resolve();
    expect((await pending).status).toBe(200);
    expect(tombstones.namespaces.get(DISMISSED_GOOGLE_CALENDARS_KEY)).toEqual([]);
  });

  test.failing('KNOWN GAP: malformed JSON in calendar restoration is reported as a server error', async () => {
    const input = malformedRequest();
    const response = await restorePOST(input.request);
    expect(input.json).toHaveBeenCalledTimes(1);
    expect(removeTombstone).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  test.failing('KNOWN GAP: a null restoration body is reported as a server error', async () => {
    const response = await restorePOST(jsonRequest(null).request);
    expect(removeTombstone).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });
});

describe('birthday detection sync response and failures', () => {
  test('reports net additions and updates separately from all considered events', async () => {
    const response = await birthdayPOST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: 5, added: 2, updated: 3, total: 11 });
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledWith();
    expect(logger).not.toHaveBeenCalled();
  });

  test('no database changes means synced zero even when many events were considered', async () => {
    detect.mockResolvedValue({ added: 0, updated: 0, total: 200, errors: [] });
    const body = await (await birthdayPOST()).json();
    expect(body).toEqual({ synced: 0, added: 0, updated: 0, total: 200 });
    expect(Object.hasOwn(body, 'errors')).toBe(false);
  });

  test('an empty scan keeps every count zero and omits errors from JSON', async () => {
    detect.mockResolvedValue({ added: 0, updated: 0, total: 0, errors: [] });
    expect(await (await birthdayPOST()).json()).toEqual({ synced: 0, added: 0, updated: 0, total: 0 });
  });

  test('partial failures preserve successful counts and the ordered errors list without mutation', async () => {
    const result = Object.freeze({ added: 1, updated: 2, total: 9, errors: Object.freeze(['Synthetic account A failure', 'Synthetic persistence failure']) });
    detect.mockResolvedValue(result as unknown as Awaited<ReturnType<typeof detectBirthdaysFromEvents>>);
    const response = await birthdayPOST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: 3, added: 1, updated: 2, total: 9, errors: [...result.errors] });
    expect(result.added).toBe(1);
    expect(result.updated).toBe(2);
    expect(result.errors).toHaveLength(2);
  });

  test('a handled scan with only per-item errors still returns its accounting', async () => {
    detect.mockResolvedValue({ added: 0, updated: 0, total: 4, errors: ['Synthetic per-item failure'] });
    expect(await (await birthdayPOST()).json()).toEqual({ synced: 0, added: 0, updated: 0, total: 4, errors: ['Synthetic per-item failure'] });
  });

  test('awaits the detector before responding', async () => {
    const gate = deferred<Awaited<ReturnType<typeof detectBirthdaysFromEvents>>>();
    detect.mockReturnValue(gate.promise);
    let completed = false;
    const pending = birthdayPOST().then((response) => { completed = true; return response; });
    await flush();
    expect(detect).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    gate.resolve({ added: 4, updated: 0, total: 10, errors: [] });
    expect(await (await pending).json()).toEqual({ synced: 4, added: 4, updated: 0, total: 10 });
  });

  test.each(['error', 'string'] as const)('uncaught detector %s failures return a generic 500 response', async (kind) => {
    const failure = kind === 'error' ? new Error('Synthetic detector database failure') : 'synthetic detector provider rejection';
    detect.mockRejectedValue(failure);
    const response = await birthdayPOST();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to detect birthdays from calendars' });
    expect(logger).toHaveBeenCalledWith('Error detecting birthdays:', failure);
  });

  test('authentication dependency failures are caught before detection starts', async () => {
    const failure = new Error('Synthetic authentication lookup failure');
    auth.mockRejectedValue(failure);
    const response = await birthdayPOST();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to detect birthdays from calendars' });
    expect(detect).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith('Error detecting birthdays:', failure);
  });
});

describe('recipe source disconnection', () => {
  beforeEach(() => {
    recipes.sources.push({ id: sourceA, name: 'Synthetic Recipe Server A', provider: 'mealie' }, { id: sourceB, name: 'Synthetic Recipe Server B', provider: 'tandoor' });
    recipes.recipes.push({ id: 'recipe-a', name: 'Synthetic Soup', sourceId: sourceA, notes: 'Keep local notes' },
      { id: 'recipe-b', name: 'Synthetic Bread', sourceId: sourceB, notes: 'Other server' },
      { id: 'recipe-local', name: 'Synthetic Rice', sourceId: null, notes: 'Local recipe' });
  });

  test('deletes only the selected connection and retains every recipe and unrelated source', async () => {
    const before = recipes.recipes.map((entry) => ({ ...entry }));
    const response = await sourceDELETE(emptyRequest, context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(recipes.delete).toHaveBeenCalledWith(recipeSources);
    expect(recipes.delete).toHaveBeenCalledTimes(1);
    expect(recipes.queries[0]?.params).toEqual([sourceA]);
    expect(recipes.sources.map((entry) => entry.id)).toEqual([sourceB]);
    expect(recipes.recipes).toEqual(before.map((entry) => entry.sourceId === sourceA ? { ...entry, sourceId: null } : entry));
    expect(logger).not.toHaveBeenCalled();
  });

  test('the selected ID comes from awaited route parameters rather than the request', async () => {
    const input = jsonRequest({ id: sourceA });
    await sourceDELETE(input.request, context(sourceB));
    expect(input.json).not.toHaveBeenCalled();
    expect(recipes.queries[0]?.params).toEqual([sourceB]);
    expect(recipes.sources.map((entry) => entry.id)).toEqual([sourceA]);
    expect(recipes.recipes.find((entry) => entry.id === 'recipe-b')?.sourceId).toBeNull();
  });

  test('repeated deletion of an absent connection is idempotent and keeps recipes', async () => {
    await sourceDELETE(emptyRequest, context());
    const retained = recipes.recipes.map((entry) => ({ ...entry }));
    const response = await sourceDELETE(emptyRequest, context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(recipes.recipes).toEqual(retained);
  });

  test('waits for source deletion before returning success', async () => {
    const gate = deferred<void>();
    recipes.deleteGate = gate.promise;
    let completed = false;
    const pending = sourceDELETE(emptyRequest, context()).then((response) => { completed = true; return response; });
    await flush();
    expect(recipes.queries).toHaveLength(1);
    expect(completed).toBe(false);
    expect(recipes.sources).toHaveLength(2);
    gate.resolve();
    expect((await pending).status).toBe(200);
    expect(recipes.sources).toHaveLength(1);
  });

  test.each(['error', 'string'] as const)('database %s failures retain source and recipe state with a generic 500', async (kind) => {
    const failure = kind === 'error' ? new Error('Synthetic delete failure') : 'synthetic delete rejection';
    recipes.deleteFailure = failure;
    const beforeSources = recipes.sources.map((entry) => ({ ...entry }));
    const beforeRecipes = recipes.recipes.map((entry) => ({ ...entry }));
    const response = await sourceDELETE(emptyRequest, context());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to disconnect the recipe source.' });
    expect(recipes.sources).toEqual(beforeSources);
    expect(recipes.recipes).toEqual(beforeRecipes);
    expect(logger).toHaveBeenCalledWith('Error deleting recipe source:', failure);
  });

  test('route parameter resolution failures are caught without database access', async () => {
    const failure = new Error('Synthetic route params failure');
    const response = await sourceDELETE(emptyRequest, { params: Promise.reject(failure) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to disconnect the recipe source.' });
    expect(recipes.delete).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith('Error deleting recipe source:', failure);
  });

  test('role denial returns before unresolved route parameters or database work', async () => {
    const denial = NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    role.mockReturnValue(denial);
    const gate = deferred<{ id: string }>();
    expect(await sourceDELETE(emptyRequest, { params: gate.promise })).toBe(denial);
    expect(recipes.delete).not.toHaveBeenCalled();
  });

  test.failing('KNOWN GAP: invalid recipe source UUIDs reach PostgreSQL and become server errors', async () => {
    const before = recipes.sources.map((entry) => ({ ...entry }));
    const response = await sourceDELETE(emptyRequest, context('not-a-uuid'));
    expect(recipes.sources).toEqual(before);
    expect(response.status).toBe(400);
    expect(recipes.delete).not.toHaveBeenCalled();
  });
});
