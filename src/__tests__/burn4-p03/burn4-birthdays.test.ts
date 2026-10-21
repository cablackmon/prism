import { db } from '@/lib/db/client';
import { decrypt } from '@/lib/utils/crypto';
import { fetchCardDAVBirthdays } from '@/lib/integrations/carddav';
import { upsertBirthday } from '@/lib/services/birthday-merge';
import { syncCardDAVBirthdays } from '@/lib/services/carddav-birthday-sync';
import { birthday, BirthdayStore, source } from './burn4-store';

jest.mock('@/lib/db/client', () => {
  const { BirthdayStore } = jest.requireActual('./burn4-store') as typeof import('./burn4-store');
  return { db: new BirthdayStore() };
});
jest.mock('@/lib/utils/crypto', () => ({ decrypt: jest.fn() }));
jest.mock('@/lib/integrations/carddav', () => ({ fetchCardDAVBirthdays: jest.fn() }));

const store = db as unknown as BirthdayStore;
const mockDecrypt = jest.mocked(decrypt);
const mockFetch = jest.mocked(fetchCardDAVBirthdays);
const defaultInput = { name: 'Alex Doe', birthDate: '1992-04-09', source: 'caldav_contacts' };

beforeEach(() => {
  store.reset();
  jest.resetAllMocks();
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network call in offline coverage'));
  mockDecrypt.mockReturnValue('inert-decrypted-fixture');
  mockFetch.mockResolvedValue([]);
});

afterEach(() => jest.restoreAllMocks());

