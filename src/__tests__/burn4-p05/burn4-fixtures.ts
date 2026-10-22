type Row = Record<string, unknown>;
type Condition = { kind: 'eq'; column: string; value: unknown };
type Table = { table: string };

export const fakeSchema = {
  recipeSources: { table: 'sources', id: 'sources.id' },
  userKrogerConnections: {
    table: 'kroger', userId: 'kroger.userId', tokenExpiresAt: 'kroger.tokenExpiresAt',
    preferredLocationId: 'kroger.preferredLocationId', preferredLocationName: 'kroger.preferredLocationName',
  },
};

export const fakeOrm = {
  eq: (column: string, value: unknown): Condition => ({ kind: 'eq', column, value }),
};

function matches(row: Row, condition: Condition): boolean {
  return row[condition.column.split('.')[1]!] === condition.value;
}

export function createDatabaseFake() {
  const tables: Record<string, Row[]> = { sources: [], kroger: [] };
  const failures: Record<string, Error | undefined> = {};
  const queries: Array<{ table: string; condition: Condition }> = [];
  const selectRows = (projection?: Record<string, string>) => ({
    from: (table: Table) => ({
      where: jest.fn(async (condition: Condition) => {
        queries.push({ table: table.table, condition });
        if (failures[table.table]) throw failures[table.table];
        const rows = tables[table.table]!.filter((row) => matches(row, condition));
        return projection ? rows.map((row) => Object.fromEntries(
          Object.entries(projection).map(([key, column]) => [key, row[column.split('.')[1]!]]),
        )) : rows;
      }),
    }),
  });
  const select = jest.fn(selectRows);
  return {
    select,
    tables,
    failures,
    queries,
    reset() {
      for (const key of Object.keys(tables)) tables[key] = [];
      for (const key of Object.keys(failures)) delete failures[key];
      queries.length = 0;
      select.mockReset().mockImplementation(selectRows);
    },
  };
}

export type DatabaseFake = ReturnType<typeof createDatabaseFake>;

export function sourceRow(provider = 'tandoor', id = 'source-a'): Row {
  return { id, provider, serverUrl: `https://${provider}.example.invalid`, accessToken: 'synthetic-sealed-value' };
}
