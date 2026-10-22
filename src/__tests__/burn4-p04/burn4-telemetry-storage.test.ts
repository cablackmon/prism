import type * as Store from '@/lib/telemetry/store';
import type * as Identity from '@/lib/telemetry/instanceId';
import type * as Constants from '@/lib/telemetry/constants';
import { loadTelemetry } from './burn4-telemetry-vm';

const now = new Date('2026-10-21T13:30:00.000Z');
const constants = loadTelemetry<typeof Constants>('constants.ts', {});
const table = { key: 'settings.key' };
const eq = (column: unknown, value: unknown) => ({ column, value });

function storage(initial: Record<string, unknown> = {}) {
  const records = new Map(Object.entries(initial));
  const where = jest.fn(async (predicate: ReturnType<typeof eq>) =>
    records.has(String(predicate.value)) ? [{ value: records.get(String(predicate.value)) }] : []);
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  const updateWhere = jest.fn(async (predicate: ReturnType<typeof eq>) => {
    records.set(String(predicate.value), set.mock.calls.at(-1)![0].value);
  });
  const set = jest.fn((_data: { value: unknown; updatedAt: Date }) => ({ where: updateWhere }));
  const update = jest.fn(() => ({ set }));
  const values = jest.fn(async (data: { key: string; value: unknown }) => {
    if (records.has(data.key)) throw new Error('synthetic duplicate settings key');
    records.set(data.key, data.value);
  });
  const insert = jest.fn(() => ({ values }));
  const api = loadTelemetry<typeof Store>('store.ts', {
    '@/lib/db/client': { db: { select, update, insert } },
    '@/lib/db/schema': { settings: table }, 'drizzle-orm': { eq },
  });
  return { api, records, where, from, select, update, set, updateWhere, insert, values };
}

beforeEach(() => jest.useFakeTimers().setSystemTime(now));
afterEach(() => jest.useRealTimers());