describe('birthday merge identity and persistence', () => {
  test('inserts an unmatched birthday with default event type and provenance', async () => {
    expect(await upsertBirthday(defaultInput)).toBe('inserted');
    expect(store.rows).toEqual([expect.objectContaining({ name: 'Alex Doe', birthDate: '1992-04-09',
      eventType: 'birthday', googleCalendarSource: 'caldav_contacts' })]);
    expect(store.writes).toHaveLength(1);
  });

  test.each(['anniversary', 'milestone'] as const)('keeps %s separate from birthday rows', async (eventType) => {
    store.rows.push(birthday());
    expect(await upsertBirthday({ ...defaultInput, eventType })).toBe('inserted');
    expect(store.rows.map((row) => row.eventType)).toEqual(['birthday', eventType]);
  });

  test.each(['', '1992', '1992-04', '-04-09', '1992--09', '1992-04-'])('skips incomplete date %j before database access', async (birthDate) => {
    expect(await upsertBirthday({ ...defaultInput, birthDate })).toBe('skipped');
    expect(store.reads).toEqual([]);
    expect(store.writes).toEqual([]);
  });

  test('matches case, punctuation, and repeated whitespace without rewriting the name', async () => {
    store.rows.push(birthday({ name: '  ALEX   D.o.e!  ' }));
    expect(await upsertBirthday(defaultInput)).toBe('skipped');
    expect(store.rows[0]?.name).toBe('  ALEX   D.o.e!  ');
    expect(store.writes).toEqual([]);
  });

  test('a provenance-only difference is a no-op', async () => {
    store.rows.push(birthday());
    expect(await upsertBirthday(defaultInput)).toBe('skipped');
    expect(store.rows[0]?.googleCalendarSource).toBe('calendar-alpha');
    expect(store.writes).toEqual([]);
  });

  test('upgrades the exact match sentinel year while retaining identity and user metadata', async () => {
    const original = birthday({ birthDate: '1904-04-09' });
    store.rows.push({ ...original });
    expect(await upsertBirthday(defaultInput)).toBe('updated');
    expect(store.rows).toEqual([{ ...original, birthDate: '1992-04-09', googleCalendarSource: 'caldav_contacts' }]);
    expect(store.writes[0]?.patch).toEqual({ birthDate: '1992-04-09', googleCalendarSource: 'caldav_contacts' });
  });

  test.each(['1904-04-09', '2000-04-09'])('preserves an existing real year against incoming %s', async (birthDate) => {
    store.rows.push(birthday());
    expect(await upsertBirthday({ ...defaultInput, birthDate })).toBe('skipped');
    expect(store.rows[0]?.birthDate).toBe('1992-04-09');
    expect(store.writes).toEqual([]);
  });

  test('promotes a shorter synced name and upgrades its unknown year', async () => {
    const original = birthday({ name: 'Alex', birthDate: '1904-04-09' });
    store.rows.push({ ...original });
    expect(await upsertBirthday(defaultInput)).toBe('updated');
    expect(store.rows).toEqual([{ ...original, name: 'Alex Doe', birthDate: '1992-04-09', googleCalendarSource: 'caldav_contacts' }]);
  });

  test('promotes a shorter name without replacing an existing known year', async () => {
    store.rows.push(birthday({ name: 'Alex', birthDate: '1985-04-09' }));
    expect(await upsertBirthday(defaultInput)).toBe('updated');
    expect(store.rows[0]).toMatchObject({ name: 'Alex Doe', birthDate: '1985-04-09' });
  });

  test('keeps the longer name and only fills its sentinel year', async () => {
    const original = birthday({ birthDate: '1904-04-09' });
    store.rows.push({ ...original });
    expect(await upsertBirthday({ ...defaultInput, name: 'Alex' })).toBe('updated');
    expect(store.rows).toEqual([{ ...original, birthDate: '1992-04-09' }]);
    expect(store.writes[0]?.patch).toEqual({ birthDate: '1992-04-09' });
  });

  test.each(['1992-04-09', '1904-04-09'])('a shorter incoming name with date %s cannot erase the full name', async (birthDate) => {
    store.rows.push(birthday());
    expect(await upsertBirthday({ ...defaultInput, name: 'Alex', birthDate })).toBe('skipped');
    expect(store.rows[0]?.name).toBe('Alex Doe');
    expect(store.writes).toEqual([]);
  });

  test('two unknown years on a shorter incoming name remain unchanged', async () => {
    store.rows.push(birthday({ birthDate: '1904-04-09' }));
    expect(await upsertBirthday({ ...defaultInput, name: 'Alex', birthDate: '1904-04-09' })).toBe('skipped');
    expect(store.writes).toEqual([]);
  });

  test('distinct surnames sharing a first name and birthday stay separate', async () => {
    store.rows.push(birthday({ name: 'Alex Smith' }));
    expect(await upsertBirthday(defaultInput)).toBe('inserted');
    expect(store.rows.map((row) => row.name)).toEqual(['Alex Smith', 'Alex Doe']);
  });

  test('a partial token does not merge Ann and Anna', async () => {
    store.rows.push(birthday({ name: 'Ann' }));
    expect(await upsertBirthday({ ...defaultInput, name: 'Anna Doe' })).toBe('inserted');
    expect(store.rows).toHaveLength(2);
  });

  test('finds a later matching candidate after an unrelated person', async () => {
    store.rows.push(birthday({ id: 'unrelated', name: 'Sam Smith' }), birthday({ name: 'Alex', birthDate: '1904-04-09' }));
    expect(await upsertBirthday(defaultInput)).toBe('updated');
    expect(store.rows[0]).toMatchObject({ id: 'unrelated', name: 'Sam Smith' });
    expect(store.rows[1]).toMatchObject({ name: 'Alex Doe', birthDate: '1992-04-09' });
  });

  test.each(['1992-05-09', '1992-04-10'])('does not prefix merge across month/day boundary %s', async (birthDate) => {
    store.rows.push(birthday({ name: 'Alex' }));
    expect(await upsertBirthday({ ...defaultInput, birthDate })).toBe('inserted');
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]?.name).toBe('Alex');
  });

  test('accepts a valid leap-day sentinel and upgrades it to a leap year', async () => {
    store.rows.push(birthday({ birthDate: '1904-02-29' }));
    expect(await upsertBirthday({ ...defaultInput, birthDate: '2000-02-29' })).toBe('updated');
    expect(store.rows[0]?.birthDate).toBe('2000-02-29');
  });

  test.each(['Alex', 'Alex Doe', 'Alex Doe Junior'])('a known-year hand-entered name %j is authoritative', async (name) => {
    const original = birthday({ name, googleCalendarSource: null });
    store.rows.push({ ...original });
    expect(await upsertBirthday({ ...defaultInput, birthDate: '2000-04-09' })).toBe('skipped');
    expect(store.rows).toEqual([original]);
    expect(store.writes).toEqual([]);
  });

  test('only the year may be filled on a matching hand-entered prefix', async () => {
    const original = birthday({ name: 'Alex', birthDate: '1904-04-09', googleCalendarSource: null });
    store.rows.push({ ...original });
    expect(await upsertBirthday(defaultInput)).toBe('updated');
    expect(store.rows).toEqual([{ ...original, birthDate: '1992-04-09' }]);
    expect(store.writes[0]?.patch).toEqual({ birthDate: '1992-04-09' });
  });

  test('a hand-entered unknown year is unchanged when the source year is unknown', async () => {
    store.rows.push(birthday({ googleCalendarSource: null, birthDate: '1904-04-09' }));
    expect(await upsertBirthday({ ...defaultInput, birthDate: '1904-04-09' })).toBe('skipped');
    expect(store.writes).toEqual([]);
  });

  test('a nonmatching hand-entered contact does not block insertion', async () => {
    const original = birthday({ name: 'Sam Smith', googleCalendarSource: null });
    store.rows.push({ ...original });
    expect(await upsertBirthday(defaultInput)).toBe('inserted');
    expect(store.rows[0]).toEqual(original);
  });

  test('repeated identical imports are idempotent', async () => {
    expect(await upsertBirthday(defaultInput)).toBe('inserted');
    expect(await upsertBirthday(defaultInput)).toBe('skipped');
    expect(store.rows).toHaveLength(1);
    expect(store.writes).toHaveLength(1);
  });

  test('propagates read failures without attempting a write', async () => {
    store.birthdayReadError = new Error('Synthetic read failure');
    await expect(upsertBirthday(defaultInput)).rejects.toThrow('Synthetic read failure');
    expect(store.writes).toEqual([]);
  });

  test.each(['insert', 'update'] as const)('propagates %s failures without changing persisted rows', async (operation) => {
    if (operation === 'update') store.rows.push(birthday({ birthDate: '1904-04-09' }));
    const before = store.rows.map((row) => ({ ...row }));
    store.writeError = new Error('Synthetic write failure');
    await expect(upsertBirthday(defaultInput)).rejects.toThrow('Synthetic write failure');
    expect(store.rows).toEqual(before);
    expect(store.writes).toEqual([]);
  });

  test.failing('KNOWN GAP: same-name date conflicts overwrite authoritative manual birthdays', async () => {
    const original = birthday({ birthDate: '1992-05-09', googleCalendarSource: null });
    store.rows.push({ ...original });
    await upsertBirthday(defaultInput);
    expect(store.rows).toEqual([original]);
  });

  test.failing('KNOWN GAP: non-ASCII names collapse to the same empty identity', async () => {
    const original = birthday({ name: '李明' });
    store.rows.push({ ...original });
    await upsertBirthday({ ...defaultInput, name: '王芳' });
    expect(store.rows.map((row) => row.name)).toEqual(['李明', '王芳']);
  });
});

