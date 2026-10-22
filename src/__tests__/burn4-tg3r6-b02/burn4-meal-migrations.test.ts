/** @jest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const itemTimeSql = readFileSync(
  resolve(__dirname, '../../..', 'drizzle/0007_calendar_item_times.sql'),
  'utf8'
);
const absoluteDateSql = readFileSync(
  resolve(__dirname, '../../..', 'drizzle/0020_meal_absolute_date.sql'),
  'utf8'
);

type MealDateRow = {
  id: number;
  name: string;
  legacy_week: string;
  day_of_week: string;
  date: string;
};

const weekdays = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
}, 30000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`
    DROP TABLE IF EXISTS chores, meals;
    CREATE TABLE meals (
      id integer PRIMARY KEY,
      name text NOT NULL,
      week_of date NOT NULL,
      day_of_week varchar(20) NOT NULL
    );
    CREATE TABLE chores (id integer PRIMARY KEY, title text NOT NULL);
  `);
});

async function insertMeal(
  id: number,
  week: string,
  weekday: string,
  name = 'Synthetic meal'
): Promise<void> {
  await db.query(
    'INSERT INTO meals (id, name, week_of, day_of_week) VALUES ($1, $2, $3::date, $4)',
    [id, name, week, weekday]
  );
}

async function mealDates(): Promise<MealDateRow[]> {
  const result = await db.query<MealDateRow>(`
    SELECT id, name, week_of::text AS legacy_week, day_of_week, "date"::text
    FROM meals ORDER BY id
  `);
  return result.rows;
}

describe('0007 calendar item time fields', () => {
  test('adds nullable times without changing populated meals or chores', async () => {
    await insertMeal(1, '2028-02-27', 'tuesday', 'Synthetic soup');
    await db.exec("INSERT INTO chores VALUES (1, 'Synthetic tidying')");

    await db.exec(itemTimeSql);

    expect((await db.query('SELECT id, name, meal_time FROM meals')).rows).toEqual([
      { id: 1, name: 'Synthetic soup', meal_time: null },
    ]);
    expect((await db.query('SELECT id, title, next_due_time FROM chores')).rows).toEqual([
      { id: 1, title: 'Synthetic tidying', next_due_time: null },
    ]);
  });

  test('new meals and chores may omit the time or explicitly use null', async () => {
    await db.exec(itemTimeSql);
    await insertMeal(1, '2028-02-27', 'sunday');
    await db.exec(`
      INSERT INTO meals (id, name, week_of, day_of_week, meal_time)
      VALUES (2, 'Synthetic salad', '2028-02-27', 'monday', NULL);
      INSERT INTO chores (id, title) VALUES (1, 'Synthetic task');
      INSERT INTO chores (id, title, next_due_time) VALUES (2, 'Synthetic task', NULL);
    `);

    expect((await db.query('SELECT meal_time FROM meals ORDER BY id')).rows).toEqual([
      { meal_time: null }, { meal_time: null },
    ]);
    expect((await db.query('SELECT next_due_time FROM chores ORDER BY id')).rows).toEqual([
      { next_due_time: null }, { next_due_time: null },
    ]);
  });

  test.each(['00:00', '09:05', '23:59'])('preserves exact five-character time %s through replay', async (time) => {
    await db.exec(itemTimeSql);
    await insertMeal(1, '2028-02-27', 'sunday');
    await db.query('UPDATE meals SET meal_time = $1 WHERE id = 1', [time]);
    await db.query('INSERT INTO chores VALUES (1, $1, $2)', ['Synthetic task', time]);

    await db.exec(itemTimeSql);

    expect((await db.query('SELECT meal_time FROM meals')).rows).toEqual([{ meal_time: time }]);
    expect((await db.query('SELECT next_due_time FROM chores')).rows).toEqual([{ next_due_time: time }]);
  });

  test.each([
    ['meals', 'meal_time'],
    ['chores', 'next_due_time'],
  ])('rejects values wider than varchar(5) in %s.%s', async (table, column) => {
    await db.exec(itemTimeSql);
    await insertMeal(1, '2028-02-27', 'sunday');
    await db.exec("INSERT INTO chores (id, title) VALUES (1, 'Synthetic task')");

    await expect(db.query(`UPDATE ${table} SET ${column} = $1`, ['12:300']))
      .rejects.toMatchObject({ code: '22001' });

    expect((await db.query(`SELECT ${column} FROM ${table}`)).rows).toEqual([{ [column]: null }]);
  });

  test('replays when both columns already exist with distinct populated values', async () => {
    await db.exec(itemTimeSql);
    await insertMeal(1, '2028-02-27', 'sunday');
    await db.exec(`
      UPDATE meals SET meal_time = '18:45';
      INSERT INTO chores VALUES (1, 'Synthetic task', '07:10');
    `);

    await db.exec(itemTimeSql);
    await db.exec(itemTimeSql);

    expect((await db.query('SELECT meal_time FROM meals')).rows).toEqual([{ meal_time: '18:45' }]);
    expect((await db.query('SELECT next_due_time FROM chores')).rows).toEqual([{ next_due_time: '07:10' }]);
  });

  test('finishes a partial upgrade with an existing populated meal time column', async () => {
    await db.exec('ALTER TABLE meals ADD COLUMN meal_time varchar(5)');
    await insertMeal(1, '2028-02-27', 'sunday');
    await db.exec("UPDATE meals SET meal_time = '18:30'");
    await db.exec("INSERT INTO chores VALUES (1, 'Synthetic task')");

    await db.exec(itemTimeSql);

    expect((await db.query('SELECT meal_time FROM meals')).rows).toEqual([{ meal_time: '18:30' }]);
    expect((await db.query('SELECT next_due_time FROM chores')).rows).toEqual([{ next_due_time: null }]);
  });

  test('finishes a partial upgrade with an existing populated chore time column', async () => {
    await db.exec('ALTER TABLE chores ADD COLUMN next_due_time varchar(5)');
    await insertMeal(1, '2028-02-27', 'sunday');
    await db.exec("INSERT INTO chores VALUES (1, 'Synthetic task', '07:15')");

    await db.exec(itemTimeSql);

    expect((await db.query('SELECT meal_time FROM meals')).rows).toEqual([{ meal_time: null }]);
    expect((await db.query('SELECT next_due_time FROM chores')).rows).toEqual([{ next_due_time: '07:15' }]);
  });
});

describe('0020 absolute meal dates', () => {
  const weeks = [
    ['Sunday start', '2028-02-27', ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04']],
    ['Monday start', '2028-02-28', ['2028-03-05', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04']],
    ['Wednesday start', '2027-12-29', ['2028-01-02', '2028-01-03', '2028-01-04', '2027-12-29', '2027-12-30', '2027-12-31', '2028-01-01']],
  ] as const;

  describe.each(weeks)('%s', (_label, week, expectedDates) => {
    test.each(weekdays.map((weekday, index) => [weekday, expectedDates[index]] as const))(
      'backfills %s to its exact occurrence %s',
      async (weekday, expectedDate) => {
        await insertMeal(1, week, weekday);

        await db.exec(absoluteDateSql);

        expect(await mealDates()).toEqual([{
          id: 1, name: 'Synthetic meal', legacy_week: week, day_of_week: weekday, date: expectedDate,
        }]);
      }
    );
  });

  test.each([
    ['Saturday start', '2027-12-25', 'monday', '2027-12-27'],
    ['Tuesday start', '2028-02-29', 'monday', '2028-03-06'],
    ['Thursday start', '2028-03-02', 'wednesday', '2028-03-08'],
    ['Friday start', '2028-03-03', 'thursday', '2028-03-09'],
    ['non-leap February', '2027-02-27', 'monday', '2027-03-01'],
    ['century non-leap February', '2100-02-27', 'monday', '2100-03-01'],
    ['leap century February', '2000-02-27', 'tuesday', '2000-02-29'],
    ['year rollover', '2027-12-31', 'thursday', '2028-01-06'],
  ])('handles %s boundary', async (_label, week, weekday, expectedDate) => {
    await insertMeal(1, week, weekday);

    await db.exec(absoluteDateSql);

    expect((await mealDates())[0]?.date).toBe(expectedDate);
  });

  test('backfills a full plan while preserving row identity and all legacy data', async () => {
    for (const [id, weekday] of weekdays.entries()) {
      await insertMeal(id + 1, '2028-02-28', weekday, `Synthetic meal ${id + 1}`);
    }
    const before = (await db.query('SELECT id, name, week_of::text, day_of_week FROM meals ORDER BY id')).rows;

    await db.exec(absoluteDateSql);

    expect((await db.query('SELECT id, name, week_of::text, day_of_week FROM meals ORDER BY id')).rows).toEqual(before);
    expect((await mealDates()).map((row) => row.date)).toEqual([
      '2028-03-05', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04',
    ]);
  });

  test('retains multiple meals on one absolute date and allows more after indexing', async () => {
    await insertMeal(1, '2028-02-28', 'tuesday', 'Synthetic breakfast');
    await insertMeal(2, '2028-02-28', 'tuesday', 'Synthetic dinner');

    await db.exec(absoluteDateSql);
    await db.exec(`
      INSERT INTO meals (id, name, week_of, day_of_week, "date")
      VALUES (3, 'Synthetic lunch', '2028-02-28', 'tuesday', '2028-02-29')
    `);
    await db.exec(absoluteDateSql);

    expect((await mealDates()).map((row) => [row.id, row.name, row.date])).toEqual([
      [1, 'Synthetic breakfast', '2028-02-29'],
      [2, 'Synthetic dinner', '2028-02-29'],
      [3, 'Synthetic lunch', '2028-02-29'],
    ]);
  });

  test('keeps an explicit date even when legacy metadata points elsewhere', async () => {
    await db.exec('ALTER TABLE meals ADD COLUMN "date" date');
    await insertMeal(1, '2028-02-28', 'monday');
    await insertMeal(2, '2028-02-28', 'tuesday');
    await db.exec(`UPDATE meals SET "date" = '2031-11-15' WHERE id = 1`);

    await db.exec(absoluteDateSql);

    expect((await mealDates()).map((row) => row.date)).toEqual(['2031-11-15', '2028-02-29']);
  });

  test('replay keeps migrated dates stable after legacy week metadata changes', async () => {
    await insertMeal(1, '2028-02-28', 'sunday');
    await db.exec(absoluteDateSql);
    await db.exec("UPDATE meals SET week_of = '2040-06-04', day_of_week = 'monday'");

    await db.exec(absoluteDateSql);
    await db.exec(absoluteDateSql);

    expect((await mealDates())[0]?.date).toBe('2028-03-05');
    expect((await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM meals')).rows).toEqual([{ count: 1 }]);
    expect((await db.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'meals' AND indexname = 'meals_date_idx'
    `)).rows).toEqual([{ count: 1 }]);
  });

  test('empty tables migrate and replay, then require explicit dates for new meals', async () => {
    await db.exec(absoluteDateSql);
    await db.exec(absoluteDateSql);

    await expect(insertMeal(1, '2028-02-28', 'monday')).rejects.toMatchObject({
      code: '23502', column: 'date', table: 'meals',
    });
    await db.exec(`
      INSERT INTO meals (id, name, week_of, day_of_week, "date")
      VALUES (2, 'Synthetic new meal', '2028-02-28', 'monday', '2028-02-28')
    `);
    expect((await mealDates())[0]?.date).toBe('2028-02-28');
  });

  test.each(['mOnDaY', 'unknown', 'monday ', ''])('diagnoses unsupported legacy weekday %j without losing rows', async (weekday) => {
    await insertMeal(1, '2028-02-28', 'monday');
    await insertMeal(2, '2028-02-28', weekday);

    await expect(db.exec(absoluteDateSql)).rejects.toMatchObject({
      code: '23502', column: 'date', table: 'meals',
    });

    expect((await db.query('SELECT id, day_of_week FROM meals ORDER BY id')).rows).toEqual([
      { id: 1, day_of_week: 'monday' }, { id: 2, day_of_week: weekday },
    ]);
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'meals' AND column_name = 'date'")).rows).toEqual([]);
  });

  test('a corrected legacy weekday can be retried after a transactional migration failure', async () => {
    await insertMeal(1, '2028-02-28', 'unrecognized');
    await expect(db.exec(absoluteDateSql)).rejects.toMatchObject({ code: '23502', column: 'date' });
    await db.exec("UPDATE meals SET day_of_week = 'tuesday'");

    await db.exec(absoluteDateSql);

    expect((await mealDates())[0]?.date).toBe('2028-02-29');
  });

  test('an existing explicit date permits unsupported legacy weekday metadata', async () => {
    await db.exec('ALTER TABLE meals ADD COLUMN "date" date');
    await insertMeal(1, '2028-02-28', 'unrecognized');
    await db.exec(`UPDATE meals SET "date" = '2028-03-02'`);

    await db.exec(absoluteDateSql);

    expect((await mealDates())[0]).toMatchObject({ day_of_week: 'unrecognized', date: '2028-03-02' });
  });

  test('date and time migrations compose and replay without overwriting either representation', async () => {
    await insertMeal(1, '2028-02-28', 'tuesday');
    await db.exec("INSERT INTO chores VALUES (1, 'Synthetic task')");
    await db.exec(itemTimeSql);
    await db.exec("UPDATE meals SET meal_time = '18:30'");
    await db.exec("UPDATE chores SET next_due_time = '07:45'");

    await db.exec(absoluteDateSql);
    await db.exec(itemTimeSql);
    await db.exec(absoluteDateSql);

    expect((await db.query('SELECT "date"::text, meal_time FROM meals')).rows).toEqual([
      { date: '2028-02-29', meal_time: '18:30' },
    ]);
    expect((await db.query('SELECT next_due_time FROM chores')).rows).toEqual([{ next_due_time: '07:45' }]);
  });
});
