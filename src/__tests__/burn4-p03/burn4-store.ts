import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { birthdays } from '@/lib/db/schema';

export type BirthdayRow = {
  id: string;
  name: string;
  birthDate: string;
  eventType: string;
  googleCalendarSource: string | null;
  giftIdeas: string | null;
  userId: string | null;
  sendCardDaysBefore: number;
};

export type SourceRow = {
  id: string;
  provider: string;
  providerConfig: Record<string, unknown> | null;
  accessToken: string | null;
};

type BirthdayValues = Pick<BirthdayRow, 'name' | 'birthDate' | 'eventType' | 'googleCalendarSource'>;
type Patch = Partial<BirthdayValues>;
type RecordedQuery = { sql: string; params: unknown[] };

export function birthday(overrides: Partial<BirthdayRow> = {}): BirthdayRow {
  return {
    id: 'birthday-existing', name: 'Alex Doe', birthDate: '1992-04-09',
    eventType: 'birthday', googleCalendarSource: 'calendar-alpha',
    giftIdeas: 'A telescope', userId: 'member-synthetic', sendCardDaysBefore: 14,
    ...overrides,
  };
}

export function source(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 'source-alpha', provider: 'caldav',
    providerConfig: {
      contactBirthdaysEnabled: true, serverUrl: 'https://alpha.example.invalid',
      username: 'synthetic-account-alpha',
    },
    // These inert markers are consumed only by a mocked decrypt function.
    accessToken: 'inert-encrypted-fixture', ...overrides,
  };
}

/**
 * A deliberately narrow in-memory persistence adapter. It compiles real
 * Drizzle predicates with PgDialect and applies their parameters to fixtures.
 * Unsupported query shapes throw. Inserts enforce the actual name/event-type
 * conflict key, writes preserve unspecified columns, and reads return copies.
 * It does not emulate transactions, concurrent connections, or PostgreSQL dates.
 */
export class BirthdayStore {
  rows: BirthdayRow[] = [];
  sources: SourceRow[] = [];
  reads: RecordedQuery[] = [];
  writes: { operation: 'insert' | 'update' | 'conflict'; id: string; patch: Patch }[] = [];
  birthdayReadError: unknown;
  sourceReadError: unknown;
  writeError: unknown;
  failingNames = new Set<string>();
  private dialect = new PgDialect();

  reset() {
    this.rows = [];
    this.sources = [];
    this.reads = [];
    this.writes = [];
    this.birthdayReadError = undefined;
    this.sourceReadError = undefined;
    this.writeError = undefined;
    this.failingNames.clear();
  }

  private compile(where: SQL | undefined): RecordedQuery {
    if (!where) throw new Error('Fake requires a WHERE predicate');
    const query = this.dialect.sqlToQuery(where);
    const recorded = { sql: query.sql, params: query.params as unknown[] };
    this.reads.push(recorded);
    return recorded;
  }

  query = {
    birthdays: {
      findMany: async ({ where }: { where?: SQL }) => {
        if (this.birthdayReadError) throw this.birthdayReadError;
        const query = this.compile(where);
        if (!query.sql.includes('EXTRACT(MONTH') || !query.sql.includes('EXTRACT(DAY') ||
            !query.sql.includes('"event_type"') || query.params.length !== 3) {
          throw new Error('Unsupported fake birthday predicate');
        }
        const [eventType, month, day] = query.params;
        return this.rows.filter((row) => {
          const parts = row.birthDate.split('-');
          return row.eventType === eventType && Number(parts[1]) === month && Number(parts[2]) === day;
        }).map((row) => ({ ...row }));
      },
    },
    calendarSources: {
      findMany: async ({ where }: { where?: SQL }) => {
        if (this.sourceReadError) throw this.sourceReadError;
        const query = this.compile(where);
        if (!query.sql.includes('contactBirthdaysEnabled') || !query.sql.includes('"provider"') ||
            query.params.length !== 1) {
          throw new Error('Unsupported fake source predicate');
        }
        return this.sources.filter((row) => {
          const flag = row.providerConfig?.contactBirthdaysEnabled;
          return row.provider === query.params[0] && (flag === true || flag === 'true');
        }).map((row) => ({ ...row, providerConfig: row.providerConfig && { ...row.providerConfig } }));
      },
    },
  };

  update(table: unknown) {
    if (table !== birthdays) throw new Error('Unexpected fake update table');
    return {
      set: (patch: Patch) => ({
        where: async (where: SQL) => {
          if (this.writeError) throw this.writeError;
          const query = this.compile(where);
          if (!query.sql.includes('"id"') || query.params.length !== 1) {
            throw new Error('Unsupported fake update predicate');
          }
          const row = this.rows.find((candidate) => candidate.id === query.params[0]);
          if (!row) throw new Error('Fake update row not found');
          if (this.failingNames.has(row.name)) throw new Error('Synthetic birthday write failure');
          this.writes.push({ operation: 'update', id: row.id, patch: { ...patch } });
          Object.assign(row, patch);
        },
      }),
    };
  }

  insert(table: unknown) {
    if (table !== birthdays) throw new Error('Unexpected fake insert table');
    return {
      values: (values: BirthdayValues) => ({
        onConflictDoUpdate: async ({ target, set }: { target: unknown[]; set: Patch }) => {
          if (target.length !== 2 || target[0] !== birthdays.name || target[1] !== birthdays.eventType) {
            throw new Error('Unexpected fake conflict key');
          }
          if (this.writeError) throw this.writeError;
          if (this.failingNames.has(values.name)) throw new Error('Synthetic birthday write failure');
          const existing = this.rows.find((row) => row.name === values.name && row.eventType === values.eventType);
          if (existing) {
            this.writes.push({ operation: 'conflict', id: existing.id, patch: { ...set } });
            Object.assign(existing, set);
          } else {
            const row = birthday({
              ...values, id: `birthday-new-${this.rows.length + 1}`,
              giftIdeas: null, userId: null, sendCardDaysBefore: 7,
            });
            this.rows.push(row);
            this.writes.push({ operation: 'insert', id: row.id, patch: { ...values } });
          }
        },
      }),
    };
  }
}