describe('CardDAV account fan-out with real birthday merge', () => {
  test('an empty opt-in query performs no provider or persistence work', async () => {
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 0, errors: [] });
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });

  test('filters non-CardDAV and non-opted-in sources before provider calls', async () => {
    store.sources.push(source({ provider: 'google' }), source({ providerConfig: { contactBirthdaysEnabled: false } }), source({ providerConfig: null }), source());
    await syncCardDAVBirthdays();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://alpha.example.invalid', 'synthetic-account-alpha', 'inert-decrypted-fixture');
  });

  test('imports birthdays using CardDAV provenance without mutating the provider records', async () => {
    store.sources.push(source());
    const contacts = Object.freeze([Object.freeze({ name: 'Alex Doe', birthDate: '1992-04-09' })]);
    mockFetch.mockResolvedValue(contacts as unknown as { name: string; birthDate: string }[]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 1, errors: [] });
    expect(store.rows).toEqual([expect.objectContaining({ name: 'Alex Doe', birthDate: '1992-04-09', eventType: 'birthday', googleCalendarSource: 'caldav_contacts' })]);
    expect(contacts).toEqual([{ name: 'Alex Doe', birthDate: '1992-04-09' }]);
  });

  test('fetches each account once across duplicate calendar rows', async () => {
    store.sources.push(source(), source({ id: 'same-account-second-calendar' }));
    mockFetch.mockResolvedValue([{ name: 'Alex Doe', birthDate: '1992-04-09' }]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 1, errors: [] });
    expect(mockDecrypt).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('fans out by both server and username', async () => {
    store.sources.push(source(), source({ id: 'different-user', providerConfig: { contactBirthdaysEnabled: true, serverUrl: 'https://alpha.example.invalid', username: 'synthetic-account-beta' } }),
      source({ id: 'different-server', providerConfig: { contactBirthdaysEnabled: true, serverUrl: 'https://beta.example.invalid', username: 'synthetic-account-alpha' } }));
    mockFetch.mockResolvedValueOnce([{ name: 'Alex Doe', birthDate: '1992-04-09' }])
      .mockResolvedValueOnce([{ name: 'Sam Smith', birthDate: '1904-07-12' }])
      .mockResolvedValueOnce([{ name: 'Pat Lee', birthDate: '1980-11-03' }]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 3, errors: [] });
    expect(mockFetch.mock.calls.map(([server, username]) => [server, username])).toEqual([
      ['https://alpha.example.invalid', 'synthetic-account-alpha'],
      ['https://alpha.example.invalid', 'synthetic-account-beta'],
      ['https://beta.example.invalid', 'synthetic-account-alpha'],
    ]);
    expect(store.rows.map((row) => row.name)).toEqual(['Alex Doe', 'Sam Smith', 'Pat Lee']);
  });

  test.each(['serverUrl', 'username', 'accessToken'] as const)('reports missing %s and continues to a healthy account', async (missing) => {
    const broken = source({ id: 'broken' });
    if (missing === 'accessToken') broken.accessToken = null;
    else delete broken.providerConfig![missing];
    store.sources.push(broken, source());
    mockFetch.mockResolvedValue([{ name: 'Alex Doe', birthDate: '1992-04-09' }]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 1, errors: ['CardDAV sync: source row missing credentials'] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test.each(['error', 'string'] as const)('isolates a decrypt failure and continues other accounts: %s', async (kind) => {
    const failure = kind === 'error' ? new Error('Synthetic decrypt failure') : 'synthetic decrypt rejection';
    store.sources.push(source(), source({ id: 'second', providerConfig: { contactBirthdaysEnabled: true, serverUrl: 'https://beta.example.invalid', username: 'synthetic-account-beta' } }));
    mockDecrypt.mockImplementationOnce(() => { throw failure; }).mockReturnValue('inert-decrypted-fixture');
    mockFetch.mockResolvedValue([{ name: 'Sam Smith', birthDate: '1992-04-09' }]);
    const result = await syncCardDAVBirthdays();
    expect(result.synced).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('failed to decrypt password for synthetic-account-alpha');
    expect(result.errors[0]).toContain(failure instanceof Error ? failure.message : failure);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(store.rows[0]?.name).toBe('Sam Smith');
  });

  test.each(['error', 'string'] as const)('isolates a provider failure and continues other accounts: %s', async (kind) => {
    const failure = kind === 'error' ? new Error('Synthetic provider failure') : 'synthetic provider rejection';
    store.sources.push(source(), source({ id: 'second', providerConfig: { contactBirthdaysEnabled: true, serverUrl: 'https://beta.example.invalid', username: 'synthetic-account-beta' } }));
    mockFetch.mockRejectedValueOnce(failure).mockResolvedValueOnce([{ name: 'Sam Smith', birthDate: '1992-04-09' }]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 1, errors: [`CardDAV fetch failed for synthetic-account-alpha: ${failure instanceof Error ? failure.message : failure}`] });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(store.rows[0]?.name).toBe('Sam Smith');
  });

  test('a failed birthday write does not discard later contacts', async () => {
    store.sources.push(source());
    store.failingNames.add('Alex Doe');
    mockFetch.mockResolvedValue([{ name: 'Alex Doe', birthDate: '1992-04-09' }, { name: 'Sam Smith', birthDate: '1980-11-03' }]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 1, errors: ['Upsert failed for "Alex Doe": Synthetic birthday write failure'] });
    expect(store.rows.map((row) => row.name)).toEqual(['Sam Smith']);
  });

  test('formats a non-Error birthday persistence rejection and continues', async () => {
    store.sources.push(source());
    store.writeError = 'synthetic persistence rejection';
    mockFetch.mockResolvedValue([{ name: 'Alex Doe', birthDate: '1992-04-09' }]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 0, errors: ['Upsert failed for "Alex Doe": synthetic persistence rejection'] });
    expect(store.rows).toEqual([]);
  });

  test('counts a successfully processed duplicate while performing one actual insert', async () => {
    store.sources.push(source());
    mockFetch.mockResolvedValue([{ name: 'Alex Doe', birthDate: '1992-04-09' }, { name: 'Alex Doe', birthDate: '1992-04-09' }]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 2, errors: [] });
    expect(store.rows).toHaveLength(1);
    expect(store.writes).toHaveLength(1);
  });

  test('upgrades a prior calendar first name through the actual merge implementation', async () => {
    store.sources.push(source());
    store.rows.push(birthday({ name: 'Alex', birthDate: '1904-04-09' }));
    mockFetch.mockResolvedValue([{ name: 'Alex Doe', birthDate: '1992-04-09' }]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 1, errors: [] });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ name: 'Alex Doe', birthDate: '1992-04-09', googleCalendarSource: 'caldav_contacts' });
  });

  test('protects a manual same-day birthday during CardDAV import', async () => {
    store.sources.push(source());
    const original = birthday({ name: 'Alex', googleCalendarSource: null });
    store.rows.push({ ...original });
    mockFetch.mockResolvedValue([{ name: 'Alex Doe', birthDate: '2000-04-09' }]);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 1, errors: [] });
    expect(store.rows).toEqual([original]);
    expect(store.writes).toEqual([]);
  });

  test('propagates source query failures before contacting providers', async () => {
    store.sourceReadError = new Error('Synthetic source read failure');
    await expect(syncCardDAVBirthdays()).rejects.toThrow('Synthetic source read failure');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  test('separate invocations do not retain deduplication or error state', async () => {
    store.sources.push(source());
    mockFetch.mockRejectedValueOnce(new Error('Transient synthetic failure')).mockResolvedValueOnce([{ name: 'Alex Doe', birthDate: '1992-04-09' }]);
    expect((await syncCardDAVBirthdays()).errors).toHaveLength(1);
    expect(await syncCardDAVBirthdays()).toEqual({ synced: 1, errors: [] });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
