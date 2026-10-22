/** @jest-environment node */
import {
  applyAll,
  applyMigration,
  countRows,
  createDatabase,
  ids,
  insertTombstone,
  resetDatabase,
  seedSources,
  tombstones,
  type Migration,
  type SqlDatabase,
} from './burn4-sql-fixture';

jest.setTimeout(60_000);

let db: SqlDatabase;
beforeAll(() => { db = createDatabase(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await resetDatabase(db); });

describe('event removal review and CalDAV metadata', () => {
  test('existing and new events start with no pending deletion', async () => {
    await db.query('INSERT INTO events (id, location) VALUES ($1, $2)', [ids.entityA, 'legacy room']);
    await applyMigration(db, '0016_event_pending_deletion.sql');
    await db.query('INSERT INTO events (id) VALUES ($1)', [ids.entityB]);
    const result = await db.query('SELECT id, pending_deletion FROM events ORDER BY id');
    expect(result.rows).toEqual([
      { id: ids.entityA, pending_deletion: null },
      { id: ids.entityB, pending_deletion: null },
    ]);
  });

  test('review timestamps survive replay and can be cleared without deleting an event', async () => {
    await applyMigration(db, '0016_event_pending_deletion.sql');
    await db.query('INSERT INTO events (id, pending_deletion) VALUES ($1, $2)', [ids.entityA, '2024-02-29 23:59:58.123']);
    await applyMigration(db, '0016_event_pending_deletion.sql');
    const result = await db.query('SELECT pending_deletion::text AS pending FROM events');
    expect(result.rows).toEqual([{ pending: '2024-02-29 23:59:58.123' }]);
    await db.query('UPDATE events SET pending_deletion = NULL WHERE id = $1', [ids.entityA]);
    expect((await db.query('SELECT id, pending_deletion FROM events')).rows).toEqual([
      { id: ids.entityA, pending_deletion: null },
    ]);
  });

  test('adding CalDAV columns preserves legacy event rows and leaves both fields nullable', async () => {
    await db.query('INSERT INTO events (id, location) VALUES ($1, $2)', [ids.entityA, 'old room']);
    await applyMigration(db, '0017_event_caldav_href.sql');
    expect((await db.query('SELECT * FROM events')).rows).toEqual([
      { id: ids.entityA, location: 'old room', caldav_href: null, caldav_etag: null },
    ]);
    await db.query('INSERT INTO events (id, caldav_href) VALUES ($1, $2)', [ids.entityB, '/calendars/example/item.ics']);
    expect((await db.query('SELECT caldav_etag FROM events WHERE id = $1', [ids.entityB])).rows).toEqual([
      { caldav_etag: null },
    ]);
  });

  test('preserves encoded hrefs and quoted conflict tags exactly across replay and independent updates', async () => {
    await applyMigration(db, '0017_event_caldav_href.sql');
    const href = '/calendars/example/room%20one/雪.ics?rev=2&name=a%2Fb';
    const etag = 'W/"revision-雪-2"';
    await db.query('INSERT INTO events (id, caldav_href, caldav_etag) VALUES ($1, $2, $3)', [ids.entityA, href, etag]);
    await applyMigration(db, '0017_event_caldav_href.sql');
    expect((await db.query('SELECT caldav_href, caldav_etag FROM events')).rows).toEqual([
      { caldav_href: href, caldav_etag: etag },
    ]);
    await db.query('UPDATE events SET caldav_etag = NULL');
    expect((await db.query('SELECT caldav_href, caldav_etag FROM events')).rows).toEqual([
      { caldav_href: href, caldav_etag: null },
    ]);
  });

  test.each([
    ['caldav_href', 1024],
    ['caldav_etag', 255],
  ] as const)('%s accepts its full character width and rejects overflow without changing the row', async (column, width) => {
    await applyMigration(db, '0017_event_caldav_href.sql');
    const accepted = '雪'.repeat(width);
    await db.query(`INSERT INTO events (id, ${column}) VALUES ($1, $2)`, [ids.entityA, accepted]);
    await expect(db.query(`UPDATE events SET ${column} = $1`, [`${accepted}x`])).rejects.toMatchObject({ code: '22001' });
    expect((await db.query(`SELECT ${column} AS value FROM events`)).rows).toEqual([{ value: accepted }]);
  });
});

describe('task deletion review and keep-local marker', () => {
  test('backfills existing tasks and defaults new tasks without putting either into deletion review', async () => {
    await db.query('INSERT INTO tasks (id) VALUES ($1)', [ids.entityA]);
    await applyMigration(db, '0025_task_pending_deletion.sql');
    await db.query('INSERT INTO tasks (id) VALUES ($1)', [ids.entityB]);
    expect((await db.query('SELECT * FROM tasks ORDER BY id')).rows).toEqual([
      { id: ids.entityA, pending_deletion: null, sync_exempt: false },
      { id: ids.entityB, pending_deletion: null, sync_exempt: false },
    ]);
  });

  test('rejects null exemption flags and retains the old row after a rejected update', async () => {
    await applyMigration(db, '0025_task_pending_deletion.sql');
    await db.query('INSERT INTO tasks (id) VALUES ($1)', [ids.entityA]);
    await expect(db.query('UPDATE tasks SET sync_exempt = NULL')).rejects.toMatchObject({ code: '23502' });
    await expect(db.query('INSERT INTO tasks (id, sync_exempt) VALUES ($1, NULL)', [ids.entityB])).rejects.toMatchObject({ code: '23502' });
    expect((await db.query('SELECT id, sync_exempt FROM tasks')).rows).toEqual([{ id: ids.entityA, sync_exempt: false }]);
  });

  test('preserves pending timestamps and both exemption choices when the migration replays', async () => {
    await applyMigration(db, '0025_task_pending_deletion.sql');
    await db.query(
      'INSERT INTO tasks (id, pending_deletion, sync_exempt) VALUES ($1, $2, true), ($3, NULL, false)',
      [ids.entityA, '2024-03-01 01:02:03.456', ids.entityB],
    );
    const before = await db.query('SELECT * FROM tasks ORDER BY id');
    await applyMigration(db, '0025_task_pending_deletion.sql');
    await applyMigration(db, '0025_task_pending_deletion.sql');
    expect((await db.query('SELECT * FROM tasks ORDER BY id')).rows).toEqual(before.rows);
  });

  test('allows a kept task to clear its pending marker and retain its exemption across replay', async () => {
    await applyMigration(db, '0025_task_pending_deletion.sql');
    await db.query('INSERT INTO tasks (id, pending_deletion) VALUES ($1, $2)', [ids.entityA, '2024-03-01 00:00:00']);
    await db.query('UPDATE tasks SET pending_deletion = NULL, sync_exempt = true WHERE id = $1', [ids.entityA]);
    await applyMigration(db, '0025_task_pending_deletion.sql');
    expect((await db.query('SELECT * FROM tasks')).rows).toEqual([
      { id: ids.entityA, pending_deletion: null, sync_exempt: true },
    ]);
  });

  test('supports independently finding pending rows while retaining ordinary and kept tasks', async () => {
    await applyMigration(db, '0025_task_pending_deletion.sql');
    await db.query(
      'INSERT INTO tasks (id, pending_deletion, sync_exempt) VALUES ($1, $2, false), ($3, NULL, true)',
      [ids.entityA, '2024-03-01 00:00:00', ids.entityB],
    );
    expect((await db.query('SELECT id FROM tasks WHERE pending_deletion IS NOT NULL')).rows).toEqual([{ id: ids.entityA }]);
    expect((await db.query('SELECT id FROM tasks WHERE sync_exempt')).rows).toEqual([{ id: ids.entityB }]);
    expect(await countRows(db, 'tasks')).toBe(2);
  });
});

describe('calendar location text upgrade', () => {
  test('preserves null, empty, quoted, and full-width legacy locations', async () => {
    const legacy = [null, '', 'Room "A"; café\nSecond floor', '雪'.repeat(255)];
    for (let index = 0; index < legacy.length; index += 1) {
      await db.query('INSERT INTO events (id, location) VALUES ($1, $2)', [
        `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, legacy[index],
      ]);
    }
    const before = await db.query('SELECT * FROM events ORDER BY id');
    await applyMigration(db, '0022_event_location_text.sql');
    expect((await db.query('SELECT * FROM events ORDER BY id')).rows).toEqual(before.rows);
  });

  test('accepts the long recurring-event location previously rejected by the legacy width', async () => {
    const location = 'Venue; east wing; 雪 room; floor 12\n'.repeat(200);
    await expect(db.query('INSERT INTO events (id, location) VALUES ($1, $2)', [ids.entityA, location])).rejects.toMatchObject({ code: '22001' });
    expect(await countRows(db, 'events')).toBe(0);
    await applyMigration(db, '0022_event_location_text.sql');
    await db.query('INSERT INTO events (id, location) VALUES ($1, $2)', [ids.entityA, location]);
    expect((await db.query('SELECT location FROM events')).rows).toEqual([{ location }]);
  });

  test('replay preserves long text and permits further long updates', async () => {
    await applyMigration(db, '0022_event_location_text.sql');
    const first = 'first room; '.repeat(500);
    const second = 'second room; '.repeat(700);
    await db.query('INSERT INTO events (id, location) VALUES ($1, $2)', [ids.entityA, first]);
    await applyMigration(db, '0022_event_location_text.sql');
    expect((await db.query('SELECT location FROM events')).rows).toEqual([{ location: first }]);
    await db.query('UPDATE events SET location = $1', [second]);
    expect((await db.query('SELECT location FROM events')).rows).toEqual([{ location: second }]);
  });
});

describe('ordered migration replay and prerequisite recovery', () => {
  test('all seven migrations replay together without losing local records or tombstones', async () => {
    await seedSources(db);
    await db.query('INSERT INTO events (id, location) VALUES ($1, $2)', [ids.entityA, 'legacy room']);
    await db.query('INSERT INTO tasks (id) VALUES ($1)', [ids.entityA]);
    await applyAll(db);
    for (const spec of tombstones) await insertTombstone(db, spec);
    await db.query('UPDATE events SET pending_deletion = $1, caldav_href = $2, caldav_etag = $3, location = $4', [
      '2024-03-01 00:00:00', '/calendars/example/item.ics', '"revision-2"', 'room; '.repeat(200),
    ]);
    await db.query('UPDATE tasks SET sync_exempt = true');
    const tables = ['events', 'tasks', ...tombstones.map((spec) => spec.table)];
    const before = await Promise.all(tables.map(async (table) => (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows));
    await applyAll(db);
    await applyAll(db);
    const after = await Promise.all(tables.map(async (table) => (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows));
    expect(after).toEqual(before);
    for (const spec of tombstones) await expect(insertTombstone(db, spec)).rejects.toMatchObject({ code: '23505' });
  });

  test.each<[Migration, string, string]>([
    ['0015_dismissed_events.sql', 'calendar_sources', 'CREATE TABLE calendar_sources (id uuid PRIMARY KEY)'],
    ['0016_event_pending_deletion.sql', 'events', 'CREATE TABLE events (id uuid PRIMARY KEY, location varchar(255))'],
    ['0017_event_caldav_href.sql', 'events', 'CREATE TABLE events (id uuid PRIMARY KEY, location varchar(255))'],
    ['0021_excluded_photos.sql', 'photo_sources', 'CREATE TABLE photo_sources (id uuid PRIMARY KEY)'],
    ['0022_event_location_text.sql', 'events', 'CREATE TABLE events (id uuid PRIMARY KEY, location varchar(255))'],
    ['0024_dismissed_tasks.sql', 'task_sources', 'CREATE TABLE task_sources (id uuid PRIMARY KEY)'],
    ['0025_task_pending_deletion.sql', 'tasks', 'CREATE TABLE tasks (id uuid PRIMARY KEY)'],
  ])('%s diagnoses a missing prerequisite and can recover after it is restored', async (migration, missingTable, restoreSql) => {
    await db.exec(`DROP TABLE ${missingTable}`);
    await expect(applyMigration(db, migration)).rejects.toMatchObject({ code: '42P01' });
    await db.exec(restoreSql);
    await expect(applyMigration(db, migration)).resolves.toBeUndefined();
    await expect(applyMigration(db, migration)).resolves.toBeUndefined();
  });
});
