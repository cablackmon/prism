/** @jest-environment node */

import {
  PGlite,
  accountTables,
  insertSource,
  migrate,
  migrationNames,
  resetFixtures,
  source,
} from './burn4-calendar-fixture';
import type { JsonObject } from './burn4-calendar-fixture';

jest.setTimeout(60_000);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
});

beforeEach(async () => {
  await resetFixtures(db);
});

afterAll(async () => {
  await db.close();
});

describe('0011 CalDAV provider configuration transfer', () => {
  const transferable: Array<[string, unknown]> = [
    ['serverUrl', 'https://calendar.example.invalid'],
    ['supportsEvents', false],
    ['supportsTasks', true],
    ['taskListId', 'synthetic-task-list'],
    ['contactBirthdaysEnabled', false],
  ];

  test.each(transferable)('moves %s while retaining error metadata', async (key, value) => {
    await insertSource(db, {
      syncErrors: { [key]: value, lastError: 'fixture issue', diagnosticCount: 2 },
    });

    await migrate(db, '0011_calendar_provider_config.sql');

    expect(await source(db)).toMatchObject({
      provider_config: { [key]: value },
      sync_errors: { lastError: 'fixture issue', diagnosticCount: 2 },
    });
  });

  test('copies a non-secret authentication mode when another config key triggers transfer', async () => {
    await insertSource(db, {
      syncErrors: {
        authMethod: 'basic',
        supportsEvents: true,
        lastError: 'fixture issue',
      },
    });

    await migrate(db, '0011_calendar_provider_config.sql');

    expect(await source(db)).toMatchObject({
      provider_config: { authMethod: 'basic', supportsEvents: true },
      sync_errors: { lastError: 'fixture issue' },
    });
  });

  test('retains all non-sensitive config values together and preserves unknown error keys', async () => {
    const configuration = Object.fromEntries(transferable);
    await insertSource(db, {
      syncErrors: { ...configuration, authMethod: 'basic', nestedError: { retry: false } },
    });

    await migrate(db, '0011_calendar_provider_config.sql');

    expect(await source(db)).toMatchObject({
      provider_config: { ...configuration, authMethod: 'basic' },
      sync_errors: { nestedError: { retry: false } },
    });
  });

  test('omits JSON null config values without losing false booleans', async () => {
    await insertSource(db, {
      syncErrors: {
        serverUrl: null,
        supportsEvents: false,
        taskListId: null,
        lastError: null,
      },
    });

    await migrate(db, '0011_calendar_provider_config.sql');

    expect(await source(db)).toMatchObject({
      provider_config: { supportsEvents: false },
      sync_errors: { lastError: null },
    });
  });

  test.each(['google', 'ical'])('does not rewrite %s provider error metadata', async (provider) => {
    const errors = { supportsEvents: true, authMethod: 'fixture-mode', lastError: 'fixture issue' };
    await insertSource(db, { provider, syncErrors: errors });

    await migrate(db, '0011_calendar_provider_config.sql');

    expect(await source(db)).toMatchObject({ provider_config: null, sync_errors: errors });
  });

  test.each<JsonObject | null>([null, {}, { lastError: 'fixture issue', retry: false }])(
    'leaves a source with no known config keys unchanged: %j',
    async (syncErrors) => {
      await insertSource(db, { syncErrors });

      await migrate(db, '0011_calendar_provider_config.sql');

      expect(await source(db)).toMatchObject({ provider_config: null, sync_errors: syncErrors });
    },
  );

  test('preserves already migrated configuration and error state on replay', async () => {
    await insertSource(db, {
      syncErrors: {
        serverUrl: 'https://calendar.example.invalid',
        supportsTasks: false,
        lastError: 'fixture issue',
      },
    });
    await migrate(db, '0011_calendar_provider_config.sql');
    const before = await source(db);

    await migrate(db, '0011_calendar_provider_config.sql');
    await migrate(db, '0011_calendar_provider_config.sql');

    expect(await source(db)).toEqual(before);
  });

  test('treats an existing config object as authoritative and cleans residual legacy keys', async () => {
    await db.exec('ALTER TABLE calendar_sources ADD COLUMN provider_config jsonb');
    await insertSource(db, {
      syncErrors: {
        supportsEvents: true,
        serverUrl: 'https://legacy.example.invalid',
        lastError: 'fixture issue',
      },
    });
    const existing = { serverUrl: 'https://current.example.invalid', customFlag: false };
    await db.query('UPDATE calendar_sources SET provider_config = $1::jsonb', [JSON.stringify(existing)]);

    await migrate(db, '0011_calendar_provider_config.sql');

    expect(await source(db)).toMatchObject({
      provider_config: existing,
      sync_errors: { lastError: 'fixture issue' },
    });
  });

  test('preserves a non-null empty config during replay cleanup', async () => {
    await db.exec('ALTER TABLE calendar_sources ADD COLUMN provider_config jsonb');
    await insertSource(db, { syncErrors: { supportsTasks: false, lastError: 'fixture issue' } });
    await db.query('UPDATE calendar_sources SET provider_config = $1::jsonb', ['{}']);

    await migrate(db, '0011_calendar_provider_config.sql');

    expect(await source(db)).toMatchObject({
      provider_config: {},
      sync_errors: { lastError: 'fixture issue' },
    });
  });

  test.failing('KNOWN GAP: authMethod-only legacy config is erased without being copied', async () => {
    await insertSource(db, {
      syncErrors: { authMethod: 'basic', lastError: 'fixture issue' },
    });

    await migrate(db, '0011_calendar_provider_config.sql');
    const row = await source(db);

    // Prove the SQL completed and the cleanup branch ran before checking data loss.
    expect(row.sync_errors).toEqual({ lastError: 'fixture issue' });
    expect(row.provider_config).toEqual({ authMethod: 'basic' });
  });
});

