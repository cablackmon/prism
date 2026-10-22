import { addMembers, count, id, one, seedHousehold, withSchema } from './burn4-database';

const orphanWrites = [
  ['event source', 'events', 'INSERT INTO events (title,start_time,end_time,calendar_source_id) VALUES ($1,$2,$3,$4)', ['Synthetic orphan event', '2026-10-21 10:00', '2026-10-21 11:00', id(999)]],
  ['event creator', 'events', 'INSERT INTO events (title,start_time,end_time,created_by) VALUES ($1,$2,$3,$4)', ['Synthetic orphan creator', '2026-10-21 10:00', '2026-10-21 11:00', id(999)]],
  ['calendar group', 'calendar_sources', 'INSERT INTO calendar_sources (provider,source_calendar_id,dashboard_calendar_name,group_id) VALUES ($1,$2,$3,$4)', ['synthetic', 'orphan-calendar', 'Synthetic calendar', id(999)]],
  ['chore parent', 'chore_completions', 'INSERT INTO chore_completions (chore_id,completed_by) VALUES ($1,$2)', [id(999), id(2)]],
  ['chore completer', 'chore_completions', 'INSERT INTO chore_completions (chore_id,completed_by) VALUES ($1,$2)', [id(20), id(999)]],
  ['shopping list', 'shopping_items', 'INSERT INTO shopping_items (list_id,name) VALUES ($1,$2)', [id(999), 'Synthetic orphan item']],
  ['task list', 'tasks', 'INSERT INTO tasks (title,list_id) VALUES ($1,$2)', ['Synthetic orphan task', id(999)]],
  ['recipe source', 'recipes', 'INSERT INTO recipes (name,source_id) VALUES ($1,$2)', ['Synthetic orphan recipe', id(999)]],
  ['meal recipe', 'meals', 'INSERT INTO meals (name,recipe_id,week_of,date,day_of_week,meal_type) VALUES ($1,$2,$3,$4,$5,$6)', ['Synthetic orphan meal', id(999), '2026-10-19', '2026-10-21', 'wednesday', 'dinner']],
  ['travel photo pin', 'travel_pin_photos', 'INSERT INTO travel_pin_photos (pin_id,photo_id) VALUES ($1,$2)', [id(999), id(72)]],
  ['travel photo image', 'travel_pin_photos', 'INSERT INTO travel_pin_photos (pin_id,photo_id) VALUES ($1,$2)', [id(76), id(999)]],
  ['travel parent', 'travel_pins', 'INSERT INTO travel_pins (name,latitude,longitude,parent_id) VALUES ($1,$2,$3,$4)', ['Synthetic orphan place', 12, -34, id(999)]],
  ['travel trip', 'travel_pins', 'INSERT INTO travel_pins (name,latitude,longitude,trip_id) VALUES ($1,$2,$3,$4)', ['Synthetic orphan trip', 12, -34, id(999)]],
  ['weekend place', 'weekend_visits', 'INSERT INTO weekend_visits (place_id,visited_by,visited_on) VALUES ($1,$2,$3)', [id(999), id(1), '2026-10-21']],
  ['achievement member', 'goal_achievements', 'INSERT INTO goal_achievements (goal_id,user_id,period_start) VALUES ($1,$2,$3)', [id(60), id(999), '2026-10-20']],
  ['wish member', 'wish_items', 'INSERT INTO wish_items (member_id,name) VALUES ($1,$2)', [id(999), 'Synthetic orphan wish']],
  ['maintenance reminder', 'maintenance_completions', 'INSERT INTO maintenance_completions (reminder_id,completed_by) VALUES ($1,$2)', [id(999), id(1)]],
] satisfies [string, string, string, unknown[]][];

test.each(orphanWrites)('rejects dangling %s with a real FK violation and preserves committed household rows', (_label, table, sql, params) => withSchema(async (db) => {
  await seedHousehold(db);
  const before = await count(db, table);
  await expect(db.query(sql, params)).rejects.toMatchObject({ code: '23503', table });
  expect(await count(db, table)).toBe(before);
  expect(await one(db, 'SELECT name FROM users WHERE id=$1', [id(2)])).toEqual({ name: 'Synthetic child' });
}));

