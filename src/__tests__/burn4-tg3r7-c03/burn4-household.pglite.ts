import { count, Database, id, one, seedHousehold, withSchema } from './burn4-database';

async function household(run: (db: Database) => Promise<void>): Promise<void> {
  await withSchema(async (db) => { await seedHousehold(db); await run(db); });
}

test('full raw bootstrap supports a connected synthetic household and preserves ordinary JSON', () => household(async (db) => {
  expect(await one(db, 'SELECT u.name,r.name AS recipe,m.name AS meal,r.ingredients,r.tags,l.widgets FROM users u JOIN recipes r ON r.created_by=u.id JOIN meals m ON m.recipe_id=r.id JOIN layouts l ON l.created_by=u.id WHERE u.id=$1', [id(1)]))
    .toEqual({ name: 'Synthetic parent', recipe: 'Synthetic recipe 1', meal: 'Synthetic meal 1', ingredients: [{ name: 'water', amount: 1 }], tags: ['ordinary'], widgets: [{ type: 'clock' }] });
  expect(await count(db, 'photos')).toBe(2);
  expect(await count(db, 'travel_pin_photos')).toBe(3);
  expect(await count(db, 'chore_completions')).toBe(2);
}));

test('member deletion cascades mandatory ownership and retains nullable household ownership', () => household(async (db) => {
  expect(await count(db, 'users')).toBe(2);
  expect(await count(db, 'events')).toBe(3);
  expect(await count(db, 'gift_ideas')).toBe(3);
  await db.query('DELETE FROM users WHERE id=$1', [id(1)]);
  expect((await db.query('SELECT id FROM users ORDER BY id')).rows).toEqual([{ id: id(2) }]);
  expect((await db.query('SELECT id FROM family_messages ORDER BY id')).rows).toEqual([{ id: id(25) }]);
  expect((await db.query('SELECT id FROM gift_ideas ORDER BY id')).rows).toEqual([{ id: id(65) }]);
  expect((await db.query('SELECT id FROM goal_achievements ORDER BY id')).rows).toEqual([{ id: id(63) }]);
  expect((await db.query('SELECT id FROM calendar_sources ORDER BY id')).rows).toEqual([{ id: id(13) }]);
  expect((await db.query('SELECT id FROM events ORDER BY id')).rows).toEqual([{ id: id(15) }, { id: id(16) }]);
  expect(await one(db, 'SELECT created_by FROM events WHERE id=$1', [id(16)])).toEqual({ created_by: null });
  expect(await one(db, 'SELECT title,assigned_to,created_by FROM chores WHERE id=$1', [id(20)])).toEqual({ title: 'Synthetic chore 1', assigned_to: null, created_by: null });
  expect(await one(db, 'SELECT completed_by,approved_by,points_awarded FROM chore_completions WHERE id=$1', [id(22)])).toEqual({ completed_by: id(2), approved_by: null, points_awarded: 5 });
  expect((await db.query('SELECT id FROM chore_completions')).rows).toEqual([{ id: id(22) }]);
  expect(await one(db, 'SELECT created_by,assigned_to,visible_categories FROM shopping_lists WHERE id=$1', [id(30)])).toEqual({ created_by: null, assigned_to: null, visible_categories: ['ordinary'] });
  expect(await one(db, 'SELECT added_by,shopping_list_source_id,name FROM shopping_items WHERE id=$1', [id(34)])).toEqual({ added_by: null, shopping_list_source_id: null, name: 'Synthetic item 1' });
  expect(await one(db, 'SELECT assigned_to,created_by,completed_by,task_source_id FROM tasks WHERE id=$1', [id(44)])).toEqual({ assigned_to: null, created_by: null, completed_by: null, task_source_id: null });
  expect(await one(db, 'SELECT created_by FROM recipe_sources WHERE id=$1', [id(50)])).toEqual({ created_by: null });
  expect(await one(db, 'SELECT created_by,ingredients FROM recipes WHERE id=$1', [id(52)])).toEqual({ created_by: null, ingredients: [{ name: 'water', amount: 1 }] });
  expect(await one(db, 'SELECT created_by,cooked_by,recipe_id FROM meals WHERE id=$1', [id(54)])).toEqual({ created_by: null, cooked_by: null, recipe_id: id(52) });
  expect(await one(db, 'SELECT created_by FROM travel_trips WHERE id=$1', [id(74)])).toEqual({ created_by: null });
  expect(await one(db, 'SELECT created_by FROM travel_pins WHERE id=$1', [id(76)])).toEqual({ created_by: null });
  expect(await one(db, 'SELECT created_by FROM weekend_places WHERE id=$1', [id(90)])).toEqual({ created_by: null });
  expect(await one(db, 'SELECT visited_by FROM weekend_visits WHERE id=$1', [id(92)])).toEqual({ visited_by: null });
  expect(await one(db, 'SELECT created_by,assigned_to FROM maintenance_reminders WHERE id=$1', [id(100)])).toEqual({ created_by: null, assigned_to: null });
  expect(await one(db, 'SELECT completed_by FROM maintenance_completions WHERE id=$1', [id(102)])).toEqual({ completed_by: null });
  expect(await one(db, 'SELECT wish_item_source_id,added_by,claimed_by,member_id FROM wish_items WHERE id=$1', [id(112)])).toEqual({ wish_item_source_id: null, added_by: null, claimed_by: null, member_id: id(2) });
  expect(await one(db, 'SELECT created_by FROM calendar_notes WHERE id=$1', [id(120)])).toEqual({ created_by: null });
  expect(await one(db, 'SELECT user_id FROM audit_logs WHERE id=$1', [id(122)])).toEqual({ user_id: null });
  expect(await one(db, 'SELECT user_id FROM bus_routes WHERE id=$1', [id(124)])).toEqual({ user_id: null });
  expect(await one(db, 'SELECT user_id FROM birthdays WHERE id=$1', [id(128)])).toEqual({ user_id: null });
  expect(await one(db, 'SELECT created_by,widgets FROM layouts WHERE id=$1', [id(130)])).toEqual({ created_by: null, widgets: [{ type: 'clock' }] });
  expect(await count(db, 'photos')).toBe(2);
  expect(await count(db, 'travel_pin_photos')).toBe(3);
  expect(await one(db, 'SELECT assigned_to,created_by FROM chores WHERE id=$1', [id(21)])).toEqual({ assigned_to: id(2), created_by: id(2) });
  expect(await one(db, 'SELECT created_by FROM recipes WHERE id=$1', [id(53)])).toEqual({ created_by: id(2) });
}));