describe('0009 iCal source metadata', () => {
  test('backfills null without changing existing source metadata', async () => {
    await insertSource(db, { provider: 'ical', displayName: 'Fixture calendar' });

    await migrate(db, '0009_calendar_ical_url.sql');

    const result = await db.query<{ display_name: string; ical_url: string | null }>(
      'SELECT display_name, ical_url FROM calendar_sources WHERE id = 1',
    );
    expect(result.rows).toEqual([{ display_name: 'Fixture calendar', ical_url: null }]);
  });

  test('accepts long subscription metadata and preserves it across replay', async () => {
    await insertSource(db, { provider: 'ical' });
    await migrate(db, '0009_calendar_ical_url.sql');
    const url = `https://calendar.example.invalid/${'calendar-segment/'.repeat(100)}`;
    await db.query('UPDATE calendar_sources SET ical_url = $1 WHERE id = 1', [url]);

    await migrate(db, '0009_calendar_ical_url.sql');

    expect((await db.query<{ ical_url: string }>('SELECT ical_url FROM calendar_sources')).rows)
      .toEqual([{ ical_url: url }]);
  });

  test('retains an already existing nullable subscription column', async () => {
    await db.exec('ALTER TABLE calendar_sources ADD COLUMN ical_url text');
    await insertSource(db, { provider: 'ical' });
    await db.query('UPDATE calendar_sources SET ical_url = $1', ['https://calendar.example.invalid/feed.ics']);

    await migrate(db, '0009_calendar_ical_url.sql');
    await db.query('INSERT INTO calendar_sources (id, provider) VALUES (2, $1)', ['ical']);

    expect((await db.query<{ id: number; ical_url: string | null }>(
      'SELECT id, ical_url FROM calendar_sources ORDER BY id',
    )).rows).toEqual([
      { id: 1, ical_url: 'https://calendar.example.invalid/feed.ics' },
      { id: 2, ical_url: null },
    ]);
  });
});

