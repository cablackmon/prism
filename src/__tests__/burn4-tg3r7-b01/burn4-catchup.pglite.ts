import { addMembers, db, id, legacyTables, migrate, one, resetLegacy, rows } from './burn4-database';

afterAll(async () => { await db.close(); });

describe('legacy catch-up migration data preservation', () => {
  beforeEach(resetLegacy);

  test('keeps ordinary data in every original table while adding defaults', async () => {
    for (const table of legacyTables) {
      if (table === 'birthdays') {
        await db.query('INSERT INTO birthdays (id,marker,name) VALUES ($1,$2,$3)', [id(1), table, 'Synthetic birthday']);
      } else {
        await db.query('INSERT INTO ' + table + ' (id,marker) VALUES ($1,$2)', [id(1), table]);
      }
    }
    await migrate('catchup');
    for (const table of legacyTables) {
      expect(await one('SELECT id,marker FROM ' + table)).toEqual({ id: id(1), marker: table });
    }
    expect(await one('SELECT show_in_event_modal,is_family FROM calendar_sources')).toEqual({ show_in_event_modal: true, is_family: false });
    expect(await one('SELECT list_type FROM shopping_lists')).toEqual({ list_type: 'grocery' });
    expect(await one('SELECT event_type FROM birthdays')).toEqual({ event_type: 'birthday' });
    expect(await one('SELECT usage FROM photos')).toEqual({ usage: 'wallpaper,gallery,screensaver' });
    expect(await one('SELECT sort_order FROM users')).toEqual({ sort_order: 0 });
    expect(await one('SELECT orientation FROM layouts')).toEqual({ orientation: 'landscape' });
  });

  test('leaves newly optional associations and edit/sync metadata NULL on legacy rows', async () => {
    for (const table of legacyTables.filter((name) => name !== 'birthdays')) {
      await db.query('INSERT INTO ' + table + ' (id) VALUES ($1)', [id(1)]);
    }
    await db.query('INSERT INTO birthdays (id,name) VALUES ($1,$2)', [id(1), 'Synthetic birthday']);
    await migrate('catchup');
    const projections = [
      ['calendar_sources', ['group_id']],
      ['tasks', ['list_id', 'task_source_id', 'external_id', 'external_updated_at', 'last_synced']],
      ['chores', ['start_day']],
      ['shopping_items', ['shopping_list_source_id', 'external_id', 'external_updated_at', 'last_synced']],
      ['shopping_lists', ['updated_at', 'visible_categories', 'assigned_to']],
      ['family_messages', ['updated_at']],
      ['birthdays', ['google_calendar_source']],
      ['layouts', ['slug', 'screensaver_widgets', 'font_scale']],
      ['photos', ['orientation']],
      ['meals', ['recipe_id']],
    ] as const;
    for (const [table, columns] of projections) {
      expect(await one('SELECT ' + columns.join(',') + ' FROM ' + table))
        .toEqual(Object.fromEntries(columns.map((column) => [column, null])));
    }
  });

  test('preserves existing added-column values and defaults instead of resetting them', async () => {
    await db.exec("ALTER TABLE photos ADD COLUMN usage varchar(100) DEFAULT 'gallery' NOT NULL; ALTER TABLE layouts ADD COLUMN orientation varchar(20) DEFAULT 'portrait'; ALTER TABLE users ADD COLUMN sort_order integer DEFAULT 7 NOT NULL;");
    await db.query('INSERT INTO photos (id,usage) VALUES ($1,$2)', [id(1), 'screensaver']);
    await db.query('INSERT INTO layouts (id,orientation) VALUES ($1,$2)', [id(1), 'portrait']);
    await db.query('INSERT INTO users (id,sort_order) VALUES ($1,$2)', [id(1), 3]);
    await migrate('catchup');
    await migrate('catchup');
    expect(await one('SELECT usage FROM photos')).toEqual({ usage: 'screensaver' });
    expect(await one('SELECT orientation FROM layouts')).toEqual({ orientation: 'portrait' });
    expect(await one('SELECT sort_order FROM users')).toEqual({ sort_order: 3 });
    await db.query('INSERT INTO users (id) VALUES ($1)', [id(2)]);
    expect(await one('SELECT sort_order FROM users WHERE id = $1', [id(2)])).toEqual({ sort_order: 7 });
  });

  test('adds the later bus sort column on an existing bus table without replacing rows', async () => {
    await db.exec('CREATE TABLE bus_routes (id uuid PRIMARY KEY, trip_id varchar(50), direction varchar(10), enabled boolean);');
    await db.query('INSERT INTO bus_routes (id,trip_id,direction,enabled) VALUES ($1,$2,$3,$4)', [id(9), 'synthetic-trip', 'am', false]);
    await migrate('catchup');
    expect(await one('SELECT id,trip_id,direction,enabled,sort_order FROM bus_routes')).toEqual({ id: id(9), trip_id: 'synthetic-trip', direction: 'am', enabled: false, sort_order: 0 });
  });

  test('retains populated application rows and identities through two replays', async () => {
    await migrate('catchup');
    await addMembers();
    await db.query('INSERT INTO goals (id,name,point_cost) VALUES ($1,$2,$3)', [id(10), 'Synthetic goal', 20]);
    await db.query('INSERT INTO goal_achievements (id,goal_id,user_id,period_start) VALUES ($1,$2,$3,$4)', [id(11), id(10), id(1), '2026-10-21']);
    await db.query('INSERT INTO task_lists (id,name,created_by) VALUES ($1,$2,$3)', [id(12), 'Synthetic list', id(1)]);
    await db.query('INSERT INTO recipes (id,name,ingredients,created_by) VALUES ($1,$2,$3::jsonb,$4)', [id(13), 'Synthetic soup', '[{"name":"water"}]', id(1)]);
    await db.query('INSERT INTO babysitter_info (id,section,content) VALUES ($1,$2,$3::jsonb)', [id(14), 'ordinary', '{"text":"Synthetic instructions"}']);
    await db.query('INSERT INTO wish_items (id,member_id,name,added_by) VALUES ($1,$2,$3,$4)', [id(15), id(1), 'Synthetic wish', id(2)]);
    await db.query('INSERT INTO audit_logs (id,user_id,action,entity_type,summary) VALUES ($1,$2,$3,$4,$5)', [id(16), id(1), 'create', 'fixture', 'Synthetic change']);
    await db.query('INSERT INTO bus_routes (id,student_name,trip_id,direction,label,scheduled_time) VALUES ($1,$2,$3,$4,$5,$6)', [id(17), 'Synthetic rider', 'synthetic-trip', 'am', 'Synthetic route', '07:30']);
    await db.query('INSERT INTO bus_geofence_log (id,route_id,event_type,checkpoint_name,checkpoint_index,event_time,day_of_week,trip_date,gmail_message_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id(18), id(17), 'arrival', 'Synthetic stop', 0, '2026-10-21 07:30:00', 3, '2026-10-21', 'synthetic-message-1']);
    await db.query('INSERT INTO calendar_notes (id,date,content,created_by) VALUES ($1,$2,$3,$4)', [id(19), '2026-10-21', 'Synthetic note', id(1)]);
    await db.query('INSERT INTO gift_ideas (id,created_by,for_user_id,name,price) VALUES ($1,$2,$3,$4,$5)', [id(20), id(1), id(2), 'Synthetic gift', '12.34']);
    const tables = ['goals', 'goal_achievements', 'task_lists', 'recipes', 'babysitter_info', 'wish_items', 'audit_logs', 'bus_routes', 'bus_geofence_log', 'calendar_notes', 'gift_ideas'];
    const before = await Promise.all(tables.map((table) => rows('SELECT * FROM ' + table + ' ORDER BY id')));
    await migrate('catchup');
    await migrate('catchup');
    const after = await Promise.all(tables.map((table) => rows('SELECT * FROM ' + table + ' ORDER BY id')));
    expect(after).toEqual(before);
  });

  test('reports a legacy unique conflict without silently deleting the conflicting data', async () => {
    await db.exec('CREATE TABLE calendar_notes (id uuid PRIMARY KEY, date date NOT NULL, content text NOT NULL);');
    await db.query('INSERT INTO calendar_notes (id,date,content) VALUES ($1,$2,$3),($4,$2,$5)', [id(1), '2026-10-21', 'Synthetic A', id(2), 'Synthetic B']);
    await expect(migrate('catchup')).rejects.toMatchObject({ code: '23505' });
    expect(await rows('SELECT content FROM calendar_notes ORDER BY id')).toEqual([{ content: 'Synthetic A' }, { content: 'Synthetic B' }]);
    await db.query('DELETE FROM calendar_notes WHERE id = $1', [id(2)]);
    await migrate('catchup');
    await expect(db.query('INSERT INTO calendar_notes (id,date,content) VALUES ($1,$2,$3)', [id(3), '2026-10-21', 'Synthetic C'])).rejects.toMatchObject({ code: '23505' });
  });

  test('fails when an original prerequisite table is missing, then recovers after fixture repair', async () => {
    await db.exec('DROP TABLE tasks;');
    await expect(migrate('catchup')).rejects.toMatchObject({ code: '42P01' });
    await db.exec('CREATE TABLE tasks (id uuid PRIMARY KEY, marker text);');
    await migrate('catchup');
    await db.query('INSERT INTO tasks (id,external_id) VALUES ($1,$2)', [id(1), 'synthetic-task']);
    expect(await one('SELECT external_id FROM tasks')).toEqual({ external_id: 'synthetic-task' });
  });
});

describe('catch-up application inserts and constraints', () => {
  beforeEach(async () => { await resetLegacy(); await migrate('catchup'); await addMembers(); });

  test('creates independent recipe JSON defaults and ordinary generated identities/times', async () => {
    const first = await one<{ id: string; created_at: Date; updated_at: Date }>('INSERT INTO recipes (name) VALUES ($1) RETURNING id,created_at,updated_at', ['Synthetic recipe A']);
    await db.query('UPDATE recipes SET ingredients = $1::jsonb,tags = $2::jsonb WHERE id = $3', ['[{"name":"water"}]', '["soup"]', first.id]);
    const second = await one<{ id: string; ingredients: unknown; tags: unknown; times_made: number; is_favorite: boolean; source_type: string }>('INSERT INTO recipes (name) VALUES ($1) RETURNING id,ingredients,tags,times_made,is_favorite,source_type', ['Synthetic recipe B']);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.created_at).toBeInstanceOf(Date);
    expect(first.updated_at).toEqual(first.created_at);
    expect(second).toEqual({ id: expect.any(String), ingredients: [], tags: [], times_made: 0, is_favorite: false, source_type: 'manual' });
    expect(second.id).not.toBe(first.id);
    expect(await one('SELECT ingredients,tags FROM recipes WHERE id = $1', [first.id])).toEqual({ ingredients: [{ name: 'water' }], tags: ['soup'] });
  });

  test('keeps ordinary defaults for goals, task lists, babysitter sections, wishes and gifts', async () => {
    expect(await one('INSERT INTO goals (name,point_cost) VALUES ($1,$2) RETURNING priority,recurring,active,recurrence_period', ['Synthetic goal', 10])).toEqual({ priority: 0, recurring: false, active: true, recurrence_period: null });
    expect(await one('INSERT INTO task_lists (name) VALUES ($1) RETURNING sort_order,color,created_by', ['Synthetic list'])).toEqual({ sort_order: 0, color: null, created_by: null });
    expect(await one('INSERT INTO babysitter_info (section,content) VALUES ($1,$2::jsonb) RETURNING sort_order,is_sensitive,content', ['ordinary', '{"text":"Synthetic info"}'])).toEqual({ sort_order: 0, is_sensitive: false, content: { text: 'Synthetic info' } });
    expect(await one('INSERT INTO wish_items (member_id,name) VALUES ($1,$2) RETURNING sort_order,claimed,claimed_by,claimed_at', [id(1), 'Synthetic wish'])).toEqual({ sort_order: 0, claimed: false, claimed_by: null, claimed_at: null });
    expect(await one('INSERT INTO gift_ideas (created_by,for_user_id,name) VALUES ($1,$2,$3) RETURNING purchased,purchased_at,sort_order,price', [id(1), id(2), 'Synthetic gift'])).toEqual({ purchased: false, purchased_at: null, sort_order: 0, price: null });
  });

  test('persists audit JSON and bus scheduling defaults without external activity', async () => {
    expect(await one('INSERT INTO audit_logs (action,entity_type,summary,metadata) VALUES ($1,$2,$3,$4::jsonb) RETURNING user_id,metadata', ['update', 'fixture', 'Synthetic update', '{"changed":["name"]}'])).toEqual({ user_id: null, metadata: { changed: ['name'] } });
    expect(await one('INSERT INTO bus_routes (student_name,trip_id,direction,label,scheduled_time) VALUES ($1,$2,$3,$4,$5) RETURNING active_days,checkpoints,enabled,sort_order', ['Synthetic rider', 'synthetic-trip', 'am', 'Synthetic route', '07:30'])).toEqual({ active_days: [1, 2, 3, 4, 5], checkpoints: [], enabled: true, sort_order: 0 });
    expect(await one('INSERT INTO calendar_notes (date) VALUES ($1) RETURNING content', ['2026-10-21'])).toEqual({ content: '' });
  });

  const missingRequired = [
    ['goal point cost', 'INSERT INTO goals (name) VALUES ($1)', ['Synthetic goal']],
    ['achievement member', 'INSERT INTO goal_achievements (goal_id,period_start) VALUES ($1,$2)', [id(8), '2026-10-21']],
    ['task-list name', 'INSERT INTO task_lists DEFAULT VALUES', []],
    ['recipe name', 'INSERT INTO recipes DEFAULT VALUES', []],
    ['babysitter content', 'INSERT INTO babysitter_info (section) VALUES ($1)', ['ordinary']],
    ['wish member', 'INSERT INTO wish_items (name) VALUES ($1)', ['Synthetic wish']],
    ['audit summary', 'INSERT INTO audit_logs (action,entity_type) VALUES ($1,$2)', ['create', 'fixture']],
    ['bus schedule', 'INSERT INTO bus_routes (student_name,trip_id,direction,label) VALUES ($1,$2,$3,$4)', ['Synthetic rider', 'synthetic-trip', 'am', 'Synthetic route']],
    ['bus-log event time', 'INSERT INTO bus_geofence_log (route_id,event_type,checkpoint_name,checkpoint_index,day_of_week,trip_date,gmail_message_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id(9), 'arrival', 'Synthetic stop', 0, 3, '2026-10-21', 'synthetic-message']],
    ['note date', 'INSERT INTO calendar_notes DEFAULT VALUES', []],
    ['gift recipient', 'INSERT INTO gift_ideas (created_by,name) VALUES ($1,$2)', [id(1), 'Synthetic gift']],
  ] satisfies [string, string, unknown[]][];
  test.each(missingRequired)('rejects missing required %s', async (_name, sql, params) => {
    await expect(db.query(sql, params)).rejects.toMatchObject({ code: '23502' });
  });

  test('enforces declared text length without truncating valid Unicode content', async () => {
    const name = 'é'.repeat(255);
    expect(await one('INSERT INTO recipes (name) VALUES ($1) RETURNING name', [name])).toEqual({ name });
    await expect(db.query('INSERT INTO recipes (name) VALUES ($1)', [name + 'é'])).rejects.toMatchObject({ code: '22001' });
    await expect(db.query('INSERT INTO goals (name,point_cost,emoji) VALUES ($1,$2,$3)', ['Synthetic goal', 2, 'x'.repeat(11)])).rejects.toMatchObject({ code: '22001' });
  });

  test('stores rounded currency and rejects numeric overflow without altering the prior gift', async () => {
    const gift = await one<{ id: string; price: string }>('INSERT INTO gift_ideas (created_by,for_user_id,name,price) VALUES ($1,$2,$3,$4) RETURNING id,price', [id(1), id(2), 'Synthetic gift', '12.345']);
    expect(gift.price).toBe('12.35');
    await expect(db.query('UPDATE gift_ideas SET price = $1 WHERE id = $2', ['100000000.00', gift.id])).rejects.toMatchObject({ code: '22003' });
    expect(await one('SELECT price FROM gift_ideas WHERE id = $1', [gift.id])).toEqual({ price: '12.35' });
  });

  test('enforces one note per date and admits different dates', async () => {
    await db.query('INSERT INTO calendar_notes (date,content) VALUES ($1,$2)', ['2026-10-21', 'Synthetic A']);
    await expect(db.query('INSERT INTO calendar_notes (date,content) VALUES ($1,$2)', ['2026-10-21', 'Synthetic B'])).rejects.toMatchObject({ code: '23505' });
    await db.query('INSERT INTO calendar_notes (date) VALUES ($1)', ['2026-10-22']);
    expect(await one('SELECT count(*)::int AS count FROM calendar_notes')).toEqual({ count: 2 });
  });

  test('queued duplicate note callers produce one durable winner and one unique violation', async () => {
    const calls = ['Synthetic A', 'Synthetic B'].map((content) => db.query('INSERT INTO calendar_notes (date,content) VALUES ($1,$2) RETURNING content', ['2026-10-21', content]));
    const settled = await Promise.allSettled(calls);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failures = settled.filter((result) => result.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ status: 'rejected', reason: { code: '23505' } });
    const winner = await one<{ content: string }>('SELECT content FROM calendar_notes');
    expect(['Synthetic A', 'Synthetic B']).toContain(winner.content);
  });

  test('achievement uniqueness uses goal, member and period together', async () => {
    await db.query('INSERT INTO goals (id,name,point_cost) VALUES ($1,$2,$3),($4,$5,$3)', [id(10), 'Synthetic A', 1, id(11), 'Synthetic B']);
    const sql = 'INSERT INTO goal_achievements (goal_id,user_id,period_start) VALUES ($1,$2,$3)';
    await db.query(sql, [id(10), id(1), '2026-10-21']);
    await expect(db.query(sql, [id(10), id(1), '2026-10-21'])).rejects.toMatchObject({ code: '23505' });
    await db.query(sql, [id(11), id(1), '2026-10-21']);
    await db.query(sql, [id(10), id(2), '2026-10-21']);
    await db.query(sql, [id(10), id(1), '2026-10-22']);
    expect(await one('SELECT count(*)::int AS count FROM goal_achievements')).toEqual({ count: 4 });
  });

  test('bus route identity combines trip and direction', async () => {
    const sql = 'INSERT INTO bus_routes (student_name,trip_id,direction,label,scheduled_time) VALUES ($1,$2,$3,$4,$5)';
    await db.query(sql, ['Synthetic rider', 'synthetic-trip', 'am', 'Synthetic route', '07:30']);
    await expect(db.query(sql, ['Synthetic rider', 'synthetic-trip', 'am', 'Synthetic duplicate', '07:40'])).rejects.toMatchObject({ code: '23505' });
    await db.query(sql, ['Synthetic rider', 'synthetic-trip', 'pm', 'Synthetic route', '15:30']);
    await db.query(sql, ['Synthetic rider', 'synthetic-trip-2', 'am', 'Synthetic route', '08:00']);
    expect(await one('SELECT count(*)::int AS count FROM bus_routes')).toEqual({ count: 3 });
  });

  test('bus message identity rejects duplicate local ingestion', async () => {
    await db.query('INSERT INTO bus_routes (id,student_name,trip_id,direction,label,scheduled_time) VALUES ($1,$2,$3,$4,$5,$6)', [id(10), 'Synthetic rider', 'synthetic-trip', 'am', 'Synthetic route', '07:30']);
    const sql = 'INSERT INTO bus_geofence_log (route_id,event_type,checkpoint_name,checkpoint_index,event_time,day_of_week,trip_date,gmail_message_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
    const params = [id(10), 'arrival', 'Synthetic stop', 0, '2026-10-21 07:30:00', 3, '2026-10-21', 'synthetic-message'];
    await db.query(sql, params);
    await expect(db.query(sql, params)).rejects.toMatchObject({ code: '23505' });
    await db.query(sql, [...params.slice(0, 7), 'synthetic-message-2']);
    expect(await one('SELECT count(*)::int AS count FROM bus_geofence_log')).toEqual({ count: 2 });
  });

  test('layout slug uniqueness applies only to nonnull slugs', async () => {
    await db.query('INSERT INTO layouts (id,slug) VALUES ($1,$2)', [id(10), 'synthetic-layout']);
    await expect(db.query('INSERT INTO layouts (id,slug) VALUES ($1,$2)', [id(11), 'synthetic-layout'])).rejects.toMatchObject({ code: '23505' });
    await db.query('INSERT INTO layouts (id) VALUES ($1),($2)', [id(12), id(13)]);
    expect(await one('SELECT count(*)::int AS count FROM layouts')).toEqual({ count: 3 });
  });

  test('birthday uniqueness includes event type', async () => {
    await db.query('INSERT INTO birthdays (id,name) VALUES ($1,$2)', [id(10), 'Synthetic occasion']);
    await expect(db.query('INSERT INTO birthdays (id,name) VALUES ($1,$2)', [id(11), 'Synthetic occasion'])).rejects.toMatchObject({ code: '23505' });
    await db.query('INSERT INTO birthdays (id,name,event_type) VALUES ($1,$2,$3)', [id(12), 'Synthetic occasion', 'anniversary']);
    expect(await one('SELECT count(*)::int AS count FROM birthdays')).toEqual({ count: 2 });
  });

  test('manual wishes allow repeated external labels when no source is set', async () => {
    const sql = 'INSERT INTO wish_items (member_id,name,external_id) VALUES ($1,$2,$3)';
    await db.query(sql, [id(1), 'Synthetic wish A', 'synthetic-item']);
    await db.query(sql, [id(1), 'Synthetic wish B', 'synthetic-item']);
    await db.query(sql, [id(1), 'Synthetic wish C', null]);
    expect(await one('SELECT count(*)::int AS count FROM wish_items')).toEqual({ count: 3 });
  });
});