test('completer deletion removes mandatory completions and wishes while retaining another approver-owned completion', () => household(async (db) => {
  expect((await db.query('SELECT id FROM chore_completions ORDER BY id')).rows).toEqual([{ id: id(22) }, { id: id(23) }]);
  await db.query('DELETE FROM users WHERE id=$1', [id(2)]);
  expect((await db.query('SELECT id,completed_by,approved_by FROM chore_completions')).rows).toEqual([{ id: id(23), completed_by: id(1), approved_by: null }]);
  expect(await count(db, 'wish_items')).toBe(0);
  expect(await one(db, 'SELECT title,created_by FROM chores WHERE id=$1', [id(20)])).toEqual({ title: 'Synthetic chore 1', created_by: id(1) });
  expect((await db.query('SELECT id FROM family_messages')).rows).toEqual([{ id: id(24) }]);
}));

test('calendar group deletion detaches its source and leaves events and unrelated group intact', () => household(async (db) => {
  expect(await one(db, 'SELECT group_id FROM calendar_sources WHERE id=$1', [id(12)])).toEqual({ group_id: id(10) });
  await db.query('DELETE FROM calendar_groups WHERE id=$1', [id(10)]);
  expect(await one(db, 'SELECT group_id FROM calendar_sources WHERE id=$1', [id(12)])).toEqual({ group_id: null });
  expect(await one(db, 'SELECT group_id FROM calendar_sources WHERE id=$1', [id(13)])).toEqual({ group_id: id(11) });
  expect(await count(db, 'events')).toBe(3);
}));

test('calendar source deletion removes its event and tombstone but preserves local and other-source events', () => household(async (db) => {
  expect(await count(db, 'dismissed_events')).toBe(2);
  await db.query('DELETE FROM calendar_sources WHERE id=$1', [id(12)]);
  expect((await db.query('SELECT id FROM events ORDER BY id')).rows).toEqual([{ id: id(15) }, { id: id(16) }]);
  expect((await db.query('SELECT id FROM dismissed_events')).rows).toEqual([{ id: id(141) }]);
  expect(await one(db, 'SELECT id FROM calendar_sources')).toEqual({ id: id(13) });
}));

test('chore deletion removes its completions and keeps the other chore graph', () => household(async (db) => {
  expect(await count(db, 'chore_completions')).toBe(2);
  await db.query('DELETE FROM chores WHERE id=$1', [id(20)]);
  expect((await db.query('SELECT id FROM chore_completions')).rows).toEqual([{ id: id(23) }]);
  expect(await one(db, 'SELECT id,title FROM chores')).toEqual({ id: id(21), title: 'Synthetic chore 2' });
}));

