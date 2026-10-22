import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

type FixtureDatabase = {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};

// Dynamic loading keeps the optional runtime out of normal root type resolution.
const { PGlite } = createRequire(__filename)('@electric-sql/pglite') as {
  PGlite: new () => FixtureDatabase;
};

export const db = new PGlite();

export const legacyTables = [
  'users', 'calendar_sources', 'tasks', 'chores', 'shopping_items',
  'shopping_lists', 'family_messages', 'birthdays', 'layouts', 'photos', 'meals',
] as const;

export function id(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

export async function resetLegacy(): Promise<void> {
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public; SET search_path TO public;');
  for (const table of legacyTables) {
    await db.exec(`CREATE TABLE ${table} (id uuid PRIMARY KEY, marker text);`);
  }
  await db.exec('ALTER TABLE birthdays ADD COLUMN name text NOT NULL; CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL);');
}

export async function migrate(name: 'catchup' | 'length'): Promise<void> {
  const filename = name === 'catchup' ? '0000_upgrade.sql' : '0018_user_pin_length.sql';
  await db.exec(readFileSync(resolve(__dirname, '../../..', 'drizzle', filename), 'utf8'));
}

export async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await rows<T>(sql, params);
  const record = result[0];
  if (result.length !== 1 || record === undefined) throw new Error('Expected one synthetic fixture row');
  return record;
}

export async function addMembers(): Promise<void> {
  await db.query('INSERT INTO users (id, marker) VALUES ($1,$2),($3,$4)',
    [id(1), 'Synthetic member A', id(2), 'Synthetic member B']);
}

export async function familyLength(value: unknown): Promise<void> {
  await db.query('INSERT INTO settings (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    ['pinLength', JSON.stringify(value)]);
}
