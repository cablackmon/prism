import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export { PGlite };

const root = resolve(__dirname, '../../..');
const photoSQL = readFileSync(
  resolve(root, 'drizzle/0012_photo_source_priority_dedup.sql'), 'utf8',
);
const recipeSQL = readFileSync(
  resolve(root, 'drizzle/0014_recipe_sources.sql'), 'utf8',
);

export function id(ordinal: number): string {
  return `00000000-0000-4000-8000-${ordinal.toString(16).padStart(12, '0')}`;
}

export async function resetFixture(db: PGlite): Promise<void> {
  await db.exec(`
    SET search_path TO public;
    DROP SCHEMA IF EXISTS fixture_shadow CASCADE;
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    CREATE TABLE users (id uuid PRIMARY KEY, label text);
    CREATE TABLE photo_sources (id uuid PRIMARY KEY, label text);
    CREATE TABLE photos (id uuid PRIMARY KEY, source_id uuid, caption text);
    CREATE TABLE recipes (id uuid PRIMARY KEY, title text NOT NULL);
  `);
}

export async function applyPhotos(db: Pick<PGlite, 'exec'>): Promise<void> {
  await db.exec(photoSQL);
}

export async function applyRecipes(db: Pick<PGlite, 'exec'>): Promise<void> {
  await db.exec(recipeSQL);
}

export async function addSource(
  db: PGlite, ordinal: number, createdBy: string | null = null,
): Promise<string> {
  const sourceId = id(ordinal);
  await db.query(`
    INSERT INTO recipe_sources (id, provider, server_url, created_by)
    VALUES ($1, 'fixture-provider', 'https://recipes.example.test', $2)
  `, [sourceId, createdBy]);
  return sourceId;
}

export async function addRecipe(
  db: PGlite, ordinal: number, sourceId: string | null = null,
  externalId: string | null = null, updatedAt: string | null = null,
): Promise<string> {
  const recipeId = id(ordinal);
  await db.query(`
    INSERT INTO recipes
      (id, title, source_id, external_id, external_updated_at)
    VALUES ($1, 'Fixture recipe', $2, $3, $4)
  `, [recipeId, sourceId, externalId, updatedAt]);
  return recipeId;
}
