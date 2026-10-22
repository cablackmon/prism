/** @jest-environment node */
import type { PGlite } from '@electric-sql/pglite';
import {
  applyMigration,
  countRows,
  createDatabase,
  ids,
  insertTombstone,
  resetDatabase,
  seedSources,
  tombstones,
} from './burn4-sql-fixture';

jest.setTimeout(60_000);

let db: PGlite;
beforeAll(() => { db = createDatabase(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await resetDatabase(db); await seedSources(db); });

describe.each(tombstones)('$name deletion tombstones', (spec) => {
  beforeEach(async () => { await applyMigration(db, spec.migration); });

  test('rejects repeated remote identities within a source without losing the original', async () => {
    await insertTombstone(db, spec);
    await expect(insertTombstone(db, spec)).rejects.toMatchObject({ code: '23505' });
    expect(await countRows(db, spec.table)).toBe(1);
  });

  test('keeps the same remote identity independent across sources', async () => {
    await insertTombstone(db, spec, ids.sourceA, 'same-remote');
    await insertTombstone(db, spec, ids.sourceB, 'same-remote');
    await db.query(`DELETE FROM ${spec.table} WHERE ${spec.sourceColumn} = $1`, [ids.sourceA]);
    const result = await db.query<Record<string, string>>(`SELECT ${spec.sourceColumn} FROM ${spec.table}`);
    expect(result.rows).toEqual([{ [spec.sourceColumn]: ids.sourceB }]);
  });

  test('preserves case-sensitive and Unicode remote identifiers verbatim', async () => {
    const remoteIds = ['Remote-A', 'remote-a', 'remote-雪/room%20one'];
    for (const remote of remoteIds) await insertTombstone(db, spec, ids.sourceA, remote);
    const result = await db.query<{ remote: string }>(`SELECT ${spec.remoteColumn} AS remote FROM ${spec.table}`);
    expect(result.rows.map((row) => row.remote).sort()).toEqual([...remoteIds].sort());
  });

  test('rejects null source and remote identities', async () => {
    await expect(insertTombstone(db, spec, null)).rejects.toMatchObject({ code: '23502' });
    await expect(insertTombstone(db, spec, ids.sourceA, null)).rejects.toMatchObject({ code: '23502' });
    expect(await countRows(db, spec.table)).toBe(0);
  });

  test('rejects an orphan source while allowing a later valid insertion', async () => {
    await expect(insertTombstone(db, spec, ids.absent)).rejects.toMatchObject({ code: '23503' });
    await insertTombstone(db, spec);
    expect(await countRows(db, spec.table)).toBe(1);
  });

  test('deleting a source removes only that source tombstones', async () => {
    await insertTombstone(db, spec, ids.sourceA, 'first');
    await insertTombstone(db, spec, ids.sourceA, 'second');
    await insertTombstone(db, spec, ids.sourceB, 'retained');
    await db.query(`DELETE FROM ${spec.sourceTable} WHERE id = $1`, [ids.sourceA]);
    const result = await db.query<{ remote: string }>(`SELECT ${spec.remoteColumn} AS remote FROM ${spec.table}`);
    expect(result.rows).toEqual([{ remote: 'retained' }]);
    expect(await countRows(db, spec.sourceTable)).toBe(1);
  });

  test('generates distinct UUIDs and creation times for separate remote items', async () => {
    await insertTombstone(db, spec, ids.sourceA, 'first');
    await insertTombstone(db, spec, ids.sourceA, 'second');
    const result = await db.query<{ id: string; created: string }>(
      `SELECT id::text, created_at::text AS created FROM ${spec.table}`,
    );
    expect(result.rows).toHaveLength(2);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
    for (const row of result.rows) {
      expect(row.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      expect(row.created).toMatch(/^\d{4}-\d{2}-\d{2} /);
    }
  });

  test('accepts 255 Unicode characters and rejects a 256-character remote identity', async () => {
    const accepted = '雪'.repeat(255);
    await insertTombstone(db, spec, ids.sourceA, accepted);
    await expect(insertTombstone(db, spec, ids.sourceA, `${accepted}a`)).rejects.toMatchObject({ code: '22001' });
    const result = await db.query<{ remote: string }>(`SELECT ${spec.remoteColumn} AS remote FROM ${spec.table}`);
    expect(result.rows).toEqual([{ remote: accepted }]);
  });

  test('replay retains explicit identity and timestamp and still enforces both constraints', async () => {
    await db.query(
      `INSERT INTO ${spec.table} (id, ${spec.sourceColumn}, ${spec.remoteColumn}, created_at) VALUES ($1, $2, $3, $4)`,
      [ids.tombstone, ids.sourceA, 'retained', '2024-02-29 12:34:56'],
    );
    const before = await db.query(`SELECT * FROM ${spec.table}`);
    await applyMigration(db, spec.migration);
    await applyMigration(db, spec.migration);
    expect((await db.query(`SELECT * FROM ${spec.table}`)).rows).toEqual(before.rows);
    await expect(insertTombstone(db, spec, ids.sourceA, 'retained')).rejects.toMatchObject({ code: '23505' });
    await expect(insertTombstone(db, spec, ids.absent, 'orphan')).rejects.toMatchObject({ code: '23503' });
    await db.query(`DELETE FROM ${spec.sourceTable} WHERE id = $1`, [ids.sourceA]);
    expect(await countRows(db, spec.table)).toBe(0);
  });
});

describe.each(tombstones.filter((spec) => spec.entityTable))('$name local deletion independence', (spec) => {
  test('removing a local row retains the remote tombstone until it is explicitly removed', async () => {
    await applyMigration(db, spec.migration);
    await db.query(`INSERT INTO ${spec.entityTable} (id) VALUES ($1)`, [ids.entityA]);
    await insertTombstone(db, spec, ids.sourceA, ids.entityA);
    await db.query(`DELETE FROM ${spec.entityTable} WHERE id = $1`, [ids.entityA]);
    expect(await countRows(db, spec.table)).toBe(1);
    await db.query(`DELETE FROM ${spec.table}`);
    await insertTombstone(db, spec, ids.sourceA, ids.entityA);
    expect(await countRows(db, spec.table)).toBe(1);
  });
});

describe.each(tombstones.filter((spec) => spec.table !== 'dismissed_tasks'))('$name schema isolation', (spec) => {
  beforeEach(async () => {
    const constraint = `${spec.table}_${spec.sourceColumn}_${spec.sourceTable}_id_fk`;
    await db.exec(`
      CREATE SCHEMA shadow;
      CREATE TABLE shadow.${spec.sourceTable} (id uuid PRIMARY KEY);
      CREATE TABLE shadow.${spec.table} (
        ${spec.sourceColumn} uuid CONSTRAINT ${constraint} REFERENCES shadow.${spec.sourceTable}(id)
      );
    `);
    await applyMigration(db, spec.migration);
  });

  test.failing(`KNOWN GAP: another schema's ${spec.table} foreign key suppresses the public source constraint`, async () => {
    await expect(insertTombstone(db, spec, ids.absent)).rejects.toMatchObject({ code: '23503' });
  });
});
