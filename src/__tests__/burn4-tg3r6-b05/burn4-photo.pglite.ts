/** @jest-environment node */
import { type MemoryDatabase, applyPhotos, id, openDatabase, resetFixture } from './burn4-harness';

jest.setTimeout(30000);

describe('0012 photo priority and duplicate identity migration', () => {
  let db: MemoryDatabase;

  beforeAll(async () => { db = openDatabase(); await db.waitReady; });
  beforeEach(async () => { await resetFixture(db); });
  afterAll(async () => { await db.close(); });

  test('backfills historical source priorities without changing existing metadata', async () => {
    await db.query('INSERT INTO photo_sources (id, label) VALUES ($1, $2)', [id(1), 'Legacy source']);
    await applyPhotos(db);
    expect((await db.query('SELECT id, label, priority FROM photo_sources')).rows).toEqual([
      { id: id(1), label: 'Legacy source', priority: 100 },
    ]);
  });

  test('new sources receive the same priority default as historical rows', async () => {
    await applyPhotos(db);
    await db.query('INSERT INTO photo_sources (id) VALUES ($1)', [id(1)]);
    expect((await db.query('SELECT priority FROM photo_sources')).rows).toEqual([{ priority: 100 }]);
  });

  test('explicit priority values support deterministic preferred-source ordering', async () => {
    await applyPhotos(db);
    await db.query(`
      INSERT INTO photo_sources (id, priority) VALUES ($1, 30), ($2, 10), ($3, 20)
    `, [id(1), id(2), id(3)]);
    expect((await db.query('SELECT id FROM photo_sources ORDER BY priority, id')).rows).toEqual([
      { id: id(2) }, { id: id(3) }, { id: id(1) },
    ]);
  });

  test('accepts the complete signed integer range without narrowing user priorities', async () => {
    await applyPhotos(db);
    await db.query(`
      INSERT INTO photo_sources (id, priority) VALUES ($1, -2147483648), ($2, 2147483647)
    `, [id(1), id(2)]);
    expect((await db.query('SELECT priority FROM photo_sources ORDER BY priority')).rows).toEqual([
      { priority: -2147483648 }, { priority: 2147483647 },
    ]);
  });

  test('rejects an explicit null source priority', async () => {
    await applyPhotos(db);
    await expect(db.query('INSERT INTO photo_sources (id, priority) VALUES ($1, NULL)', [id(1)]))
      .rejects.toMatchObject({ code: '23502', column: 'priority' });
  });

  test('rejects priority overflow without inserting a partial source', async () => {
    await applyPhotos(db);
    await expect(db.query('INSERT INTO photo_sources (id, priority) VALUES ($1, $2)', [id(1), '2147483648']))
      .rejects.toMatchObject({ code: '22003' });
    expect((await db.query('SELECT id FROM photo_sources')).rows).toEqual([]);
  });

  test('historical photos keep their metadata and gain a null identity', async () => {
    await db.query('INSERT INTO photos (id, source_id, caption) VALUES ($1, $2, $3)', [id(1), id(2), 'Fixture caption']);
    await applyPhotos(db);
    expect((await db.query('SELECT id, source_id, caption, dedupe_key FROM photos')).rows).toEqual([
      { id: id(1), source_id: id(2), caption: 'Fixture caption', dedupe_key: null },
    ]);
  });

  test('identical shot identities remain storable across different photo sources', async () => {
    await applyPhotos(db);
    const key = '2030-02-03T04:05:06_1920x1080';
    await db.query(`
      INSERT INTO photos (id, source_id, dedupe_key) VALUES ($1, $2, $5), ($3, $4, $5)
    `, [id(1), id(2), id(3), id(4), key]);
    expect((await db.query('SELECT id, source_id FROM photos WHERE dedupe_key = $1 ORDER BY id', [key])).rows)
      .toEqual([{ id: id(1), source_id: id(2) }, { id: id(3), source_id: id(4) }]);
  });

  test('unknown shot identities remain independent and default to null', async () => {
    await applyPhotos(db);
    await db.query('INSERT INTO photos (id) VALUES ($1), ($2)', [id(1), id(2)]);
    expect((await db.query('SELECT id, dedupe_key FROM photos ORDER BY id')).rows).toEqual([
      { id: id(1), dedupe_key: null }, { id: id(2), dedupe_key: null },
    ]);
  });

  test('stores 120 Unicode characters without applying a byte-length limit', async () => {
    await applyPhotos(db);
    const key = '\u{1f4f7}'.repeat(120);
    await db.query('INSERT INTO photos (id, dedupe_key) VALUES ($1, $2)', [id(1), key]);
    expect((await db.query(`
      SELECT dedupe_key, char_length(dedupe_key) AS characters, octet_length(dedupe_key) AS bytes FROM photos
    `)).rows).toEqual([{ dedupe_key: key, characters: 120, bytes: 480 }]);
  });

  test('rejects identities exceeding the defined character limit', async () => {
    await applyPhotos(db);
    await expect(db.query('INSERT INTO photos (id, dedupe_key) VALUES ($1, $2)', [id(1), 'x'.repeat(121)]))
      .rejects.toMatchObject({ code: '22001' });
  });

  test('replay preserves changed priorities, identities, unrelated fields and row counts', async () => {
    await applyPhotos(db);
    await db.query('INSERT INTO photo_sources (id, label, priority) VALUES ($1, $2, 7)', [id(1), 'Ranked source']);
    await db.query('INSERT INTO photos (id, source_id, caption, dedupe_key) VALUES ($1, $2, $3, $4)',
      [id(2), id(1), 'Retained caption', 'fixture-shot']);
    await applyPhotos(db);
    await applyPhotos(db);
    expect((await db.query('SELECT id, label, priority FROM photo_sources')).rows).toEqual([
      { id: id(1), label: 'Ranked source', priority: 7 },
    ]);
    expect((await db.query('SELECT id, source_id, caption, dedupe_key FROM photos')).rows).toEqual([
      { id: id(2), source_id: id(1), caption: 'Retained caption', dedupe_key: 'fixture-shot' },
    ]);
  });

  test('finishes a partial schema without overwriting an existing priority', async () => {
    await db.exec('ALTER TABLE photo_sources ADD COLUMN priority integer NOT NULL DEFAULT 8');
    await db.query('INSERT INTO photo_sources (id, priority) VALUES ($1, 4)', [id(1)]);
    await applyPhotos(db);
    expect((await db.query('SELECT id, priority FROM photo_sources')).rows).toEqual([{ id: id(1), priority: 4 }]);
    await db.query('INSERT INTO photos (id, dedupe_key) VALUES ($1, $2)', [id(2), 'newly-supported-shot']);
    expect((await db.query('SELECT dedupe_key FROM photos')).rows).toEqual([{ dedupe_key: 'newly-supported-shot' }]);
  });

  test('recreates a missing lookup index on replay and serves an indexed identity query', async () => {
    await applyPhotos(db);
    await db.exec('DROP INDEX photos_dedupe_key_idx');
    await applyPhotos(db);
    await db.query('INSERT INTO photos (id, dedupe_key) VALUES ($1, $2)', [id(1), 'lookup-shot']);
    await db.exec('SET enable_seqscan = off');
    const plan = await db.query<{ 'QUERY PLAN': string }>(
      'EXPLAIN SELECT id FROM photos WHERE dedupe_key = $1', ['lookup-shot'],
    );
    expect(plan.rows.map(row => row['QUERY PLAN']).join('\n')).toContain('photos_dedupe_key_idx');
    expect((await db.query('SELECT id FROM photos WHERE dedupe_key = $1', ['lookup-shot'])).rows)
      .toEqual([{ id: id(1) }]);
    await db.exec('RESET enable_seqscan');
  });

  test('a caller transaction rolls back prior DDL when a required table is missing', async () => {
    await db.query('INSERT INTO photo_sources (id, label) VALUES ($1, $2)', [id(1), 'Kept source']);
    await db.exec('DROP TABLE photos');
    await expect(db.transaction(async tx => { await applyPhotos(tx); }))
      .rejects.toMatchObject({ code: '42P01' });
    expect((await db.query('SELECT id, label FROM photo_sources')).rows).toEqual([
      { id: id(1), label: 'Kept source' },
    ]);
    await expect(db.query('SELECT priority FROM photo_sources')).rejects.toMatchObject({ code: '42703' });
  });
});
