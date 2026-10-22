import { db } from '@/lib/db/client';
import { decrypt } from '@/lib/utils/crypto';
import { loadSourceConnection, loadTandoorSource } from '@/lib/sync/adapters/tandoorSource';
import { sourceRow, type DatabaseFake } from './burn4-fixtures';

jest.mock('@/lib/db/client', () => ({ db: jest.requireActual('./burn4-fixtures').createDatabaseFake() }));
jest.mock('@/lib/db/schema', () => jest.requireActual('./burn4-fixtures').fakeSchema);
jest.mock('drizzle-orm', () => jest.requireActual('./burn4-fixtures').fakeOrm);
jest.mock('@/lib/utils/crypto', () => ({ decrypt: jest.fn() }));

const fakeDb = db as unknown as DatabaseFake;
const decryptMock = jest.mocked(decrypt);

beforeEach(() => {
  jest.resetAllMocks();
  fakeDb.reset();
  decryptMock.mockReturnValue('synthetic-provider-value');
});

describe('recipe source connection resolution', () => {
  test.each(['tandoor', 'mealie'])('resolves only the requested %s source and decrypts it once', async (provider) => {
    const wanted = sourceRow(provider);
    fakeDb.tables.sources = [sourceRow('other', 'source-b'), wanted];
    await expect(loadSourceConnection('source-a')).resolves.toEqual({
      provider,
      serverUrl: `https://${provider}.example.invalid`,
      token: 'synthetic-provider-value',
    });
    expect(decryptMock).toHaveBeenCalledTimes(1);
    expect(decryptMock).toHaveBeenCalledWith('synthetic-sealed-value');
    expect(wanted).toEqual(sourceRow(provider));
    expect(fakeDb.queries).toEqual([{
      table: 'sources', condition: { kind: 'eq', column: 'sources.id', value: 'source-a' },
    }]);
  });

  test('rejects a missing source before decryption', async () => {
    fakeDb.tables.sources = [sourceRow('tandoor', 'another-source')];
    await expect(loadSourceConnection('source-a')).rejects.toThrow('Recipe source not found');
    expect(decryptMock).not.toHaveBeenCalled();
  });

  test.each([
    { serverUrl: null }, { serverUrl: '' }, { accessToken: null }, { accessToken: '' },
  ])('rejects incomplete connection data %j before decryption', async (missing) => {
    fakeDb.tables.sources = [{ ...sourceRow(), ...missing }];
    await expect(loadSourceConnection('source-a')).rejects.toThrow('Recipe source is missing its server URL or API token');
    expect(decryptMock).not.toHaveBeenCalled();
  });

  test('propagates storage failure without trying to decrypt', async () => {
    const failure = new Error('offline storage unavailable');
    fakeDb.failures.sources = failure;
    await expect(loadSourceConnection('source-a')).rejects.toBe(failure);
    expect(decryptMock).not.toHaveBeenCalled();
  });

  test('propagates a failed decrypt rather than returning sealed data', async () => {
    const failure = new Error('synthetic decryption failure');
    fakeDb.tables.sources = [sourceRow()];
    decryptMock.mockImplementation(() => { throw failure; });
    await expect(loadSourceConnection('source-a')).rejects.toBe(failure);
  });

  test('returns only connection fields for Tandoor', async () => {
    fakeDb.tables.sources = [sourceRow()];
    await expect(loadTandoorSource('source-a')).resolves.toEqual({
      serverUrl: 'https://tandoor.example.invalid', token: 'synthetic-provider-value',
    });
  });

  test('rejects another provider through the Tandoor resolver', async () => {
    fakeDb.tables.sources = [sourceRow('mealie')];
    await expect(loadTandoorSource('source-a')).rejects.toThrow('Not a Tandoor recipe source');
  });

  test('retains missing-source errors through the Tandoor resolver', async () => {
    await expect(loadTandoorSource('source-a')).rejects.toThrow('Recipe source not found');
  });
});
