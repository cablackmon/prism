import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export const migrationNames = [
  '0009_calendar_ical_url.sql',
  '0011_calendar_provider_config.sql',
  '0013_integrations_account_email.sql',
  '0019_family_group_type.sql',
  '0023_dismissed_birthdays.sql',
] as const;

export type MigrationName = (typeof migrationNames)[number];
export type JsonObject = Record<string, unknown>;

export type SourceInput = {
  id?: number;
  provider?: string;
  sourceCalendarId?: string | null;
  displayName?: string | null;
  dashboardName?: string | null;
  syncErrors?: JsonObject | null;
};

export type SourceRow = {
  id: number;
  provider: string;
  source_calendar_id: string | null;
  display_name: string | null;
  dashboard_calendar_name: string | null;
  sync_errors: JsonObject | null;
  provider_config: JsonObject | null;
};

export const accountTables = [
  'calendar_sources',
  'task_sources',
  'shopping_list_sources',
  'wish_item_sources',
  'photo_sources',
  'api_credentials',
] as const;

const migrationText = Object.fromEntries(
  migrationNames.map((name) => [
    name,
    readFileSync(resolve(__dirname, '../../../drizzle', name), 'utf8'),
  ]),
) as Record<MigrationName, string>;

export async function migrate(db: PGlite, name: MigrationName): Promise<void> {
  await db.exec(migrationText[name]);
}

export async function resetFixtures(db: PGlite): Promise<void> {
  await db.exec(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    CREATE TABLE calendar_sources (
      id integer PRIMARY KEY,
      provider text NOT NULL,
      source_calendar_id text,
      display_name text,
      dashboard_calendar_name text,
      sync_errors jsonb
    );
    CREATE TABLE calendar_groups (
      id integer PRIMARY KEY,
      type text NOT NULL,
      name text NOT NULL,
      user_id uuid,
      marker text NOT NULL
    );
    CREATE TABLE task_sources (id integer PRIMARY KEY, marker text);
    CREATE TABLE shopping_list_sources (id integer PRIMARY KEY, marker text);
    CREATE TABLE wish_item_sources (id integer PRIMARY KEY, marker text);
    CREATE TABLE photo_sources (id integer PRIMARY KEY, marker text);
    CREATE TABLE api_credentials (id integer PRIMARY KEY, marker text);
  `);
}

export async function insertSource(db: PGlite, input: SourceInput = {}): Promise<void> {
  await db.query(
    `INSERT INTO calendar_sources
       (id, provider, source_calendar_id, display_name,
        dashboard_calendar_name, sync_errors)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.id ?? 1,
      input.provider ?? 'caldav',
      input.sourceCalendarId ?? null,
      input.displayName ?? null,
      input.dashboardName ?? null,
      input.syncErrors == null ? null : JSON.stringify(input.syncErrors),
    ],
  );
}

export async function source(db: PGlite, id = 1): Promise<SourceRow> {
  const result = await db.query<SourceRow>(
    `SELECT id, provider, source_calendar_id, display_name,
            dashboard_calendar_name, sync_errors, provider_config
     FROM calendar_sources WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Missing synthetic calendar source ${id}`);
  return row;
}

export { PGlite };
