import {
  CONTACT_DIRECTORY_LIMITS as limits,
  ContactDirectoryError,
  createContactDirectory,
  pageContactDirectory,
  searchContactDirectory,
  type ContactDirectoryInputContact,
  type ContactDirectoryInputSource,
} from '../../lib/burn4-contact-directory';

function contact(overrides: Partial<ContactDirectoryInputContact> = {}): ContactDirectoryInputContact {
  return { identity: 'person-1', displayName: 'Alex Example', emails: ['Alex@example.invalid'], phones: ['+1 (555) 010-1234'], ...overrides };
}
function source(overrides: Partial<ContactDirectoryInputSource> = {}): ContactDirectoryInputSource {
  return { schemaVersion: 1, sourceId: 'book-a', label: 'Household', complete: true, contacts: [contact()], ...overrides };
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('read-only contacts display model', () => {
  test('projects only public display fields without reading unsupported metadata', () => {
    const input = [{ ...source(), contacts: [{ ...contact(), get photo() { throw new Error('unsupported property read'); }, notes: 'Private synthetic note' }] }];
    const directory = createContactDirectory(input);
    expect(directory).toEqual({
      sources: [{ sourceId: 'book-a', label: 'Household', complete: true }],
      rows: [{ key: '["book-a","person-1"]', sourceId: 'book-a', sourceLabel: 'Household', identity: 'person-1', displayName: 'Alex Example', emails: ['Alex@example.invalid'], phones: ['+1 (555) 010-1234'] }],
    });
    expect(JSON.stringify(directory)).not.toContain('Private synthetic note');
  });

  test('preserves spelling, whitespace, Unicode, repeated channels and empty channels', () => {
    const original = contact({ displayName: '  E\u0301loise  ', emails: [' HOME@example.invalid ', '', ' HOME@example.invalid '], phones: [' 555 010 ', ''] });
    const row = createContactDirectory([source({ contacts: [original] })]).rows[0];
    expect(row?.displayName).toBe(original.displayName);
    expect(row?.emails).toEqual(original.emails);
    expect(row?.phones).toEqual(original.phones);
  });

  test('supports unnamed contacts and missing optional channels without inventing values', () => {
    const row = createContactDirectory([source({ contacts: [{ identity: 'unnamed', displayName: '' }] })]).rows[0];
    expect(row?.displayName).toBe('');
    expect(row?.emails).toEqual([]);
    expect(row?.phones).toEqual([]);
  });

  test('does not coalesce separate people with shared names and channels', () => {
    const directory = createContactDirectory([source({ contacts: [contact(), contact({ identity: 'person-2' })] }), source({ sourceId: 'book-b' })]);
    expect(directory.rows.map((row) => row.key)).toEqual(['["book-a","person-1"]', '["book-a","person-2"]', '["book-b","person-1"]']);
  });

  test('encodes source-scoped keys without delimiter collisions', () => {
    const directory = createContactDirectory([source({ sourceId: 'a:b', contacts: [contact({ identity: 'c' })] }), source({ sourceId: 'a', contacts: [contact({ identity: 'b:c' })] })]);
    expect(new Set(directory.rows.map((row) => row.key)).size).toBe(2);
  });

  test('copies and freezes the entire allowlisted projection while leaving frozen input untouched', () => {
    const input = deepFreeze([source()]);
    const before = JSON.stringify(input);
    const directory = createContactDirectory(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(directory.rows[0]?.emails).not.toBe(input[0]?.contacts[0]?.emails);
    expect([directory, directory.sources, directory.sources[0], directory.rows, directory.rows[0], directory.rows[0]?.emails, directory.rows[0]?.phones].every(Object.isFrozen)).toBe(true);
  });

  test('sorts names and source labels deterministically without locale or input-order dependence', () => {
    const a = source({ sourceId: 'a', label: 'Zulu', contacts: [contact({ identity: 'z', displayName: 'zoe' }), contact({ identity: 'b', displayName: 'ALex' }), contact({ identity: 'a', displayName: 'alex' })] });
    const b = source({ sourceId: 'b', label: 'alpha', contacts: [contact({ displayName: 'alex' })] });
    const forward = createContactDirectory([a, b]);
    const backward = createContactDirectory([{ ...b, contacts: [...b.contacts].reverse() }, { ...a, contacts: [...a.contacts].reverse() }]);
    expect(forward).toEqual(backward);
    expect(forward.rows.map((row) => [row.sourceId, row.identity])).toEqual([['a', 'a'], ['a', 'b'], ['b', 'person-1'], ['a', 'z']]);
    expect(forward.sources.map((book) => book.sourceId)).toEqual(['b', 'a']);
  });

  test('keeps source completeness explicit, including empty sources', () => {
    const directory = createContactDirectory([source({ complete: false, contacts: [] })]);
    expect(directory.sources[0]?.complete).toBe(false);
    expect(directory.rows).toEqual([]);
    expect(createContactDirectory([])).toEqual({ sources: [], rows: [] });
  });

  test.each([
    ['non-array', null],
    ['array source', [[]]],
    ['unsupported schema', [{ ...source(), schemaVersion: 2 }]],
    ['missing completeness', [{ ...source(), complete: undefined }]],
    ['missing contacts', [{ ...source(), contacts: undefined }]],
    ['blank source ID', [{ ...source(), sourceId: ' ' }]],
    ['blank label', [{ ...source(), label: '' }]],
    ['missing identity', [{ ...source(), contacts: [{ displayName: 'Nobody' }] }]],
    ['null display name', [{ ...source(), contacts: [{ ...contact(), displayName: null }] }]],
    ['control characters', [{ ...source(), contacts: [contact({ displayName: 'Alex\nExample' })] }]],
    ['null channels', [{ ...source(), contacts: [{ ...contact(), emails: null }] }]],
    ['non-string channel', [{ ...source(), contacts: [{ ...contact(), phones: [false] }] }]],
    ['sparse contact array', [{ ...source(), contacts: Array(1) }]],
    ['sparse channel array', [{ ...source(), contacts: [{ ...contact(), emails: Array(1) }] }]],
  ] as const)('rejects %s without accepting a partial directory', (_label, input) => {
    expect(() => createContactDirectory(input)).toThrow(new ContactDirectoryError('invalid_directory'));
  });

  test.each([
    ['duplicate source', [source(), source()]],
    ['duplicate person within a source', [source({ contacts: [contact(), contact()] })]],
  ] as const)('rejects %s even when the display data is identical', (_label, input) => {
    expect(() => createContactDirectory(input)).toThrow(new ContactDirectoryError('duplicate_identity'));
  });

  test('enforces source and per-source contact counts before scanning fields', () => {
    expect(() => createContactDirectory(Array(limits.sources + 1).fill(source()))).toThrow(new ContactDirectoryError('directory_limit'));
    const contacts = Array.from({ length: limits.contactsPerSource + 1 }, (_, index) => contact({ identity: String(index) }));
    expect(() => createContactDirectory([source({ contacts })])).toThrow(new ContactDirectoryError('directory_limit'));
    expect(createContactDirectory(Array.from({ length: limits.sources }, (_, i) => source({ sourceId: String(i), contacts: [] }))).sources).toHaveLength(limits.sources);
  });

  test('enforces the total contact budget across individually valid sources', () => {
    const contacts = Array.from({ length: limits.contactsPerSource }, (_, index) => contact({ identity: String(index), emails: [], phones: [] }));
    const books = Array.from({ length: 4 }, (_, index) => source({ sourceId: String(index), contacts }));
    expect(createContactDirectory(books).rows).toHaveLength(limits.contacts);
    expect(() => createContactDirectory([...books, source()])).toThrow(new ContactDirectoryError('directory_limit'));
  });

  test('enforces channel count and text length while accepting the exact field boundaries', () => {
    const row = contact({ displayName: 'x'.repeat(limits.text), emails: Array(limits.channelsPerKind).fill('x'.repeat(limits.text)), phones: [] });
    expect(createContactDirectory([source({ contacts: [row] })]).rows[0]?.emails).toHaveLength(limits.channelsPerKind);
    expect(() => createContactDirectory([source({ contacts: [{ ...row, emails: [...row.emails ?? [], 'extra'] }] })])).toThrow(new ContactDirectoryError('directory_limit'));
    expect(() => createContactDirectory([source({ contacts: [contact({ displayName: 'x'.repeat(limits.text + 1) })] })])).toThrow(new ContactDirectoryError('directory_limit'));
    expect(() => createContactDirectory([source({ sourceId: 'x'.repeat(limits.sourceId + 1) })])).toThrow(new ContactDirectoryError('directory_limit'));
    expect(() => createContactDirectory([source({ label: 'x'.repeat(limits.sourceLabel + 1) })])).toThrow(new ContactDirectoryError('directory_limit'));
    expect(() => createContactDirectory([source({ contacts: [contact({ identity: 'x'.repeat(limits.identity + 1) })] })])).toThrow(new ContactDirectoryError('directory_limit'));
  });

  test('rejects aggregate supported text over budget using small repeated synthetic values', () => {
    const channels = Array(limits.channelsPerKind).fill('x'.repeat(limits.text));
    const contacts = Array.from({ length: 21 }, (_, index) => contact({ identity: String(index), emails: channels, phones: channels }));
    expect(() => createContactDirectory([source({ contacts })])).toThrow(new ContactDirectoryError('directory_limit'));
  });

  test('errors contain an allowlisted code and no supplied contact text', () => {
    try {
      createContactDirectory([{ ...source(), contacts: [{ ...contact(), emails: 'Synthetic private channel' }] }]);
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ContactDirectoryError);
      expect(error instanceof ContactDirectoryError && error.code).toBe('invalid_directory');
      expect(String(error)).not.toContain('Synthetic private channel');
    }
  });
});

describe('literal directory searching and bounded pages', () => {
  const directory = createContactDirectory([
    source({ contacts: [contact(), contact({ identity: 'unicode', displayName: 'E\u0301loise Example', emails: ['other@example.invalid'], phones: ['555.010.9000'] })] }),
    source({ sourceId: 'book-b', contacts: [contact({ identity: 'b', displayName: 'Taylor Test', emails: ['Taylor@example.invalid'], phones: ['(555) 020-2345'] })] }),
  ]);

  test.each([
    ['alex', ['person-1']],
    [' ALEX@EXAMPLE.INVALID ', ['person-1']],
    ['ÉLOISE', ['unicode']],
    ['5550101234', ['person-1']],
    ['(555) 020', ['b']],
    ['555.010.9000', ['unicode']],
    ['[.*]', []],
    ['letters5550101234', []],
    ['unmatched', []],
  ])('finds %s only in the intended literal fields', (query, expected) => {
    expect(searchContactDirectory(directory, query).map((row) => row.identity)).toEqual(expected);
  });

  test('empty search restores contacts and source filter stays source-scoped', () => {
    expect(searchContactDirectory(directory, '').length).toBe(3);
    expect(searchContactDirectory(directory, '  ').length).toBe(3);
    expect(searchContactDirectory(directory, '', 'book-b').map((row) => row.identity)).toEqual(['b']);
    expect(searchContactDirectory(directory, 'alex', 'book-b')).toEqual([]);
    expect(() => searchContactDirectory(directory, '', 'missing')).toThrow(new ContactDirectoryError('invalid_source_filter'));
  });

  test('source IDs resembling filter names or object properties stay ordinary exact IDs', () => {
    const model = createContactDirectory(['all', 'unassigned', '__proto__', 'constructor'].map((sourceId) => source({ sourceId })));
    for (const sourceId of ['all', 'unassigned', '__proto__', 'constructor']) {
      expect(searchContactDirectory(model, '', sourceId).map((row) => row.sourceId)).toEqual([sourceId]);
    }
    expect(searchContactDirectory(model, '', null)).toHaveLength(4);
  });

  test('search excludes source labels, IDs and unsupported contact metadata', () => {
    expect(searchContactDirectory(directory, 'Household')).toEqual([]);
    expect(searchContactDirectory(directory, 'person-1')).toEqual([]);
  });

  test('validates direct queries and freezes search results', () => {
    expect(() => searchContactDirectory(directory, 'x'.repeat(limits.query + 1))).toThrow(new ContactDirectoryError('invalid_query'));
    expect(Object.isFrozen(searchContactDirectory(directory, 'x'.repeat(limits.query)))).toBe(true);
  });

  test('pages 41 contacts as 20, 20 and 1 without changing input rows', () => {
    const model = createContactDirectory([source({ contacts: Array.from({ length: 41 }, (_, i) => contact({ identity: String(i), displayName: String(i).padStart(2, '0') })) })]);
    const pages = [0, 1, 2].map((index) => pageContactDirectory(model.rows, index));
    expect(pages.map((page) => [page.start, page.end, page.rows.length, page.pageCount])).toEqual([[1, 20, 20, 3], [21, 40, 20, 3], [41, 41, 1, 3]]);
    expect(pages.flatMap((page) => page.rows)).toEqual(model.rows);
    expect(new Set(pages.flatMap((page) => page.rows.map((row) => row.key))).size).toBe(41);
    expect(Object.isFrozen(pages[0])).toBe(true);
    expect(Object.isFrozen(pages[0]?.rows)).toBe(true);
  });

  test('clamps a stale page after shrink and represents an empty list without negative bounds', () => {
    expect(pageContactDirectory(directory.rows, 999)).toMatchObject({ page: 0, pageCount: 1, total: 3, start: 1, end: 3 });
    expect(pageContactDirectory([], 99)).toEqual({ page: 0, pageCount: 1, total: 0, start: 0, end: 0, rows: [] });
  });

  test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid page %s', (page) => {
    expect(() => pageContactDirectory(directory.rows, page)).toThrow(new ContactDirectoryError('invalid_page'));
  });
});