describe('telemetry settings persistence', () => {
  test('missing keys return undefined without creating or updating rows', async () => {
    const state = storage();
    expect(await state.api.readSetting('telemetry.missing')).toBeUndefined();
    expect(state.from).toHaveBeenCalledWith(table);
    expect(state.where).toHaveBeenCalledWith(eq(table.key, 'telemetry.missing'));
    expect(state.update).not.toHaveBeenCalled();
    expect(state.insert).not.toHaveBeenCalled();
  });

  test.each([false, 0, '', null, ['synthetic'], { value: 'synthetic' }])(
    'existing JSON values are returned without truthiness coercion: %j', async value => {
      const state = storage({ 'telemetry.fixture': value });
      expect(await state.api.readSetting('telemetry.fixture')).toEqual(value);
    },
  );

  test('new settings insert only the requested key and retain the supplied JSON value', async () => {
    const state = storage({ unrelated: 'preserve' });
    const value = { latest: '9.2.1', tags: ['synthetic'] };
    const before = structuredClone(value);
    await state.api.writeSetting('telemetry.fixture', value);
    expect(state.insert).toHaveBeenCalledWith(table);
    expect(state.values).toHaveBeenCalledWith({ key: 'telemetry.fixture', value });
    expect(state.update).not.toHaveBeenCalled();
    expect(await state.api.readSetting('telemetry.fixture')).toEqual(value);
    expect(state.records.get('unrelated')).toBe('preserve');
    expect(value).toEqual(before);
  });

  test('existing false settings update in place with the frozen modification time', async () => {
    const state = storage({ 'telemetry.enabled': false, unrelated: 'preserve' });
    await state.api.writeSetting('telemetry.enabled', true);
    expect(state.update).toHaveBeenCalledWith(table);
    expect(state.set).toHaveBeenCalledWith({ value: true, updatedAt: now });
    expect(state.updateWhere).toHaveBeenCalledWith(eq(table.key, 'telemetry.enabled'));
    expect(state.insert).not.toHaveBeenCalled();
    expect(state.records.get('unrelated')).toBe('preserve');
    expect(await state.api.readSetting<boolean>('telemetry.enabled')).toBe(true);
  });

  test('repeated writes take the insert then update paths and remain readable', async () => {
    const state = storage();
    await state.api.writeSetting('telemetry.latestVersion', '9.1.0');
    await state.api.writeSetting('telemetry.latestVersion', '9.2.0');
    expect(await state.api.readSetting<string>('telemetry.latestVersion')).toBe('9.2.0');
    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.records.size).toBe(1);
  });

  test('read failures are propagated and do not mutate records', async () => {
    const state = storage();
    state.where.mockRejectedValue(new Error('synthetic read failure'));
    await expect(state.api.readSetting('telemetry.fixture')).rejects.toThrow('synthetic read failure');
    expect(state.records.size).toBe(0);
  });

  test('failed existence checks prevent any write', async () => {
    const state = storage();
    state.where.mockRejectedValue(new Error('synthetic existence failure'));
    await expect(state.api.writeSetting('telemetry.fixture', 'value')).rejects.toThrow('synthetic existence failure');
    expect(state.insert).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  test('insert failures remain observable to callers', async () => {
    const state = storage();
    state.values.mockRejectedValue(new Error('synthetic insert failure'));
    await expect(state.api.writeSetting('telemetry.fixture', 'value')).rejects.toThrow('synthetic insert failure');
    expect(state.records.size).toBe(0);
  });

  test('update failures preserve the previously stored value', async () => {
    const state = storage({ 'telemetry.fixture': 'previous' });
    state.updateWhere.mockRejectedValue(new Error('synthetic update failure'));
    await expect(state.api.writeSetting('telemetry.fixture', 'next')).rejects.toThrow('synthetic update failure');
    expect(state.records.get('telemetry.fixture')).toBe('previous');
  });

  test.failing('KNOWN GAP: concurrent first writes are not atomic upserts and violate the unique settings key', async () => {
    const state = storage();
    const writes = await Promise.allSettled([
      state.api.writeSetting('telemetry.fixture', 'first'),
      state.api.writeSetting('telemetry.fixture', 'second'),
    ]);
    expect(state.values).toHaveBeenCalledTimes(2);
    expect(state.records.size).toBe(1);
    expect(writes.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  });
});

describe('per-install identity lifecycle', () => {
  function identity(readSetting = jest.fn(), writeSetting = jest.fn()) {
    const randomUUID = jest.fn(() => '00000000-0000-4000-8000-000000000001');
    const api = loadTelemetry<typeof Identity>('instanceId.ts', {
      'node:crypto': { randomUUID }, './constants': constants,
      './store': { readSetting, writeSetting },
    });
    return { api, readSetting, writeSetting, randomUUID };
  }

  test('persisted identity is reused without randomness or writes', async () => {
    const state = identity(jest.fn().mockResolvedValue('00000000-0000-4000-8000-000000000009'));
    expect(await state.api.getOrCreateInstanceId()).toBe('00000000-0000-4000-8000-000000000009');
    expect(state.readSetting).toHaveBeenCalledWith(constants.TELEMETRY_SETTING_KEYS.instanceId);
    expect(state.randomUUID).not.toHaveBeenCalled();
    expect(state.writeSetting).not.toHaveBeenCalled();
  });

  test.each([undefined, '', false, 17, { invalid: true }])('missing or non-string identity is replaced: %j', async stored => {
    const state = identity(jest.fn().mockResolvedValue(stored));
    expect(await state.api.getOrCreateInstanceId()).toBe('00000000-0000-4000-8000-000000000001');
    expect(state.randomUUID).toHaveBeenCalledTimes(1);
    expect(state.writeSetting).toHaveBeenCalledWith(
      constants.TELEMETRY_SETTING_KEYS.instanceId, '00000000-0000-4000-8000-000000000001',
    );
  });

  test('identity persists through the real store implementation and survives a new service instance', async () => {
    const state = storage();
    const first = identity(jest.fn(state.api.readSetting), jest.fn(state.api.writeSetting));
    const id = await first.api.getOrCreateInstanceId();
    const restarted = identity(jest.fn(state.api.readSetting), jest.fn(state.api.writeSetting));
    expect(await restarted.api.getOrCreateInstanceId()).toBe(id);
    expect(first.randomUUID).toHaveBeenCalledTimes(1);
    expect(restarted.randomUUID).not.toHaveBeenCalled();
    expect(state.records.get(constants.TELEMETRY_SETTING_KEYS.instanceId)).toBe(id);
    expect(state.values).toHaveBeenCalledTimes(1);
  });

  test('clearing the identity setting generates a fresh independent identifier', async () => {
    const state = storage();
    const instance = identity(jest.fn(state.api.readSetting), jest.fn(state.api.writeSetting));
    instance.randomUUID.mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    const oldId = await instance.api.getOrCreateInstanceId();
    state.records.delete(constants.TELEMETRY_SETTING_KEYS.instanceId);
    const newId = await instance.api.getOrCreateInstanceId();
    expect(newId).not.toBe(oldId);
    expect(state.records.get(constants.TELEMETRY_SETTING_KEYS.instanceId)).toBe(newId);
  });

  test('read failures prevent identity generation', async () => {
    const state = identity(jest.fn().mockRejectedValue(new Error('synthetic identity read failure')));
    await expect(state.api.getOrCreateInstanceId()).rejects.toThrow('synthetic identity read failure');
    expect(state.randomUUID).not.toHaveBeenCalled();
    expect(state.writeSetting).not.toHaveBeenCalled();
  });

  test('unpersisted identifiers are never returned after a write failure', async () => {
    const state = identity(jest.fn().mockResolvedValue(undefined), jest.fn().mockRejectedValue(new Error('synthetic identity write failure')));
    await expect(state.api.getOrCreateInstanceId()).rejects.toThrow('synthetic identity write failure');
    expect(state.randomUUID).toHaveBeenCalledTimes(1);
  });

  test('randomness failures propagate without writing an identity', async () => {
    const state = identity(jest.fn().mockResolvedValue(undefined));
    state.randomUUID.mockImplementation(() => { throw new Error('synthetic random failure'); });
    await expect(state.api.getOrCreateInstanceId()).rejects.toThrow('synthetic random failure');
    expect(state.writeSetting).not.toHaveBeenCalled();
  });
});