test('task source deletion retains tasks and list while removing only that source tombstone', () => household(async (db) => {
  expect(await one(db, 'SELECT task_source_id FROM tasks WHERE id=$1', [id(44)])).toEqual({ task_source_id: id(42) });
  await db.query('DELETE FROM task_sources WHERE id=$1', [id(42)]);
  expect(await one(db, 'SELECT title,task_source_id,list_id FROM tasks WHERE id=$1', [id(44)])).toEqual({ title: 'Synthetic task 1', task_source_id: null, list_id: id(40) });
  expect((await db.query('SELECT id FROM dismissed_tasks')).rows).toEqual([{ id: id(143) }]);
  expect(await one(db, 'SELECT task_source_id FROM tasks WHERE id=$1', [id(45)])).toEqual({ task_source_id: id(43) });
  expect(await count(db, 'tasks')).toBe(3);
}));

test('task list deletion cascades source, task and tombstone while keeping unlisted and unrelated tasks', () => household(async (db) => {
  expect(await count(db, 'task_sources')).toBe(2);
  await db.query('DELETE FROM task_lists WHERE id=$1', [id(40)]);
  expect((await db.query('SELECT id FROM tasks ORDER BY id')).rows).toEqual([{ id: id(45) }, { id: id(46) }]);
  expect((await db.query('SELECT id FROM task_sources')).rows).toEqual([{ id: id(43) }]);
  expect((await db.query('SELECT id FROM dismissed_tasks')).rows).toEqual([{ id: id(143) }]);
}));

test('shopping source deletion detaches its item without removing either list', () => household(async (db) => {
  expect(await one(db, 'SELECT shopping_list_source_id FROM shopping_items WHERE id=$1', [id(34)])).toEqual({ shopping_list_source_id: id(32) });
  await db.query('DELETE FROM shopping_list_sources WHERE id=$1', [id(32)]);
  expect(await one(db, 'SELECT name,shopping_list_source_id FROM shopping_items WHERE id=$1', [id(34)])).toEqual({ name: 'Synthetic item 1', shopping_list_source_id: null });
  expect(await one(db, 'SELECT shopping_list_source_id FROM shopping_items WHERE id=$1', [id(35)])).toEqual({ shopping_list_source_id: id(33) });
  expect(await count(db, 'shopping_lists')).toBe(2);
}));

test('shopping list deletion cascades its source and item while keeping the other graph', () => household(async (db) => {
  expect(await count(db, 'shopping_items')).toBe(2);
  await db.query('DELETE FROM shopping_lists WHERE id=$1', [id(30)]);
  expect((await db.query('SELECT id FROM shopping_items')).rows).toEqual([{ id: id(35) }]);
  expect((await db.query('SELECT id FROM shopping_list_sources')).rows).toEqual([{ id: id(33) }]);
  expect(await one(db, 'SELECT id,name FROM shopping_lists')).toEqual({ id: id(31), name: 'Synthetic shopping list 2' });
}));

test('recipe source deletion keeps recipe JSON and meal association while clearing the source', () => household(async (db) => {
  expect(await one(db, 'SELECT source_id FROM recipes WHERE id=$1', [id(52)])).toEqual({ source_id: id(50) });
  await db.query('DELETE FROM recipe_sources WHERE id=$1', [id(50)]);
  expect(await one(db, 'SELECT source_id,external_id,ingredients,tags FROM recipes WHERE id=$1', [id(52)])).toEqual({ source_id: null, external_id: 'recipe-1', ingredients: [{ name: 'water', amount: 1 }], tags: ['ordinary'] });
  expect(await one(db, 'SELECT recipe_id FROM meals WHERE id=$1', [id(54)])).toEqual({ recipe_id: id(52) });
  expect(await one(db, 'SELECT source_id FROM recipes WHERE id=$1', [id(53)])).toEqual({ source_id: id(51) });
}));

test('recipe deletion retains a detached meal and the unrelated recipe graph', () => household(async (db) => {
  expect(await count(db, 'recipes')).toBe(2);
  await db.query('DELETE FROM recipes WHERE id=$1', [id(52)]);
  expect(await one(db, 'SELECT name,recipe_id FROM meals WHERE id=$1', [id(54)])).toEqual({ name: 'Synthetic meal 1', recipe_id: null });
  expect(await one(db, 'SELECT recipe_id FROM meals WHERE id=$1', [id(55)])).toEqual({ recipe_id: id(53) });
  expect(await count(db, 'recipe_sources')).toBe(2);
}));

