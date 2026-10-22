import { addMembers, bootstrap, count, id, one, seedHousehold, withSchema } from './burn4-database';

test('ordinary JSON defaults stay independent and preserve the other household member', () => withSchema(async (db) => {
  await addMembers(db);
  expect(await one(db, 'SELECT preferences,sort_order,pin_length FROM users WHERE id=$1', [id(1)])).toEqual({ preferences: {}, sort_order: 0, pin_length: 4 });
  await db.query('UPDATE users SET preferences=$1::jsonb WHERE id=$2', ['{"ordinary":{"widgets":["clock"]}}', id(1)]);
  expect(await one(db, 'SELECT preferences FROM users WHERE id=$1', [id(1)])).toEqual({ preferences: { ordinary: { widgets: ['clock'] } } });
  expect(await one(db, 'SELECT preferences FROM users WHERE id=$1', [id(2)])).toEqual({ preferences: {} });
  const inserted = await one<{ id: string; created_at: Date; enabled: boolean; point_value: number }>(db, 'INSERT INTO chores (title,category,frequency) VALUES ($1,$2,$3) RETURNING id,created_at,enabled,point_value', ['Synthetic generated chore', 'ordinary', 'daily']);
  expect(inserted.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(inserted.created_at).toBeInstanceOf(Date);
  expect(inserted.enabled).toBe(true);
  expect(inserted.point_value).toBe(0);
}));

test('explicit household transaction rolls back partial feature writes and a corrected retry commits', () => withSchema(async (db) => {
  await seedHousehold(db);
  await db.exec('BEGIN;');
  try {
    await db.query('INSERT INTO chores (id,title,category,frequency,created_by) VALUES ($1,$2,$3,$4,$5)', [id(200), 'Synthetic transaction chore', 'ordinary', 'daily', id(1)]);
    await db.query('INSERT INTO family_messages (id,message,author_id) VALUES ($1,$2,$3)', [id(201), 'Synthetic transaction message', id(1)]);
    await expect(db.query('INSERT INTO tasks (id,title,list_id) VALUES ($1,$2,$3)', [id(202), 'Synthetic transaction task', id(999)])).rejects.toMatchObject({ code: '23503', table: 'tasks' });
  } finally {
    await db.exec('ROLLBACK;');
  }
  expect((await db.query('SELECT id FROM chores WHERE id=$1', [id(200)])).rows).toEqual([]);
  expect((await db.query('SELECT id FROM family_messages WHERE id=$1', [id(201)])).rows).toEqual([]);
  expect(await count(db, 'chores')).toBe(2);
  expect(await count(db, 'family_messages')).toBe(2);
  await db.exec('BEGIN;');
  try {
    await db.query('INSERT INTO chores (id,title,category,frequency,created_by) VALUES ($1,$2,$3,$4,$5)', [id(200), 'Synthetic transaction chore', 'ordinary', 'daily', id(1)]);
    await db.query('INSERT INTO family_messages (id,message,author_id) VALUES ($1,$2,$3)', [id(201), 'Synthetic transaction message', id(1)]);
    await db.query('INSERT INTO tasks (id,title,list_id) VALUES ($1,$2,$3)', [id(202), 'Synthetic transaction task', id(40)]);
    await db.exec('COMMIT;');
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
  expect(await count(db, 'chores')).toBe(3);
  expect(await count(db, 'family_messages')).toBe(3);
  expect(await count(db, 'tasks')).toBe(4);
  expect(await one(db, 'SELECT name FROM users WHERE id=$1', [id(2)])).toEqual({ name: 'Synthetic child' });
}));

test('the declared trigger function returns NEW with transaction-time updated_at through test-owned invocation scaffolding', () => withSchema(async (db) => {
  expect(await one(db, 'SELECT count(*)::int AS count FROM pg_trigger WHERE NOT tgisinternal')).toEqual({ count: 0 });
  await db.exec("CREATE TEMP TABLE burn4_timestamp_record (id integer PRIMARY KEY,label text NOT NULL,ordinary jsonb NOT NULL,updated_at timestamp NOT NULL); CREATE TRIGGER burn4_timestamp BEFORE UPDATE ON burn4_timestamp_record FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();");
  await db.query('INSERT INTO burn4_timestamp_record (id,label,ordinary,updated_at) VALUES ($1,$2,$3::jsonb,$4)', [1, 'Synthetic before', '{"kept":true}', '2000-01-01 00:00:00']);
  await db.exec('BEGIN;');
  try {
    const now = await one<{ stamp: Date }>(db, 'SELECT transaction_timestamp()::timestamp AS stamp');
    const changed = await one<{ label: string; ordinary: unknown; updated_at: Date }>(db, 'UPDATE burn4_timestamp_record SET label=$1,updated_at=$2 WHERE id=1 RETURNING label,ordinary,updated_at', ['Synthetic after', '2001-01-01 00:00:00']);
    expect(changed).toEqual({ label: 'Synthetic after', ordinary: { kept: true }, updated_at: now.stamp });
    expect(changed.updated_at.getFullYear()).toBeGreaterThan(2001);
    expect(await one(db, 'UPDATE burn4_timestamp_record SET label=label WHERE id=1 RETURNING label,updated_at')).toEqual({ label: 'Synthetic after', updated_at: now.stamp });
  } finally {
    await db.exec('ROLLBACK;');
  }
  expect(await one(db, 'SELECT label,updated_at::date::text AS date FROM burn4_timestamp_record')).toEqual({ label: 'Synthetic before', date: '2000-01-01' });
}));

test('full-dump replay is characterized as a duplicate-object rejection and preserves earlier committed rows', () => withSchema(async (db) => {
  await addMembers(db);
  await db.query('INSERT INTO calendar_notes (date,content,created_by) VALUES ($1,$2,$3)', ['2026-10-21', 'Synthetic committed note', id(1)]);
  await expect(bootstrap(db)).rejects.toMatchObject({ code: '42P07', message: expect.stringContaining('__prism_migrations_name_key') });
  expect(await count(db, 'users')).toBe(2);
  expect(await one(db, 'SELECT content,created_by FROM calendar_notes')).toEqual({ content: 'Synthetic committed note', created_by: id(1) });
}));