const requiredWrites = [
  ['member name', 'users', 'name', 'INSERT INTO users (role,color) VALUES ($1,$2)', ['child', '#123456']],
  ['member role', 'users', 'role', 'INSERT INTO users (name,color) VALUES ($1,$2)', ['Synthetic missing role', '#123456']],
  ['event end', 'events', 'end_time', 'INSERT INTO events (title,start_time) VALUES ($1,$2)', ['Synthetic missing end', '2026-10-21 10:00']],
  ['chore frequency', 'chores', 'frequency', 'INSERT INTO chores (title,category) VALUES ($1,$2)', ['Synthetic missing frequency', 'ordinary']],
  ['message body', 'family_messages', 'message', 'INSERT INTO family_messages (author_id) VALUES ($1)', [id(1)]],
  ['shopping name', 'shopping_items', 'name', 'INSERT INTO shopping_items (list_id) VALUES ($1)', [id(30)]],
  ['meal date', 'meals', 'date', 'INSERT INTO meals (name,week_of,day_of_week,meal_type) VALUES ($1,$2,$3,$4)', ['Synthetic missing date', '2026-10-19', 'wednesday', 'dinner']],
  ['travel latitude', 'travel_pins', 'latitude', 'INSERT INTO travel_pins (name,longitude) VALUES ($1,$2)', ['Synthetic missing latitude', -34]],
  ['layout widgets', 'layouts', 'widgets', 'INSERT INTO layouts (name) VALUES ($1)', ['Synthetic missing widgets']],
] satisfies [string, string, string, string, unknown[]][];

test.each(requiredWrites)('rejects missing %s at its declared ordinary column', (_label, table, column, sql, params) => withSchema(async (db) => {
  await seedHousehold(db);
  const before = await count(db, table);
  await expect(db.query(sql, params)).rejects.toMatchObject({ code: '23502', table, column });
  expect(await count(db, table)).toBe(before);
  expect(await one(db, 'SELECT name FROM users WHERE id=$1', [id(1)])).toEqual({ name: 'Synthetic parent' });
}));

test('ordinary migration names are unique and sequence identities survive rejected duplicates', () => withSchema(async (db) => {
  const first = await one<{ id: number }>(db, 'INSERT INTO __prism_migrations (name) VALUES ($1) RETURNING id', ['burn4-synthetic-a.sql']);
  await expect(db.query('INSERT INTO __prism_migrations (name) VALUES ($1)', ['burn4-synthetic-a.sql'])).rejects.toMatchObject({ code: '23505', table: '__prism_migrations' });
  const second = await one<{ id: number }>(db, 'INSERT INTO __prism_migrations (name) VALUES ($1) RETURNING id', ['burn4-synthetic-b.sql']);
  expect(second.id).toBeGreaterThan(first.id);
  expect((await db.query('SELECT name FROM __prism_migrations ORDER BY id')).rows).toEqual([{ name: 'burn4-synthetic-a.sql' }, { name: 'burn4-synthetic-b.sql' }]);
}));

test('ordinary settings keys and nonnull layout slugs enforce identities while NULL slugs coexist', () => withSchema(async (db) => {
  await addMembers(db);
  await db.query('INSERT INTO settings (key,value) VALUES ($1,$2::jsonb)', ['burn4OrdinaryPreference', '{"theme":"synthetic"}']);
  await expect(db.query('INSERT INTO settings (key,value) VALUES ($1,$2::jsonb)', ['burn4OrdinaryPreference', '{}'])).rejects.toMatchObject({ code: '23505', table: 'settings' });
  const sql = 'INSERT INTO layouts (name,widgets,slug,created_by) VALUES ($1,$2::jsonb,$3,$4)';
  await db.query(sql, ['Synthetic A', '[{"type":"clock"}]', 'synthetic-slug', id(1)]);
  await expect(db.query(sql, ['Synthetic duplicate', '[]', 'synthetic-slug', id(2)])).rejects.toMatchObject({ code: '23505', table: 'layouts' });
  await db.query(sql, ['Synthetic B', '[]', null, id(1)]);
  await db.query(sql, ['Synthetic C', '[]', null, id(2)]);
  expect(await count(db, 'layouts')).toBe(3);
  expect(await one(db, 'SELECT value FROM settings WHERE key=$1', ['burn4OrdinaryPreference'])).toEqual({ value: { theme: 'synthetic' } });
}));

test('achievement uniqueness combines goal, member and date while all parent references remain valid', () => withSchema(async (db) => {
  await seedHousehold(db);
  const sql = 'INSERT INTO goal_achievements (goal_id,user_id,period_start) VALUES ($1,$2,$3)';
  await expect(db.query(sql, [id(60), id(1), '2026-10-19'])).rejects.toMatchObject({ code: '23505', table: 'goal_achievements' });
  await db.query(sql, [id(61), id(1), '2026-10-19']);
  await db.query(sql, [id(60), id(2), '2026-10-19']);
  await db.query(sql, [id(60), id(1), '2026-10-20']);
  expect(await count(db, 'goal_achievements')).toBe(5);
}));

