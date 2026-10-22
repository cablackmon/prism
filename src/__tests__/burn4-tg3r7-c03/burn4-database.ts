import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export type Database = {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};

// This structural loader never imports optional runtime declarations.
const { PGlite } = createRequire(__filename)('@electric-sql/pglite') as {
  PGlite: new () => Database;
};

export function id(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

export async function one<T>(db: Database, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<T>(sql, params);
  const record = result.rows[0];
  if (result.rows.length !== 1 || record === undefined) throw new Error('Expected one synthetic fixture row');
  return record;
}

export async function bootstrap(db: Database): Promise<void> {
  const sql = readFileSync(resolve(__dirname, '../../lib/db/init/02-schema.sql'), 'utf8');
  await db.exec(sql);
}

export async function withSchema(run: (db: Database) => Promise<void>, collision = false): Promise<void> {
  const db = new PGlite();
  try {
    if (collision) {
      await db.exec('CREATE SCHEMA shadow; CREATE TABLE shadow.sources (id uuid PRIMARY KEY); CREATE TABLE shadow.recipes (id uuid PRIMARY KEY, source_id uuid CONSTRAINT recipes_source_id_recipe_sources_id_fk REFERENCES shadow.sources(id));');
    }
    await bootstrap(db);
    // Read declarations only, never sensitive field values. Check before fixtures.
    const defaults = await one<{ checked: number; generated: number }>(db, "SELECT count(*)::int AS checked,count(*) FILTER (WHERE column_default IS NOT NULL)::int AS generated FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('access_token','refresh_token','immich_share_key','immich_password_enc','encrypted_credentials','token_hash','pin')");
    if (defaults.checked !== 16 || defaults.generated !== 0) throw new Error('Sensitive defaults require review before inserting synthetic metadata');
    await run(db);
  } finally {
    await db.close();
  }
}

export async function addMembers(db: Database): Promise<void> {
  await db.query('INSERT INTO users (id,name,role,color) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
    [id(1), 'Synthetic parent', 'parent', '#123456', id(2), 'Synthetic child', 'child', '#654321']);
}

export async function seedHousehold(db: Database): Promise<void> {
  await addMembers(db);
  for (const [member, offset] of [[1, 0], [2, 1]] as const) {
    const owner = id(member);
    await db.query('INSERT INTO calendar_groups (id,name,user_id) VALUES ($1,$2,$3)', [id(10 + offset), 'Synthetic group ' + member, owner]);
    await db.query('INSERT INTO calendar_sources (id,user_id,provider,source_calendar_id,dashboard_calendar_name,group_id) VALUES ($1,$2,$3,$4,$5,$6)', [id(12 + offset), owner, 'synthetic', 'calendar-' + member, 'Synthetic calendar ' + member, id(10 + offset)]);
    await db.query('INSERT INTO events (id,calendar_source_id,title,start_time,end_time,created_by,external_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id(14 + offset), id(12 + offset), 'Synthetic event ' + member, '2026-10-21 10:00', '2026-10-21 11:00', owner, 'event-' + member]);
    await db.query('INSERT INTO chores (id,title,category,frequency,assigned_to,created_by) VALUES ($1,$2,$3,$4,$5,$5)', [id(20 + offset), 'Synthetic chore ' + member, 'ordinary', 'daily', owner]);
    await db.query('INSERT INTO chore_completions (id,chore_id,completed_by,approved_by,points_awarded) VALUES ($1,$2,$3,$4,$5)', [id(22 + offset), id(20 + offset), id(member === 1 ? 2 : 1), owner, 5]);
    await db.query('INSERT INTO family_messages (id,message,author_id) VALUES ($1,$2,$3)', [id(24 + offset), 'Synthetic message ' + member, owner]);
    await db.query('INSERT INTO shopping_lists (id,name,created_by,assigned_to,visible_categories) VALUES ($1,$2,$3,$3,$4::jsonb)', [id(30 + offset), 'Synthetic shopping list ' + member, owner, '["ordinary"]']);
    await db.query('INSERT INTO shopping_list_sources (id,user_id,provider,external_list_id,shopping_list_id) VALUES ($1,$2,$3,$4,$5)', [id(32 + offset), owner, 'synthetic', 'shopping-' + member, id(30 + offset)]);
    await db.query('INSERT INTO shopping_items (id,list_id,name,shopping_list_source_id,added_by) VALUES ($1,$2,$3,$4,$5)', [id(34 + offset), id(30 + offset), 'Synthetic item ' + member, id(32 + offset), owner]);
    await db.query('INSERT INTO task_lists (id,name,created_by) VALUES ($1,$2,$3)', [id(40 + offset), 'Synthetic task list ' + member, owner]);
    await db.query('INSERT INTO task_sources (id,user_id,provider,external_list_id,task_list_id) VALUES ($1,$2,$3,$4,$5)', [id(42 + offset), owner, 'synthetic', 'tasks-' + member, id(40 + offset)]);
    await db.query('INSERT INTO tasks (id,title,list_id,task_source_id,assigned_to,created_by,completed_by) VALUES ($1,$2,$3,$4,$5,$5,$5)', [id(44 + offset), 'Synthetic task ' + member, id(40 + offset), id(42 + offset), owner]);
    await db.query('INSERT INTO recipe_sources (id,provider,server_url,created_by) VALUES ($1,$2,$3,$4)', [id(50 + offset), 'synthetic', 'https://fixture.invalid', owner]);
    await db.query('INSERT INTO recipes (id,name,source_id,external_id,created_by,ingredients,tags) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)', [id(52 + offset), 'Synthetic recipe ' + member, id(50 + offset), 'recipe-' + member, owner, '[{"name":"water","amount":1}]', '["ordinary"]']);
    await db.query('INSERT INTO meals (id,name,recipe_id,week_of,date,day_of_week,meal_type,created_by,cooked_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)', [id(54 + offset), 'Synthetic meal ' + member, id(52 + offset), '2026-10-19', '2026-10-21', 'wednesday', 'dinner', owner]);
    await db.query('INSERT INTO goals (id,name,point_cost) VALUES ($1,$2,$3)', [id(60 + offset), 'Synthetic goal ' + member, 5]);
    await db.query('INSERT INTO goal_achievements (id,goal_id,user_id,period_start) VALUES ($1,$2,$3,$4)', [id(62 + offset), id(60 + offset), owner, '2026-10-19']);
    await db.query('INSERT INTO photo_sources (id,type,name) VALUES ($1,$2,$3)', [id(70 + offset), 'local', 'Synthetic photo source ' + member]);
    await db.query('INSERT INTO photos (id,source_id,filename,original_filename,mime_type) VALUES ($1,$2,$3,$3,$4)', [id(72 + offset), id(70 + offset), 'synthetic-' + member + '.jpg', 'image/jpeg']);
    await db.query('INSERT INTO travel_trips (id,name,trip_style,created_by) VALUES ($1,$2,$3,$4)', [id(74 + offset), 'Synthetic trip ' + member, 'road_trip', owner]);
    await db.query('INSERT INTO travel_pins (id,name,latitude,longitude,trip_id,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id(member === 1 ? 76 : 78), 'Synthetic place ' + member, '12.5', '-34.5', id(74 + offset), owner]);
    await db.query('INSERT INTO travel_pin_photos (id,pin_id,photo_id) VALUES ($1,$2,$3)', [id(member === 1 ? 79 : 81), id(member === 1 ? 76 : 78), id(72 + offset)]);
    await db.query('INSERT INTO weekend_places (id,name,created_by) VALUES ($1,$2,$3)', [id(90 + offset), 'Synthetic weekend place ' + member, owner]);
    await db.query('INSERT INTO weekend_visits (id,place_id,visited_by,visited_on) VALUES ($1,$2,$3,$4)', [id(92 + offset), id(90 + offset), owner, '2026-10-21']);
    await db.query('INSERT INTO maintenance_reminders (id,title,category,schedule,next_due,created_by,assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$6)', [id(100 + offset), 'Synthetic reminder ' + member, 'ordinary', 'monthly', '2026-11-01', owner]);
    await db.query('INSERT INTO maintenance_completions (id,reminder_id,completed_by) VALUES ($1,$2,$3)', [id(102 + offset), id(100 + offset), owner]);
    await db.query('INSERT INTO wish_item_sources (id,user_id,provider,external_list_id,member_id) VALUES ($1,$2,$3,$4,$5)', [id(110 + offset), owner, 'synthetic', 'wish-' + member, id(2)]);
    await db.query('INSERT INTO wish_items (id,member_id,name,wish_item_source_id,added_by,claimed_by) VALUES ($1,$2,$3,$4,$5,$5)', [id(112 + offset), id(2), 'Synthetic wish ' + member, id(110 + offset), owner]);
    await db.query('INSERT INTO calendar_notes (id,date,content,created_by) VALUES ($1,$2,$3,$4)', [id(120 + offset), member === 1 ? '2026-10-21' : '2026-10-22', 'Synthetic note ' + member, owner]);
    await db.query('INSERT INTO audit_logs (id,user_id,action,entity_type,summary) VALUES ($1,$2,$3,$4,$5)', [id(122 + offset), owner, 'create', 'fixture', 'Synthetic change ' + member]);
    await db.query('INSERT INTO bus_routes (id,student_name,user_id,trip_id,direction,label,scheduled_time) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id(124 + offset), 'Synthetic rider ' + member, owner, 'bus-' + member, 'am', 'Synthetic route ' + member, '07:30']);
    await db.query('INSERT INTO bus_geofence_log (id,route_id,event_type,checkpoint_name,checkpoint_index,event_time,day_of_week,trip_date,gmail_message_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id(126 + offset), id(124 + offset), 'arrival', 'Synthetic stop', 0, '2026-10-21 07:30', 3, '2026-10-21', 'synthetic-message-' + member]);
    await db.query('INSERT INTO birthdays (id,name,birth_date,user_id) VALUES ($1,$2,$3,$4)', [id(128 + offset), 'Synthetic birthday ' + member, '2000-10-21', owner]);
    await db.query('INSERT INTO layouts (id,name,widgets,created_by) VALUES ($1,$2,$3::jsonb,$4)', [id(130 + offset), 'Synthetic layout ' + member, '[{"type":"clock"}]', owner]);
    await db.query('INSERT INTO dismissed_events (id,calendar_source_id,external_event_id) VALUES ($1,$2,$3)', [id(140 + offset), id(12 + offset), 'gone-event']);
    await db.query('INSERT INTO dismissed_tasks (id,task_source_id,external_task_id) VALUES ($1,$2,$3)', [id(142 + offset), id(42 + offset), 'gone-task']);
    await db.query('INSERT INTO excluded_photos (id,source_id,external_id) VALUES ($1,$2,$3)', [id(144 + offset), id(70 + offset), 'gone-photo']);
  }
  await db.query('INSERT INTO events (id,title,start_time,end_time,created_by) VALUES ($1,$2,$3,$4,$5)', [id(16), 'Synthetic local event', '2026-10-21 12:00', '2026-10-21 13:00', id(1)]);
  await db.query('INSERT INTO tasks (id,title,assigned_to,created_by,completed_by) VALUES ($1,$2,$3,$3,$3)', [id(46), 'Synthetic local task', id(1)]);
  await db.query('INSERT INTO travel_pins (id,name,latitude,longitude,parent_id,trip_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id(77), 'Synthetic child place', '12.6', '-34.6', id(76), id(74), id(1)]);
  await db.query('INSERT INTO travel_pin_photos (id,pin_id,photo_id) VALUES ($1,$2,$3)', [id(80), id(77), id(72)]);
  await db.query('INSERT INTO gift_ideas (id,created_by,for_user_id,name) VALUES ($1,$2,$3,$4),($5,$3,$3,$6),($7,$3,$2,$8)', [id(64), id(1), id(2), 'Synthetic gift from parent', id(65), 'Synthetic keeper gift', id(66), 'Synthetic gift to parent']);
}

const countable = new Set(['users', 'calendar_groups', 'calendar_sources', 'events', 'dismissed_events', 'chores', 'chore_completions', 'family_messages', 'shopping_lists', 'shopping_list_sources', 'shopping_items', 'task_lists', 'task_sources', 'tasks', 'dismissed_tasks', 'recipe_sources', 'recipes', 'meals', 'goals', 'goal_achievements', 'gift_ideas', 'photo_sources', 'photos', 'excluded_photos', 'travel_trips', 'travel_pins', 'travel_pin_photos', 'weekend_places', 'weekend_visits', 'maintenance_reminders', 'maintenance_completions', 'wish_item_sources', 'wish_items', 'calendar_notes', 'audit_logs', 'bus_routes', 'bus_geofence_log', 'birthdays', 'layouts']);

export async function count(db: Database, table: string): Promise<number> {
  if (!countable.has(table)) throw new Error('Unsupported ordinary fixture table');
  return (await one<{ count: number }>(db, 'SELECT count(*)::int AS count FROM ' + table)).count;
}