describe('0013 integration account labels', () => {
  test.each(accountTables)('%s preserves old rows, nullable defaults and 320-character labels', async (table) => {
    if (table === 'calendar_sources') {
      await insertSource(db, { displayName: 'Fixture source' });
    } else {
      await db.query(`INSERT INTO ${table} (id, marker) VALUES (1, $1)`, ['fixture marker']);
    }

    await migrate(db, '0013_integrations_account_email.sql');
    expect((await db.query<{ account_email: string | null }>(`SELECT account_email FROM ${table}`)).rows)
      .toEqual([{ account_email: null }]);
    const label = `${'x'.repeat(308)}@example.com`;
    expect(label).toHaveLength(320);
    await db.query(`UPDATE ${table} SET account_email = $1 WHERE id = 1`, [label]);

    await migrate(db, '0013_integrations_account_email.sql');

    const expectedMarker = table === 'calendar_sources' ? 'Fixture source' : 'fixture marker';
    const markerColumn = table === 'calendar_sources' ? 'display_name' : 'marker';
    expect((await db.query<{ account_email: string; marker: string }>(
      `SELECT account_email, ${markerColumn} AS marker FROM ${table} WHERE id = 1`,
    )).rows).toEqual([{ account_email: label, marker: expectedMarker }]);
    await expect(db.query(`UPDATE ${table} SET account_email = $1`, [`x${label}`]))
      .rejects.toMatchObject({ code: '22001' });
  });

  test('handles a partially upgraded install without replacing earlier account labels', async () => {
    await db.exec('ALTER TABLE task_sources ADD COLUMN account_email varchar(320)');
    await db.query('INSERT INTO task_sources (id, account_email) VALUES (1, $1)', ['fixture@example.com']);

    await migrate(db, '0013_integrations_account_email.sql');

    expect((await db.query<{ account_email: string }>('SELECT account_email FROM task_sources')).rows)
      .toEqual([{ account_email: 'fixture@example.com' }]);
    await insertSource(db);
    expect((await db.query<{ account_email: string | null }>('SELECT account_email FROM calendar_sources')).rows)
      .toEqual([{ account_email: null }]);
  });
});

describe('0019 household Family group classification', () => {
  const groupCases: Array<[string, string, string | null, string]> = [
    ['custom', 'Family', null, 'family'],
    ['custom', 'family', null, 'custom'],
    ['custom', 'Family ', null, 'custom'],
    ['custom', 'Other', null, 'custom'],
    ['custom', 'Family', '00000000-0000-4000-8000-000000000001', 'custom'],
    ['user', 'Family', null, 'user'],
    ['family', 'Family', null, 'family'],
  ];

  test.each(groupCases)('scopes type=%s name=%j user=%j to %s', async (type, name, userId, expectedType) => {
    await db.query(
      'INSERT INTO calendar_groups (id, type, name, user_id, marker) VALUES (1, $1, $2, $3, $4)',
      [type, name, userId, 'retained marker'],
    );

    await migrate(db, '0019_family_group_type.sql');
    await migrate(db, '0019_family_group_type.sql');

    expect((await db.query<{ type: string; name: string; user_id: string | null; marker: string }>(
      'SELECT type, name, user_id, marker FROM calendar_groups',
    )).rows).toEqual([{ type: expectedType, name, user_id: userId, marker: 'retained marker' }]);
  });

  test('classifies every exact seed-shaped group without renaming or deleting any row', async () => {
    await db.query(
      `INSERT INTO calendar_groups (id, type, name, user_id, marker) VALUES
       (1, 'custom', 'Family', NULL, 'first'),
       (2, 'custom', 'Family', NULL, 'second'),
       (3, 'custom', 'Unrelated', NULL, 'third')`,
    );

    await migrate(db, '0019_family_group_type.sql');

    expect((await db.query<{ id: number; type: string; marker: string }>(
      'SELECT id, type, marker FROM calendar_groups ORDER BY id',
    )).rows).toEqual([
      { id: 1, type: 'family', marker: 'first' },
      { id: 2, type: 'family', marker: 'second' },
      { id: 3, type: 'custom', marker: 'third' },
    ]);
  });
});

