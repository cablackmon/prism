import { addMembers, db, familyLength, id, migrate, resetLegacy, rows } from './burn4-database';

beforeEach(async () => { await resetLegacy(); await addMembers(); });
afterAll(async () => { await db.close(); });

test.each([4, 5, 6, '4', '5', '6', ' 5 '])('backfills every existing member from family length %p', async (value) => {
  await familyLength(value);
  await migrate('length');
  expect(await rows('SELECT id,marker,pin_length FROM users ORDER BY id')).toEqual([
    { id: id(1), marker: 'Synthetic member A', pin_length: Number(value) },
    { id: id(2), marker: 'Synthetic member B', pin_length: Number(value) },
  ]);
});

const invalidLengths: [string, unknown][] = [
  ['JSON null', null],
  ['empty string', ''],
  ['whitespace string', ' '],
  ['nonnumeric string', 'five'],
  ['boolean true', true],
  ['boolean false', false],
  ['object', { length: 5 }],
  ['empty array', []],
  ['array with a valid-looking value', [5]],
  ['below range', 3],
  ['above range', 7],
  ['negative length', -4],
  ['fractional value', 4.5],
  ['integer overflow', 2147483648],
  ['string integer overflow', '2147483648'],
];

test.each(invalidLengths)('falls back safely for %s and preserves later choices on replay', async (_label, value) => {
  await familyLength(value);
  await migrate('length');
  expect(await rows('SELECT pin_length FROM users ORDER BY id')).toEqual([{ pin_length: 4 }, { pin_length: 4 }]);
  await db.query('UPDATE users SET pin_length = 6 WHERE id = $1', [id(1)]);
  await migrate('length');
  expect(await rows('SELECT id,marker,pin_length FROM users ORDER BY id')).toEqual([
    { id: id(1), marker: 'Synthetic member A', pin_length: 6 },
    { id: id(2), marker: 'Synthetic member B', pin_length: 4 },
  ]);
});

test('uses default four without a setting and preserves member choices on replay', async () => {
  await migrate('length');
  expect(await rows('SELECT pin_length FROM users ORDER BY id')).toEqual([{ pin_length: 4 }, { pin_length: 4 }]);
  await db.query('UPDATE users SET pin_length = 5 WHERE id = $1', [id(2)]);
  await migrate('length');
  expect(await rows('SELECT pin_length FROM users ORDER BY id')).toEqual([{ pin_length: 4 }, { pin_length: 5 }]);
});

test('ignores unrelated settings and retains them through both runs', async () => {
  await db.query('INSERT INTO settings (key,value) VALUES ($1,$2::jsonb)', ['ordinaryFixtureSetting', '6']);
  await migrate('length');
  await migrate('length');
  expect(await rows('SELECT pin_length FROM users ORDER BY id')).toEqual([{ pin_length: 4 }, { pin_length: 4 }]);
  expect(await rows('SELECT key,value FROM settings')).toEqual([{ key: 'ordinaryFixtureSetting', value: 6 }]);
});

test('new members receive four after old members inherit family length six', async () => {
  await familyLength(6);
  await migrate('length');
  await db.query('INSERT INTO users (id,marker) VALUES ($1,$2)', [id(3), 'Synthetic member C']);
  expect(await rows('SELECT pin_length FROM users ORDER BY id')).toEqual([{ pin_length: 6 }, { pin_length: 6 }, { pin_length: 4 }]);
});

test('an empty member table still receives the default for later inserts', async () => {
  await db.exec('DELETE FROM users;');
  await familyLength(5);
  await migrate('length');
  await addMembers();
  expect(await rows('SELECT pin_length FROM users ORDER BY id')).toEqual([{ pin_length: 4 }, { pin_length: 4 }]);
});

test('a missing settings relation is caught after adding the member default', async () => {
  await db.exec('DROP TABLE settings;');
  await migrate('length');
  expect(await rows('SELECT pin_length FROM users ORDER BY id')).toEqual([{ pin_length: 4 }, { pin_length: 4 }]);
});

test('an update error rolls back the entire backfill instead of leaving half the members changed', async () => {
  await familyLength(6);
  await db.exec("CREATE FUNCTION reject_second_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.marker = 'Synthetic member B' THEN RAISE EXCEPTION 'Synthetic backfill blocked'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_member BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reject_second_member();");
  await migrate('length');
  expect(await rows('SELECT id,marker,pin_length FROM users ORDER BY id')).toEqual([
    { id: id(1), marker: 'Synthetic member A', pin_length: 4 },
    { id: id(2), marker: 'Synthetic member B', pin_length: 4 },
  ]);
});
