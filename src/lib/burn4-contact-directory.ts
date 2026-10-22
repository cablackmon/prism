/** A display-only projection of caller-supplied contacts. No import or sync occurs. */
export const CONTACT_DIRECTORY_LIMITS = Object.freeze({
  sources: 16,
  contactsPerSource: 1000,
  contacts: 4000,
  channelsPerKind: 50,
  sourceId: 200,
  sourceLabel: 100,
  identity: 1000,
  text: 500,
  query: 200,
  textBudget: 1_000_000,
  pageSize: 20,
});

export type ContactDirectoryInputContact = {
  readonly identity: string;
  readonly displayName: string;
  readonly emails?: readonly string[];
  readonly phones?: readonly string[];
};

export type ContactDirectoryInputSource = {
  readonly schemaVersion: 1;
  readonly sourceId: string;
  readonly label: string;
  readonly complete: boolean;
  readonly contacts: readonly ContactDirectoryInputContact[];
};

export type ContactDirectoryRow = {
  readonly key: string;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly identity: string;
  readonly displayName: string;
  readonly emails: readonly string[];
  readonly phones: readonly string[];
};

export type ContactDirectoryModel = {
  readonly sources: readonly {
    readonly sourceId: string;
    readonly label: string;
    readonly complete: boolean;
  }[];
  readonly rows: readonly ContactDirectoryRow[];
};

export type ContactDirectoryPage = {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly start: number;
  readonly end: number;
  readonly rows: readonly ContactDirectoryRow[];
};

type ErrorCode = 'invalid_directory' | 'directory_limit' | 'duplicate_identity' |
  'invalid_query' | 'invalid_source_filter' | 'invalid_page';

export class ContactDirectoryError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'ContactDirectoryError';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function searchKey(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validate and copy only display fields. Original strings and distinct people stay intact. */
export function createContactDirectory(input: unknown): ContactDirectoryModel {
  const limits = CONTACT_DIRECTORY_LIMITS;
  if (!Array.isArray(input)) throw new ContactDirectoryError('invalid_directory');
  if (input.length > limits.sources) throw new ContactDirectoryError('directory_limit');
  let budget = 0;
  const text = (value: unknown, max: number, required = false): string => {
    if (typeof value !== 'string' || (required && !value.trim()) || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new ContactDirectoryError('invalid_directory');
    }
    budget += value.length;
    if (value.length > max || budget > limits.textBudget) throw new ContactDirectoryError('directory_limit');
    return value;
  };
  const channels = (value: unknown): readonly string[] => {
    if (value === undefined) return Object.freeze([]);
    if (!Array.isArray(value)) throw new ContactDirectoryError('invalid_directory');
    if (value.length > limits.channelsPerKind) throw new ContactDirectoryError('directory_limit');
    return Object.freeze(Array.from(value, (channel: unknown) => text(channel, limits.text)));
  };
  const sources: ContactDirectoryModel['sources'][number][] = [];
  const rows: ContactDirectoryRow[] = [];
  const sourceIds = new Set<string>();
  for (const raw of input as unknown[]) {
    if (!object(raw) || raw.schemaVersion !== 1 || typeof raw.complete !== 'boolean' || !Array.isArray(raw.contacts)) {
      throw new ContactDirectoryError('invalid_directory');
    }
    const sourceId = text(raw.sourceId, limits.sourceId, true);
    const label = text(raw.label, limits.sourceLabel, true);
    if (sourceIds.has(sourceId)) throw new ContactDirectoryError('duplicate_identity');
    sourceIds.add(sourceId);
    if (raw.contacts.length > limits.contactsPerSource || rows.length + raw.contacts.length > limits.contacts) {
      throw new ContactDirectoryError('directory_limit');
    }
    sources.push(Object.freeze({ sourceId, label, complete: raw.complete }));
    const identities = new Set<string>();
    for (const contact of raw.contacts as unknown[]) {
      if (!object(contact)) throw new ContactDirectoryError('invalid_directory');
      const identity = text(contact.identity, limits.identity, true);
      if (identities.has(identity)) throw new ContactDirectoryError('duplicate_identity');
      identities.add(identity);
      rows.push(Object.freeze({
        key: JSON.stringify([sourceId, identity]),
        sourceId,
        sourceLabel: label,
        identity,
        displayName: text(contact.displayName, limits.text),
        emails: channels(contact.emails),
        phones: channels(contact.phones),
      }));
    }
  }
  rows.sort((a, b) => compare(searchKey(a.displayName), searchKey(b.displayName)) ||
    compare(a.sourceId, b.sourceId) || compare(a.identity, b.identity));
  sources.sort((a, b) => compare(searchKey(a.label), searchKey(b.label)) || compare(a.sourceId, b.sourceId));
  return Object.freeze({ sources: Object.freeze(sources), rows: Object.freeze(rows) });
}

/** Literal field matching only. Phone digits help find formatted numbers, without country inference. */
export function searchContactDirectory(
  directory: ContactDirectoryModel,
  query: string,
  sourceId: string | null = null,
): readonly ContactDirectoryRow[] {
  if (typeof query !== 'string' || query.length > CONTACT_DIRECTORY_LIMITS.query) {
    throw new ContactDirectoryError('invalid_query');
  }
  if (sourceId !== null && !directory.sources.some((source) => source.sourceId === sourceId)) {
    throw new ContactDirectoryError('invalid_source_filter');
  }
  const key = searchKey(query.trim());
  const digits = key.replace(/[^0-9]/gu, '');
  const phoneQuery = digits.length > 0 && /^[+0-9\s().-]+$/u.test(key);
  return Object.freeze(directory.rows.filter((row) => (sourceId === null || row.sourceId === sourceId) &&
    (!key || searchKey(row.displayName).includes(key) || row.emails.some((email) => searchKey(email).includes(key)) ||
      row.phones.some((phone) => searchKey(phone).includes(key) || (phoneQuery && phone.replace(/[^0-9]/gu, '').includes(digits))))));
}

/** Zero-based pages clamp after snapshot shrink; every visible page contains at most 20 people. */
export function pageContactDirectory(rows: readonly ContactDirectoryRow[], requestedPage: number): ContactDirectoryPage {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 0) throw new ContactDirectoryError('invalid_page');
  const size = CONTACT_DIRECTORY_LIMITS.pageSize;
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(requestedPage, pageCount - 1);
  const offset = page * size;
  return Object.freeze({
    page,
    pageCount,
    total: rows.length,
    start: rows.length ? offset + 1 : 0,
    end: Math.min(offset + size, rows.length),
    rows: Object.freeze(rows.slice(offset, offset + size)),
  });
}