describe('0023 legacy life-event calendar flags', () => {
  beforeEach(async () => {
    await migrate(db, '0011_calendar_provider_config.sql');
  });

  test.each([
    ['display name', 'display_name', 'Old FRIENDS calendar'],
    ['dashboard name', 'dashboard_calendar_name', 'friends and family'],
    ['Google contacts identifier', 'source_calendar_id', 'person#addressbook#contacts@example.invalid'],
  ])('recognizes %s and preserves other config and errors', async (_name, column, value) => {
    await insertSource(db, { syncErrors: { lastError: 'fixture issue' } });
    await db.query(`UPDATE calendar_sources SET ${column} = $1, provider_config = $2::jsonb`, [
      value, JSON.stringify({ supportsEvents: false, custom: 'retained' }),
    ]);

    await migrate(db, '0023_dismissed_birthdays.sql');

    expect(await source(db)).toMatchObject({
      provider_config: { supportsEvents: false, custom: 'retained', lifeEventsCalendar: true },
      sync_errors: { lastError: 'fixture issue' },
    });
  });

  test.each([true, false])('preserves explicit lifeEventsCalendar=%s on a matching legacy source', async (flag) => {
    await insertSource(db, { displayName: 'Friends' });
    await db.query('UPDATE calendar_sources SET provider_config = $1::jsonb', [
      JSON.stringify({ lifeEventsCalendar: flag, custom: 'retained' }),
    ]);

    await migrate(db, '0023_dismissed_birthdays.sql');

    expect((await source(db)).provider_config).toEqual({ lifeEventsCalendar: flag, custom: 'retained' });
  });

  test('creates a config object for a matching source with SQL null config', async () => {
    await insertSource(db, { displayName: 'Friends' });

    await migrate(db, '0023_dismissed_birthdays.sql');

    expect((await source(db)).provider_config).toEqual({ lifeEventsCalendar: true });
  });

  test('treats a JSON null flag as absent while retaining other config', async () => {
    await insertSource(db, { dashboardName: 'Friends' });
    await db.query('UPDATE calendar_sources SET provider_config = $1::jsonb', [
      JSON.stringify({ lifeEventsCalendar: null, supportsTasks: false }),
    ]);

    await migrate(db, '0023_dismissed_birthdays.sql');

    expect((await source(db)).provider_config).toEqual({ lifeEventsCalendar: true, supportsTasks: false });
  });

  test.each([
    [null, null, null],
    ['School', 'Household', 'ordinary@example.invalid'],
    ['Contact birthdays', null, 'ADDRESSBOOK#CONTACTS'],
  ])('does not infer the flag for unrelated metadata %j %j %j', async (displayName, dashboardName, sourceCalendarId) => {
    await insertSource(db, { displayName, dashboardName, sourceCalendarId });

    await migrate(db, '0023_dismissed_birthdays.sql');

    expect((await source(db)).provider_config).toBeNull();
  });

  test('leaves a later explicit opt-out unchanged when both data migrations replay', async () => {
    await insertSource(db, { displayName: 'Friends' });
    await migrate(db, '0023_dismissed_birthdays.sql');
    await db.query('UPDATE calendar_sources SET provider_config = $1::jsonb', [
      JSON.stringify({ lifeEventsCalendar: false, supportsEvents: true }),
    ]);
    const before = await source(db);

    await migrate(db, '0011_calendar_provider_config.sql');
    await migrate(db, '0023_dismissed_birthdays.sql');

    expect(await source(db)).toEqual(before);
  });
});

