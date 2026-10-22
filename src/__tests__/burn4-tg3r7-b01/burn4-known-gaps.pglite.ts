import { addMembers, db, familyLength, id, migrate, one, resetLegacy, rows } from './burn4-database';

beforeEach(async () => {
  await resetLegacy();
  await migrate('catchup');
  await addMembers();
  await db.query('INSERT INTO goals (id,name,point_cost) VALUES ($1,$2,$3)', [id(10), 'Synthetic goal', 5]);
});
afterAll(async () => { await db.close(); });

test.failing('KNOWN GAP: catch-up missing foreign keys accept orphan application references', async () => {
  const cases = [
    ['achievement goal', 'INSERT INTO goal_achievements (goal_id,user_id,period_start) VALUES ($1,$2,$3)', [id(999), id(1), '2026-10-21']],
    ['achievement member', 'INSERT INTO goal_achievements (goal_id,user_id,period_start) VALUES ($1,$2,$3)', [id(10), id(999), '2026-10-21']],
    ['task-list creator', 'INSERT INTO task_lists (name,created_by) VALUES ($1,$2)', ['Synthetic list', id(999)]],
    ['recipe creator', 'INSERT INTO recipes (name,created_by) VALUES ($1,$2)', ['Synthetic recipe', id(999)]],
    ['wish member', 'INSERT INTO wish_items (member_id,name) VALUES ($1,$2)', [id(999), 'Synthetic wish']],
    ['wish source', 'INSERT INTO wish_items (member_id,name,wish_item_source_id) VALUES ($1,$2,$3)', [id(1), 'Synthetic sourced wish', id(999)]],
    ['calendar-note creator', 'INSERT INTO calendar_notes (date,created_by) VALUES ($1,$2)', ['2026-10-21', id(999)]],
    ['gift recipient', 'INSERT INTO gift_ideas (created_by,for_user_id,name) VALUES ($1,$2,$3)', [id(1), id(999), 'Synthetic gift']],
    ['bus-log route', 'INSERT INTO bus_geofence_log (route_id,event_type,checkpoint_name,checkpoint_index,event_time,day_of_week,trip_date,gmail_message_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id(999), 'arrival', 'Synthetic stop', 0, '2026-10-21 07:30:00', 3, '2026-10-21', 'synthetic-message']],
    ['task list', 'INSERT INTO tasks (id,list_id) VALUES ($1,$2)', [id(30), id(999)]],
    ['shopping source', 'INSERT INTO shopping_items (id,shopping_list_source_id) VALUES ($1,$2)', [id(30), id(999)]],
    ['meal recipe', 'INSERT INTO meals (id,recipe_id) VALUES ($1,$2)', [id(30), id(999)]],
  ] satisfies [string, string, unknown[]][];
  const actual: Record<string, unknown> = {};
  for (const [name, sql, params] of cases) {
    try {
      await db.query(sql, params);
      actual[name] = 'insert resolved';
    } catch (error) {
      actual[name] = typeof error === 'object' && error !== null && 'code' in error ? error.code : 'unexpected error';
    }
  }
  expect(actual).toEqual(Object.fromEntries(cases.map(([name]) => [name, '23503'])));
});

test.failing('KNOWN GAP: catch-up missing cascades retain dependent achievements, gifts, wishes and bus logs', async () => {
  await db.query('INSERT INTO goal_achievements (goal_id,user_id,period_start) VALUES ($1,$2,$3)', [id(10), id(1), '2026-10-21']);
  await db.query('INSERT INTO gift_ideas (created_by,for_user_id,name) VALUES ($1,$2,$3)', [id(2), id(1), 'Synthetic gift']);
  await db.query('INSERT INTO wish_items (member_id,name) VALUES ($1,$2)', [id(1), 'Synthetic wish']);
  await db.query('INSERT INTO bus_routes (id,student_name,trip_id,direction,label,scheduled_time) VALUES ($1,$2,$3,$4,$5,$6)', [id(20), 'Synthetic rider', 'synthetic-trip', 'am', 'Synthetic route', '07:30']);
  await db.query('INSERT INTO bus_geofence_log (route_id,event_type,checkpoint_name,checkpoint_index,event_time,day_of_week,trip_date,gmail_message_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id(20), 'arrival', 'Synthetic stop', 0, '2026-10-21 07:30:00', 3, '2026-10-21', 'synthetic-message']);
  await db.query('DELETE FROM goals WHERE id = $1', [id(10)]);
  await db.query('DELETE FROM bus_routes WHERE id = $1', [id(20)]);
  await db.query('DELETE FROM users WHERE id = $1', [id(1)]);
  const remaining = await one('SELECT (SELECT count(*)::int FROM goal_achievements) AS achievements, (SELECT count(*)::int FROM gift_ideas) AS gifts, (SELECT count(*)::int FROM wish_items) AS wishes, (SELECT count(*)::int FROM bus_geofence_log) AS bus_logs');
  expect(remaining).toEqual({ achievements: 0, gifts: 0, wishes: 0, bus_logs: 0 });
});

test.failing('KNOWN GAP: catch-up missing SET NULL actions retain references to deleted creators', async () => {
  await db.query('INSERT INTO task_lists (name,created_by) VALUES ($1,$2)', ['Synthetic list', id(1)]);
  await db.query('INSERT INTO recipes (name,created_by) VALUES ($1,$2)', ['Synthetic recipe', id(1)]);
  await db.query('INSERT INTO audit_logs (user_id,action,entity_type,summary) VALUES ($1,$2,$3,$4)', [id(1), 'create', 'fixture', 'Synthetic update']);
  await db.query('INSERT INTO calendar_notes (date,created_by) VALUES ($1,$2)', ['2026-10-21', id(1)]);
  await db.query('INSERT INTO wish_items (member_id,name,added_by,claimed_by) VALUES ($1,$2,$3,$3)', [id(2), 'Synthetic wish', id(1)]);
  await db.query('DELETE FROM users WHERE id = $1', [id(1)]);
  const references = await one('SELECT (SELECT created_by FROM task_lists) AS list_creator, (SELECT created_by FROM recipes) AS recipe_creator, (SELECT user_id FROM audit_logs) AS audit_member, (SELECT created_by FROM calendar_notes) AS note_creator, (SELECT added_by FROM wish_items) AS wish_creator, (SELECT claimed_by FROM wish_items) AS wish_claimer');
  expect(references).toEqual({ list_creator: null, recipe_creator: null, audit_member: null, note_creator: null, wish_creator: null, wish_claimer: null });
  expect(await one('SELECT count(*)::int AS count FROM wish_items')).toEqual({ count: 1 });
});

test.failing('KNOWN GAP: member-length replay overwrites later per-member choices with the family setting', async () => {
  await familyLength(5);
  await migrate('length');
  await db.query('UPDATE users SET pin_length = 6 WHERE id = $1', [id(1)]);
  await migrate('length');
  expect(await rows('SELECT id,pin_length FROM users ORDER BY id')).toEqual([
    { id: id(1), pin_length: 6 },
    { id: id(2), pin_length: 5 },
  ]);
});