test('photo source deletion removes its photo, joins and tombstone while retaining travel places and another source', () => household(async (db) => {
  expect(await count(db, 'travel_pin_photos')).toBe(3);
  await db.query('DELETE FROM photo_sources WHERE id=$1', [id(70)]);
  expect((await db.query('SELECT id FROM photos')).rows).toEqual([{ id: id(73) }]);
  expect((await db.query('SELECT id FROM travel_pin_photos')).rows).toEqual([{ id: id(81) }]);
  expect((await db.query('SELECT id FROM excluded_photos')).rows).toEqual([{ id: id(145) }]);
  expect(await count(db, 'travel_pins')).toBe(3);
  expect(await count(db, 'travel_trips')).toBe(2);
  expect(await one(db, 'SELECT id,name FROM photo_sources')).toEqual({ id: id(71), name: 'Synthetic photo source 2' });
}));

test('trip deletion removes all its pins and joins but leaves photos and another trip intact', () => household(async (db) => {
  expect(await count(db, 'travel_pins')).toBe(3);
  await db.query('DELETE FROM travel_trips WHERE id=$1', [id(74)]);
  expect((await db.query('SELECT id FROM travel_pins')).rows).toEqual([{ id: id(78) }]);
  expect((await db.query('SELECT id FROM travel_pin_photos')).rows).toEqual([{ id: id(81) }]);
  expect(await count(db, 'photos')).toBe(2);
  expect(await one(db, 'SELECT id FROM travel_trips')).toEqual({ id: id(75) });
}));

test('parent pin deletion removes its child and joins while keeping trip, photos and unrelated pins', () => household(async (db) => {
  expect(await one(db, 'SELECT parent_id FROM travel_pins WHERE id=$1', [id(77)])).toEqual({ parent_id: id(76) });
  await db.query('DELETE FROM travel_pins WHERE id=$1', [id(76)]);
  expect((await db.query('SELECT id FROM travel_pins')).rows).toEqual([{ id: id(78) }]);
  expect((await db.query('SELECT id FROM travel_pin_photos')).rows).toEqual([{ id: id(81) }]);
  expect(await count(db, 'travel_trips')).toBe(2);
  expect(await count(db, 'photos')).toBe(2);
}));

test('photo deletion removes joins while preserving pins and another photo graph', () => household(async (db) => {
  expect(await count(db, 'travel_pin_photos')).toBe(3);
  await db.query('DELETE FROM photos WHERE id=$1', [id(72)]);
  expect((await db.query('SELECT id FROM travel_pin_photos')).rows).toEqual([{ id: id(81) }]);
  expect(await count(db, 'travel_pins')).toBe(3);
  expect(await count(db, 'photo_sources')).toBe(2);
  expect(await one(db, 'SELECT id FROM photos')).toEqual({ id: id(73) });
}));

test('weekend place deletion removes its visits while keeping the other place and visit', () => household(async (db) => {
  expect(await count(db, 'weekend_visits')).toBe(2);
  await db.query('DELETE FROM weekend_places WHERE id=$1', [id(90)]);
  expect((await db.query('SELECT id FROM weekend_visits')).rows).toEqual([{ id: id(93) }]);
  expect(await one(db, 'SELECT id FROM weekend_places')).toEqual({ id: id(91) });
}));

test('maintenance reminder deletion removes completion history only for that reminder', () => household(async (db) => {
  expect(await count(db, 'maintenance_completions')).toBe(2);
  await db.query('DELETE FROM maintenance_reminders WHERE id=$1', [id(100)]);
  expect((await db.query('SELECT id FROM maintenance_completions')).rows).toEqual([{ id: id(103) }]);
  expect(await one(db, 'SELECT id,title FROM maintenance_reminders')).toEqual({ id: id(101), title: 'Synthetic reminder 2' });
}));

test('goal deletion removes only its achievements and preserves the other goal and household member', () => household(async (db) => {
  expect(await count(db, 'goal_achievements')).toBe(2);
  await db.query('DELETE FROM goals WHERE id=$1', [id(60)]);
  expect((await db.query('SELECT id FROM goal_achievements')).rows).toEqual([{ id: id(63) }]);
  expect(await one(db, 'SELECT id FROM goals')).toEqual({ id: id(61) });
  expect(await count(db, 'users')).toBe(2);
}));

test('wish source deletion clears the source while retaining member and optional adder/claimer ownership', () => household(async (db) => {
  expect(await one(db, 'SELECT wish_item_source_id FROM wish_items WHERE id=$1', [id(112)])).toEqual({ wish_item_source_id: id(110) });
  await db.query('DELETE FROM wish_item_sources WHERE id=$1', [id(110)]);
  expect(await one(db, 'SELECT name,member_id,wish_item_source_id,added_by,claimed_by FROM wish_items WHERE id=$1', [id(112)])).toEqual({ name: 'Synthetic wish 1', member_id: id(2), wish_item_source_id: null, added_by: id(1), claimed_by: id(1) });
  expect(await one(db, 'SELECT wish_item_source_id FROM wish_items WHERE id=$1', [id(113)])).toEqual({ wish_item_source_id: id(111) });
}));