describe('0023 dismissed birthday identity', () => {
  beforeEach(async () => {
    await migrate(db, '0011_calendar_provider_config.sql');
    await migrate(db, '0023_dismissed_birthdays.sql');
  });

  test('supplies a generated id, birthday event type and creation timestamp', async () => {
    const result = await db.query<{ id: string; event_type: string; timestamp_set: boolean }>(
      `INSERT INTO dismissed_birthdays (normalized_name, birth_month, birth_day)
       VALUES ('fixture person', 2, 29)
       RETURNING id, event_type, created_at IS NOT NULL AS timestamp_set`,
    );

    expect(result.rows[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      event_type: 'birthday',
      timestamp_set: true,
    });
  });

  test('rejects duplicate normalized name, month, day and event type', async () => {
    const values = ['fixture person', 3, 12, 'birthday'];
    const sql = `INSERT INTO dismissed_birthdays (normalized_name, birth_month, birth_day, event_type)
                 VALUES ($1, $2, $3, $4)`;
    await db.query(sql, values);

    await expect(db.query(sql, values)).rejects.toMatchObject({ code: '23505' });
    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM dismissed_birthdays')).rows)
      .toEqual([{ count: 1 }]);
  });

  test.each([
    ['other person', 3, 12, 'birthday'],
    ['fixture person', 4, 12, 'birthday'],
    ['fixture person', 3, 13, 'birthday'],
    ['fixture person', 3, 12, 'anniversary'],
  ])('keeps the distinct identity %s %s/%s %s', async (name, month, day, type) => {
    await db.query(
      `INSERT INTO dismissed_birthdays (normalized_name, birth_month, birth_day, event_type)
       VALUES ('fixture person', 3, 12, 'birthday'), ($1, $2, $3, $4)`,
      [name, month, day, type],
    );

    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM dismissed_birthdays')).rows)
      .toEqual([{ count: 2 }]);
  });

  test.each(['normalized_name', 'birth_month', 'birth_day', 'event_type'])(
    'rejects null %s without retaining a partial row',
    async (column) => {
      const fields: Record<string, string | number | null> = {
        normalized_name: 'fixture person', birth_month: 3, birth_day: 12, event_type: 'birthday',
      };
      fields[column] = null;
      await expect(db.query(
        `INSERT INTO dismissed_birthdays (normalized_name, birth_month, birth_day, event_type)
         VALUES ($1, $2, $3, $4)`,
        [fields.normalized_name, fields.birth_month, fields.birth_day, fields.event_type],
      )).rejects.toMatchObject({ code: '23502' });
      expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM dismissed_birthdays')).rows)
        .toEqual([{ count: 0 }]);
    },
  );

  test('preserves tombstone identity and rejects its duplicate after replay', async () => {
    await db.query(
      `INSERT INTO dismissed_birthdays (normalized_name, birth_month, birth_day)
       VALUES ('fixture person', 12, 31)`,
    );
    const before = await db.query('SELECT * FROM dismissed_birthdays');

    await migrate(db, '0023_dismissed_birthdays.sql');

    expect((await db.query('SELECT * FROM dismissed_birthdays')).rows).toEqual(before.rows);
    await expect(db.query(
      `INSERT INTO dismissed_birthdays (normalized_name, birth_month, birth_day)
       VALUES ('fixture person', 12, 31)`,
    )).rejects.toMatchObject({ code: '23505' });
  });
});

test('all five eligible migrations run in source order and preserve populated rows on replay', async () => {
  await insertSource(db, {
    displayName: 'Friends fixture',
    syncErrors: { supportsEvents: false, lastError: 'fixture issue' },
  });
  await db.query(
    `INSERT INTO calendar_groups (id, type, name, user_id, marker)
     VALUES (1, 'custom', 'Family', NULL, 'retained')`,
  );
  for (const name of migrationNames) await migrate(db, name);
  await db.query('UPDATE calendar_sources SET ical_url = $1, account_email = $2', [
    'https://calendar.example.invalid/feed.ics', 'fixture@example.com',
  ]);
  await db.query(
    `INSERT INTO dismissed_birthdays (normalized_name, birth_month, birth_day)
     VALUES ('fixture person', 5, 6)`,
  );
  const before = {
    sources: (await db.query('SELECT * FROM calendar_sources')).rows,
    groups: (await db.query('SELECT * FROM calendar_groups')).rows,
    dismissed: (await db.query('SELECT * FROM dismissed_birthdays')).rows,
  };

  for (const name of migrationNames) await migrate(db, name);

  expect({
    sources: (await db.query('SELECT * FROM calendar_sources')).rows,
    groups: (await db.query('SELECT * FROM calendar_groups')).rows,
    dismissed: (await db.query('SELECT * FROM dismissed_birthdays')).rows,
  }).toEqual(before);
  expect((await source(db)).provider_config).toEqual({ supportsEvents: false, lifeEventsCalendar: true });
});
