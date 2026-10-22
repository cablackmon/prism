import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export const migrations = [
  '0015_dismissed_events.sql',
  '0016_event_pending_deletion.sql',
  '0017_event_caldav_href.sql',
  '0021_excluded_photos.sql',
  '0022_event_location_text.sql',
  '0024_dismissed_tasks.sql',
  '0025_task_pending_deletion.sql',
] as const;

export type Migration = (typeof migrations)[number];

export const ids = {
  sourceA: '10000000-0000-4000-8000-000000000001',
  sourceB: '10000000-0000-4000-8000-000000000002',
  absent: '10000000-0000-4000-8000-000000000003',
  entityA: '20000000-0000-4000-8000-000000000001',
  entityB: '20000000-0000-4000-8000-000000000002',
  tombstone: '30000000-0000-4000-8000-000000000001',
} as const;

// No URL or data directory: the PostgreSQL engine lives only in this process.
export function createDatabase(): PGlite {
  return new PGlite();
}

export async function resetDatabase(db: PGlite): Promise<void> {
  await db.exec(`
    DROP SCHEMA IF EXISTS shadow CASCADE;
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    CREATE TABLE calendar_sources (id uuid PRIMARY KEY);
    CREATE TABLE photo_sources (id uuid PRIMARY KEY);
    CREATE TABLE task_sources (id uuid PRIMARY KEY);
    CREATE TABLE events (id uuid PRIMARY KEY, location varchar(255));
    CREATE TABLE photos (id uuid PRIMARY KEY);
    CREATE TABLE tasks (id uuid PRIMARY KEY);
  `);
}

export async function applyMigration(db: PGlite, migration: Migration): Promise<void> {
  const sql = readFileSync(resolve(__dirname, '../../../drizzle', migration), 'utf8');
  await db.exec(sql);
}

export async function applyAll(db: PGlite): Promise<void> {
  for (const migration of migrations) await applyMigration(db, migration);
}

export async function seedSources(db: PGlite): Promise<void> {
  for (const table of ['calendar_sources', 'photo_sources', 'task_sources']) {
    await db.query(`INSERT INTO ${table} (id) VALUES ($1), ($2)`, [ids.sourceA, ids.sourceB]);
  }
}

export type Tombstone = {
  name: string;
  table: string;
  sourceTable: string;
  sourceColumn: string;
  remoteColumn: string;
  migration: Migration;
  entityTable?: string;
};

// Identifiers are fixed fixture constants, never caller input.
export const tombstones: readonly Tombstone[] = [
  {
    name: 'calendar event',
    table: 'dismissed_events',
    sourceTable: 'calendar_sources',
    sourceColumn: 'calendar_source_id',
    remoteColumn: 'external_event_id',
    migration: '0015_dismissed_events.sql',
    entityTable: 'events',
  },
  {
    name: 'photo',
    table: 'excluded_photos',
    sourceTable: 'photo_sources',
    sourceColumn: 'source_id',
    remoteColumn: 'external_id',
    migration: '0021_excluded_photos.sql',
    entityTable: 'photos',
  },
  {
    name: 'task',
    table: 'dismissed_tasks',
    sourceTable: 'task_sources',
    sourceColumn: 'task_source_id',
    remoteColumn: 'external_task_id',
    migration: '0024_dismissed_tasks.sql',
    entityTable: 'tasks',
  },
];

export async function insertTombstone(
  db: PGlite,
  spec: Tombstone,
  source: string | null = ids.sourceA,
  remote: string | null = 'remote-item',
): Promise<void> {
  await db.query(
    `INSERT INTO ${spec.table} (${spec.sourceColumn}, ${spec.remoteColumn}) VALUES ($1, $2)`,
    [source, remote],
  );
}

export async function countRows(db: PGlite, table: string): Promise<number> {
  const result = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  const row = result.rows[0];
  if (!row) throw new Error(`Expected a count from ${table}`);
  return row.count;
}
