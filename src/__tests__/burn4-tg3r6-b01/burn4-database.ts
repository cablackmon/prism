import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

type FixtureDatabase = {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};

const { PGlite } = createRequire(__filename)('@electric-sql/pglite') as {
  PGlite: new () => FixtureDatabase;
};

const migrationNames = [
  '0001_travel_map.sql',
  '0002_travel_extras.sql',
  '0003_travel_parent_child.sql',
  '0004_photos_is_external.sql',
  '0005_travel_trips.sql',
  '0006_weekend_ideas.sql',
] as const;

export const db = new PGlite();

export function id(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
}

export async function reset(): Promise<void> {
  await db.exec(`
    DROP SCHEMA IF EXISTS collision CASCADE;
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    SET search_path TO public;
    CREATE TABLE users (id uuid PRIMARY KEY);
    CREATE TABLE photos (id uuid PRIMARY KEY);
  `);
}

export async function migrate(first = 1, last = 6): Promise<void> {
  for (let index = first - 1; index < last; index += 1) {
    const sql = readFileSync(resolve(__dirname, '../../..', 'drizzle', migrationNames[index]), 'utf8');
    await db.exec(sql);
  }
}

export async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function addPin(value: number): Promise<void> {
  await db.query('INSERT INTO travel_pins (id, name, latitude, longitude) VALUES ($1, $2, $3, $4)',
    [id(value), `Synthetic place ${value}`, 12.25, -34.5]);
}

export async function count(table: string): Promise<number> {
  const allowed = ['users', 'photos', 'travel_pins', 'travel_pin_photos', 'travel_trips', 'weekend_places', 'weekend_visits'];
  if (!allowed.includes(table)) throw new Error('Unsupported fixture table');
  const result = await rows<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  return result[0].count;
}