test('travel join uniqueness rejects one existing pair and permits distinct actual pin/photo pairs', () => withSchema(async (db) => {
  await seedHousehold(db);
  const sql = 'INSERT INTO travel_pin_photos (pin_id,photo_id) VALUES ($1,$2)';
  await expect(db.query(sql, [id(76), id(72)])).rejects.toMatchObject({ code: '23505', table: 'travel_pin_photos' });
  await db.query(sql, [id(76), id(73)]);
  await db.query(sql, [id(78), id(72)]);
  expect(await count(db, 'travel_pin_photos')).toBe(5);
  expect(await count(db, 'photos')).toBe(2);
}));

test('external event identity is source-scoped and permits PostgreSQL NULL combinations', () => withSchema(async (db) => {
  await seedHousehold(db);
  const sql = 'INSERT INTO events (title,start_time,end_time,calendar_source_id,external_event_id) VALUES ($1,$2,$3,$4,$5)';
  const ordinary = ['Synthetic extra event', '2026-10-22 10:00', '2026-10-22 11:00'];
  await expect(db.query(sql, [...ordinary, id(12), 'event-1'])).rejects.toMatchObject({ code: '23505', table: 'events' });
  await db.query(sql, [...ordinary, id(13), 'event-1']);
  await db.query(sql, [...ordinary, null, 'event-1']);
  await db.query(sql, [...ordinary, null, 'event-1']);
  await db.query(sql, [...ordinary, id(12), null]);
  await db.query(sql, [...ordinary, id(12), null]);
  expect(await count(db, 'events')).toBe(8);
}));

test('external recipe identity is source-scoped and permits PostgreSQL NULL combinations', () => withSchema(async (db) => {
  await seedHousehold(db);
  const sql = 'INSERT INTO recipes (name,source_id,external_id) VALUES ($1,$2,$3)';
  await expect(db.query(sql, ['Synthetic duplicate', id(50), 'recipe-1'])).rejects.toMatchObject({ code: '23505', table: 'recipes' });
  await db.query(sql, ['Synthetic other source', id(51), 'recipe-1']);
  await db.query(sql, ['Synthetic manual A', null, 'recipe-1']);
  await db.query(sql, ['Synthetic manual B', null, 'recipe-1']);
  await db.query(sql, ['Synthetic no external A', id(50), null]);
  await db.query(sql, ['Synthetic no external B', id(50), null]);
  expect(await count(db, 'recipes')).toBe(7);
}));

const tombstones = [
  ['dismissed_events', 'calendar_source_id', 'external_event_id', 12, 13, 'gone-event'],
  ['dismissed_tasks', 'task_source_id', 'external_task_id', 42, 43, 'gone-task'],
  ['excluded_photos', 'source_id', 'external_id', 70, 71, 'gone-photo'],
] as const;

test.each(tombstones)('%s identities reject duplicate source/external pairs and accept each distinct dimension', (table, sourceColumn, externalColumn, sourceA, sourceB, external) => withSchema(async (db) => {
  await seedHousehold(db);
  const sql = 'INSERT INTO ' + table + ' (' + sourceColumn + ',' + externalColumn + ') VALUES ($1,$2)';
  await expect(db.query(sql, [id(sourceA), external])).rejects.toMatchObject({ code: '23505', table });
  await db.query(sql, [id(sourceA), 'synthetic-new-external']);
  await db.query(sql, [id(sourceB), 'synthetic-new-external']);
  await expect(db.query(sql, [id(999), 'synthetic-orphan'])).rejects.toMatchObject({ code: '23503', table });
  expect(await count(db, table)).toBe(4);
}));

test('dismissed birthday identity combines normalized name, month, day and event type', () => withSchema(async (db) => {
  const sql = 'INSERT INTO dismissed_birthdays (normalized_name,birth_month,birth_day,event_type) VALUES ($1,$2,$3,$4)';
  const original = ['synthetic occasion', 10, 21, 'birthday'];
  await db.query(sql, original);
  await expect(db.query(sql, original)).rejects.toMatchObject({ code: '23505', table: 'dismissed_birthdays' });
  await db.query(sql, ['synthetic other occasion', 10, 21, 'birthday']);
  await db.query(sql, ['synthetic occasion', 11, 21, 'birthday']);
  await db.query(sql, ['synthetic occasion', 10, 22, 'birthday']);
  await db.query(sql, ['synthetic occasion', 10, 21, 'anniversary']);
  expect(await one(db, 'SELECT count(*)::int AS count FROM dismissed_birthdays')).toEqual({ count: 5 });
}));
