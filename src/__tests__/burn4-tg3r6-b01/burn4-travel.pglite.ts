/** @jest-environment node */
import { parentForeignKeyContract, prepareCollision } from './burn4-collision';
import { addPin, count, db, id, migrate, reset, rows } from './burn4-database';

beforeEach(reset);
afterAll(async () => { await db.close(); });

describe('0001 travel map', () => {
  test('upgrades existing photos without deleting them or inventing coordinates', async () => {
    await db.query('INSERT INTO photos (id) VALUES ($1)', [id(1)]);
    await migrate(1, 1);
    expect(await rows('SELECT id, latitude, longitude FROM photos')).toEqual([
      { id: id(1), latitude: null, longitude: null },
    ]);
  });

  test('new pins receive usable defaults and nullable optional metadata', async () => {
    await migrate(1, 1);
    await addPin(1);
    expect(await rows(`SELECT status, is_bucket_list, tags, photo_radius_km::text, sort_order,
      description, place_name, trip_label, color, visited_date, visited_end_date, year, created_by
      FROM travel_pins`)).toEqual([{
      status: 'want_to_go', is_bucket_list: false, tags: [], photo_radius_km: '50.00', sort_order: 0,
      description: null, place_name: null, trip_label: null, color: null, visited_date: null,
      visited_end_date: null, year: null, created_by: null,
    }]);
  });

  test('round trips full pin metadata and coordinates without conflating similarly named fields', async () => {
    await migrate(1, 1);
    await db.query('INSERT INTO users VALUES ($1)', [id(10)]);
    await db.query(`INSERT INTO travel_pins (id, name, latitude, longitude, description, place_name,
      status, is_bucket_list, trip_label, color, visited_date, visited_end_date, year, tags,
      photo_radius_km, created_by, sort_order)
      VALUES ($1, 'Synthetic ridge', 12.123456, -34.654321, 'Fixture description', 'Fixture region',
      'visited', true, 'Fixture loop', '#123abc', '2024-02-28', '2024-03-01', 2024,
      '["walking","view"]', 12.75, $2, 9)`, [id(1), id(10)]);
    expect(await rows(`SELECT id, name, latitude::text, longitude::text, description, place_name,
      status, is_bucket_list, trip_label, color, visited_date::text, visited_end_date::text, year,
      tags, photo_radius_km::text, created_by, sort_order FROM travel_pins`)).toEqual([{
      id: id(1), name: 'Synthetic ridge', latitude: '12.123456', longitude: '-34.654321',
      description: 'Fixture description', place_name: 'Fixture region', status: 'visited',
      is_bucket_list: true, trip_label: 'Fixture loop', color: '#123abc', visited_date: '2024-02-28',
      visited_end_date: '2024-03-01', year: 2024, tags: ['walking', 'view'],
      photo_radius_km: '12.75', created_by: id(10), sort_order: 9,
    }]);
  });

  test('database-generated pin and link identities are distinct and timestamps are populated', async () => {
    await migrate(1, 1);
    const pins = await rows<{ id: string; created_at: Date; updated_at: Date }>(
      "INSERT INTO travel_pins (name, latitude, longitude) VALUES ('Fixture A', 1, 2), ('Fixture B', 3, 4) RETURNING id, created_at, updated_at");
    const [first, second] = pins;
    if (first === undefined || second === undefined) throw new Error('Expected two generated fixture pins');
    expect(pins).toHaveLength(2);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);
    for (const pin of pins) {
      expect(pin.created_at).toBeInstanceOf(Date);
      expect(pin.updated_at).toEqual(pin.created_at);
    }
    await db.query('INSERT INTO photos VALUES ($1)', [id(10)]);
    expect(await rows('INSERT INTO travel_pin_photos (pin_id, photo_id) VALUES ($1, $2) RETURNING linked_manually, created_at IS NOT NULL AS stamped', [first.id, id(10)]))
      .toEqual([{ linked_manually: false, stamped: true }]);
  });

  test('coordinate and radius precision round at their declared scales', async () => {
    await migrate(1, 1);
    await db.exec("INSERT INTO travel_pins (name, latitude, longitude, photo_radius_km) VALUES ('Fixture', 1.1234567, -2.1234567, 5.555)");
    expect(await rows('SELECT latitude::text, longitude::text, photo_radius_km::text FROM travel_pins'))
      .toEqual([{ latitude: '1.123457', longitude: '-2.123457', photo_radius_km: '5.56' }]);
  });

  test('accepts the full declared numeric storage range independently of geographic validation', async () => {
    await migrate(1, 1);
    await db.exec("INSERT INTO travel_pins (name, latitude, longitude, photo_radius_km) VALUES ('Fixture', -999.999999, 9999.999999, 9999.99)");
    expect(await rows('SELECT latitude::text, longitude::text, photo_radius_km::text FROM travel_pins'))
      .toEqual([{ latitude: '-999.999999', longitude: '9999.999999', photo_radius_km: '9999.99' }]);
  });

  test.each([
    ['latitude', '1000'], ['longitude', '10000'], ['photo_radius_km', '10000'],
  ])('rejects %s numeric overflow without leaving a partial row', async (column, value) => {
    await migrate(1, 1);
    await addPin(1);
    await expect(db.exec(`UPDATE travel_pins SET ${column} = ${value}`)).rejects.toMatchObject({ code: '22003' });
    expect(await count('travel_pins')).toBe(1);
    expect(await rows('SELECT latitude::text, longitude::text, photo_radius_km::text FROM travel_pins'))
      .toEqual([{ latitude: '12.250000', longitude: '-34.500000', photo_radius_km: '50.00' }]);
  });

  test.each(['name', 'latitude', 'longitude'])('rejects null required pin %s', async (column) => {
    await migrate(1, 1);
    await addPin(1);
    await expect(db.exec(`UPDATE travel_pins SET ${column} = NULL`)).rejects.toMatchObject({ code: '23502' });
  });

  test('rejects unknown creators but retains pins when their real creator is deleted', async () => {
    await migrate(1, 1);
    await addPin(1);
    await expect(db.query('UPDATE travel_pins SET created_by = $1', [id(999)])).rejects.toMatchObject({ code: '23503' });
    await db.query('INSERT INTO users VALUES ($1)', [id(10)]);
    await db.query('UPDATE travel_pins SET created_by = $1', [id(10)]);
    await db.query('DELETE FROM users WHERE id = $1', [id(10)]);
    expect(await rows('SELECT id, created_by FROM travel_pins')).toEqual([{ id: id(1), created_by: null }]);
  });

  test('photo membership is unique per pair and permits independent many-to-many links', async () => {
    await migrate(1, 1);
    await addPin(1); await addPin(2);
    await db.query('INSERT INTO photos VALUES ($1), ($2)', [id(10), id(11)]);
    await db.query('INSERT INTO travel_pin_photos (pin_id, photo_id, linked_manually) VALUES ($1, $3, true), ($1, $4, false), ($2, $3, false)', [id(1), id(2), id(10), id(11)]);
    await expect(db.query('INSERT INTO travel_pin_photos (pin_id, photo_id) VALUES ($1, $2)', [id(1), id(10)]))
      .rejects.toMatchObject({ code: '23505' });
    expect(await count('travel_pin_photos')).toBe(3);
    expect(await rows('SELECT linked_manually FROM travel_pin_photos WHERE pin_id = $1 AND photo_id = $2', [id(1), id(10)]))
      .toEqual([{ linked_manually: true }]);
  });

  test.each(['pin_id', 'photo_id'])('rejects absent linked %s', async (column) => {
    await migrate(1, 1);
    await addPin(1);
    await db.query('INSERT INTO photos VALUES ($1)', [id(10)]);
    const params = column === 'pin_id' ? [id(999), id(10)] : [id(1), id(999)];
    await expect(db.query('INSERT INTO travel_pin_photos (pin_id, photo_id) VALUES ($1, $2)', params))
      .rejects.toMatchObject({ code: '23503' });
    expect(await count('travel_pin_photos')).toBe(0);
  });

  test.each(['pin_id', 'photo_id'])('requires linked %s', async (column) => {
    await migrate(1, 1);
    await addPin(1);
    await db.query('INSERT INTO photos VALUES ($1)', [id(10)]);
    const params = column === 'pin_id' ? [null, id(10)] : [id(1), null];
    await expect(db.query('INSERT INTO travel_pin_photos (pin_id, photo_id) VALUES ($1, $2)', params))
      .rejects.toMatchObject({ code: '23502' });
  });

  test.each(['photos', 'travel_pins'])('deleting %s removes links and retains the other entity', async (table) => {
    await migrate(1, 1);
    await addPin(1);
    await db.query('INSERT INTO photos VALUES ($1)', [id(10)]);
    await db.query('INSERT INTO travel_pin_photos (pin_id, photo_id) VALUES ($1, $2)', [id(1), id(10)]);
    await db.query(`DELETE FROM ${table} WHERE id = $1`, [table === 'photos' ? id(10) : id(1)]);
    expect(await count('travel_pin_photos')).toBe(0);
    expect(await count(table === 'photos' ? 'travel_pins' : 'photos')).toBe(1);
  });
});

describe('0002 travel extras', () => {
  test('backfills empty arrays into existing pins and preserves distinct nested metadata on replay', async () => {
    await migrate(1, 1);
    await addPin(1);
    await migrate(2, 2);
    expect(await rows('SELECT stops, national_parks FROM travel_pins')).toEqual([{ stops: [], national_parks: [] }]);
    await db.query('UPDATE travel_pins SET stops = $1::jsonb, national_parks = $2::jsonb',
      [JSON.stringify([{ label: 'Fixture stop', position: 2 }]), JSON.stringify(['Fixture park'])]);
    await migrate(2, 2);
    expect(await rows('SELECT stops, national_parks FROM travel_pins')).toEqual([
      { stops: [{ label: 'Fixture stop', position: 2 }], national_parks: ['Fixture park'] },
    ]);
  });

  test.each(['stops', 'national_parks'])('rejects SQL null %s while allowing JSON null as JSON data', async (column) => {
    await migrate(1, 2);
    await addPin(1);
    await expect(db.exec(`UPDATE travel_pins SET ${column} = NULL`)).rejects.toMatchObject({ code: '23502' });
    await db.exec(`UPDATE travel_pins SET ${column} = 'null'::jsonb`);
    expect(await rows(`SELECT ${column} IS NULL AS sql_null, jsonb_typeof(${column}) AS kind FROM travel_pins`))
      .toEqual([{ sql_null: false, kind: 'null' }]);
  });
});

describe('0003 parent and child pins', () => {
  test('backfills root location defaults and permits explicit child types', async () => {
    await migrate(1, 2); await addPin(1); await migrate(3, 3);
    expect(await rows('SELECT parent_id, pin_type FROM travel_pins')).toEqual([{ parent_id: null, pin_type: 'location' }]);
    await addPin(2);
    await db.query("UPDATE travel_pins SET parent_id = $1, pin_type = 'national_park' WHERE id = $2", [id(1), id(2)]);
    expect(await rows('SELECT parent_id, pin_type FROM travel_pins WHERE id = $1', [id(2)]))
      .toEqual([{ parent_id: id(1), pin_type: 'national_park' }]);
  });

  test('rejects orphan inserts and reparenting without altering a valid tree', async () => {
    await migrate(1, 3); await addPin(1); await addPin(2);
    await db.query('UPDATE travel_pins SET parent_id = $1 WHERE id = $2', [id(1), id(2)]);
    await expect(db.query('UPDATE travel_pins SET parent_id = $1 WHERE id = $2', [id(999), id(2)]))
      .rejects.toMatchObject({ code: '23503' });
    await expect(db.query("INSERT INTO travel_pins (name, latitude, longitude, parent_id) VALUES ('Fixture', 1, 2, $1)", [id(999)]))
      .rejects.toMatchObject({ code: '23503' });
    expect(await rows('SELECT parent_id FROM travel_pins WHERE id = $1', [id(2)]))
      .toEqual([{ parent_id: id(1) }]);
  });

  test('deleting a root cascades through descendants and their links but preserves siblings and photos', async () => {
    await migrate(1, 3);
    for (const value of [1, 2, 3, 4]) await addPin(value);
    await db.query('UPDATE travel_pins SET parent_id = $1 WHERE id = $2', [id(1), id(2)]);
    await db.query('UPDATE travel_pins SET parent_id = $1 WHERE id = $2', [id(2), id(3)]);
    await db.query('INSERT INTO photos VALUES ($1)', [id(10)]);
    await db.query('INSERT INTO travel_pin_photos (pin_id, photo_id) VALUES ($1, $2)', [id(3), id(10)]);
    await db.query('DELETE FROM travel_pins WHERE id = $1', [id(1)]);
    expect(await rows('SELECT id FROM travel_pins')).toEqual([{ id: id(4) }]);
    expect(await count('travel_pin_photos')).toBe(0);
    expect(await count('photos')).toBe(1);
  });

  test('replay preserves an existing tree and leaves its foreign key active', async () => {
    await migrate(1, 3); await addPin(1); await addPin(2);
    await db.query('UPDATE travel_pins SET parent_id = $1 WHERE id = $2', [id(1), id(2)]);
    await migrate(3, 3);
    await db.query('DELETE FROM travel_pins WHERE id = $1', [id(1)]);
    expect(await count('travel_pins')).toBe(0);
  });

  describe('cross-schema constraint collision', () => {
    beforeEach(prepareCollision);
    test.failing('KNOWN GAP: same-named constraint in another schema suppresses the public parent foreign key', parentForeignKeyContract);
  });
});

describe('0004 external photos', () => {
  test('backfills false and preserves metadata-only flags and coordinates across replay', async () => {
    await migrate(1, 3);
    await db.query('INSERT INTO photos (id, latitude, longitude) VALUES ($1, 12.5, -34.5)', [id(1)]);
    await migrate(4, 4);
    expect(await rows('SELECT is_external FROM photos')).toEqual([{ is_external: false }]);
    await db.exec('UPDATE photos SET is_external = true');
    await migrate(4, 4);
    await db.query('INSERT INTO photos (id) VALUES ($1)', [id(2)]);
    expect(await rows('SELECT id, is_external, latitude::text, longitude::text FROM photos ORDER BY id'))
      .toEqual([
        { id: id(1), is_external: true, latitude: '12.500000', longitude: '-34.500000' },
        { id: id(2), is_external: false, latitude: null, longitude: null },
      ]);
  });

  test('refuses an unknown external-photo flag', async () => {
    await migrate(1, 4);
    await expect(db.query('INSERT INTO photos (id, is_external) VALUES ($1, NULL)', [id(1)]))
      .rejects.toMatchObject({ code: '23502' });
  });
});

describe('0005 trips and membership', () => {
  test('backfills nonmember pin defaults and creates trip defaults', async () => {
    await migrate(1, 4); await addPin(1); await migrate(5, 5);
    expect(await rows('SELECT trip_id, is_hub FROM travel_pins')).toEqual([{ trip_id: null, is_hub: false }]);
    await db.exec("INSERT INTO travel_trips (name, trip_style) VALUES ('Fixture trip', 'loop')");
    expect(await rows(`SELECT status, is_bucket_list, member_ids, tags, sort_order, created_by,
      description, color, emoji, visited_date, visited_end_date, year,
      created_at IS NOT NULL AS created, updated_at IS NOT NULL AS updated FROM travel_trips`))
      .toEqual([{
        status: 'want_to_go', is_bucket_list: false, member_ids: [], tags: [], sort_order: 0,
        created_by: null, description: null, color: null, emoji: null, visited_date: null,
        visited_end_date: null, year: null, created: true, updated: true,
      }]);
  });

  test('preserves explicit journey metadata and permits moving one pin between trips', async () => {
    await migrate(1, 5); await addPin(1); await addPin(2);
    await db.query('INSERT INTO users VALUES ($1)', [id(10)]);
    await db.query(`INSERT INTO travel_trips (id, name, trip_style, description, status, is_bucket_list,
      color, emoji, visited_date, visited_end_date, year, member_ids, tags, sort_order, created_by)
      VALUES ($1, 'Fixture loop', 'loop', 'Fixture journey', 'visited', true, '#abcdef', 'X',
      '2024-02-28', '2024-03-01', 2024, $3::jsonb, '["walking"]', 4, $2),
      ($4, 'Fixture hub', 'hub', NULL, 'want_to_go', false, NULL, NULL, NULL, NULL, NULL, '[]', '[]', 0, NULL)`,
    [id(20), id(10), JSON.stringify([id(10)]), id(21)]);
    await db.query('UPDATE travel_pins SET trip_id = $1, is_hub = true', [id(20)]);
    await db.query('UPDATE travel_pins SET trip_id = $1 WHERE id = $2', [id(21), id(2)]);
    await migrate(5, 5);
    expect(await rows('SELECT id, trip_id, is_hub FROM travel_pins ORDER BY id')).toEqual([
      { id: id(1), trip_id: id(20), is_hub: true }, { id: id(2), trip_id: id(21), is_hub: true },
    ]);
    expect(await rows(`SELECT name, trip_style, description, status, is_bucket_list, color, emoji,
      visited_date::text, visited_end_date::text, year, member_ids, tags, sort_order, created_by
      FROM travel_trips WHERE id = $1`, [id(20)])).toEqual([{
      name: 'Fixture loop', trip_style: 'loop', description: 'Fixture journey', status: 'visited',
      is_bucket_list: true, color: '#abcdef', emoji: 'X', visited_date: '2024-02-28',
      visited_end_date: '2024-03-01', year: 2024, member_ids: [id(10)], tags: ['walking'],
      sort_order: 4, created_by: id(10),
    }]);
  });

  test.each(['name', 'trip_style'])('requires trip %s', async (column) => {
    await migrate(1, 5);
    const name = column === 'name' ? null : 'Fixture';
    const style = column === 'trip_style' ? null : 'loop';
    await expect(db.query('INSERT INTO travel_trips (name, trip_style) VALUES ($1, $2)', [name, style]))
      .rejects.toMatchObject({ code: '23502' });
  });

  test('rejects missing trips and missing journey creators', async () => {
    await migrate(1, 5); await addPin(1);
    await expect(db.query('UPDATE travel_pins SET trip_id = $1', [id(999)]))
      .rejects.toMatchObject({ code: '23503' });
    await expect(db.query("INSERT INTO travel_trips (name, trip_style, created_by) VALUES ('Fixture', 'loop', $1)", [id(999)]))
      .rejects.toMatchObject({ code: '23503' });
  });

  test('deleting a trip cascades member pins, their descendant pins and photo links only', async () => {
    await migrate(1, 5);
    for (const value of [1, 2, 3]) await addPin(value);
    await db.query("INSERT INTO travel_trips (id, name, trip_style) VALUES ($1, 'Fixture', 'route')", [id(20)]);
    await db.query('UPDATE travel_pins SET trip_id = $1 WHERE id = $2', [id(20), id(1)]);
    await db.query('UPDATE travel_pins SET parent_id = $1 WHERE id = $2', [id(1), id(2)]);
    await db.query('INSERT INTO photos VALUES ($1)', [id(10)]);
    await db.query('INSERT INTO travel_pin_photos (pin_id, photo_id) VALUES ($1, $2)', [id(2), id(10)]);
    await db.query('DELETE FROM travel_trips WHERE id = $1', [id(20)]);
    expect(await rows('SELECT id FROM travel_pins')).toEqual([{ id: id(3) }]);
    expect(await count('travel_pin_photos')).toBe(0);
    expect(await count('photos')).toBe(1);
  });

  test('deleting a creator keeps the trip and deleting its last pin keeps the trip', async () => {
    await migrate(1, 5); await addPin(1);
    await db.query('INSERT INTO users VALUES ($1)', [id(10)]);
    await db.query("INSERT INTO travel_trips (id, name, trip_style, created_by) VALUES ($1, 'Fixture', 'hub', $2)", [id(20), id(10)]);
    await db.query('UPDATE travel_pins SET trip_id = $1', [id(20)]);
    await db.query('DELETE FROM users WHERE id = $1', [id(10)]);
    expect(await rows('SELECT created_by FROM travel_trips')).toEqual([{ created_by: null }]);
    await db.exec('DELETE FROM travel_pins');
    expect(await count('travel_trips')).toBe(1);
  });
});

describe('0006 weekend places and visits', () => {
  test('creates backlog places with empty collections and optional geographic metadata', async () => {
    await migrate();
    await db.exec("INSERT INTO weekend_places (name) VALUES ('Fixture park')");
    expect(await rows(`SELECT status, is_favorite, tags, visit_count, latitude, longitude, rating,
      last_visited_date, created_by, created_at IS NOT NULL AS created FROM weekend_places`))
      .toEqual([{
        status: 'backlog', is_favorite: false, tags: [], visit_count: 0, latitude: null,
        longitude: null, rating: null, last_visited_date: null, created_by: null, created: true,
      }]);
  });

  test('round trips independent place and visit metadata across replay', async () => {
    await migrate();
    await db.query('INSERT INTO users VALUES ($1)', [id(10)]);
    await db.query(`INSERT INTO weekend_places (id, name, description, latitude, longitude, place_name,
      address, url, status, is_favorite, rating, notes, tags, source_provider, source_id,
      last_visited_date, visit_count, created_by)
      VALUES ($1, 'Fixture park', 'Fixture description', 12.1234567, -34.5, 'Fixture town',
      '100 Fixture Road', 'https://example.invalid/place', 'visited', true, 4, 'Place notes',
      '["walking"]', 'manual', 'fixture-place', '2024-02-29', 2, $2)`, [id(1), id(10)]);
    await db.query(`INSERT INTO weekend_visits (id, place_id, visited_by, visited_on, rating, notes)
      VALUES ($1, $2, $3, '2024-02-29', 5, 'Visit notes')`, [id(2), id(1), id(10)]);
    await migrate(6, 6);
    expect(await rows(`SELECT name, description, latitude::text, longitude::text, place_name, address,
      url, status, is_favorite, rating, notes, tags, source_provider, source_id,
      last_visited_date, visit_count, created_by FROM weekend_places`)).toEqual([{
      name: 'Fixture park', description: 'Fixture description', latitude: '12.123457', longitude: '-34.500000',
      place_name: 'Fixture town', address: '100 Fixture Road', url: 'https://example.invalid/place',
      status: 'visited', is_favorite: true, rating: 4, notes: 'Place notes', tags: ['walking'],
      source_provider: 'manual', source_id: 'fixture-place', last_visited_date: '2024-02-29',
      visit_count: 2, created_by: id(10),
    }]);
    expect(await rows('SELECT place_id, visited_by, visited_on, rating, notes, created_at IS NOT NULL AS created FROM weekend_visits'))
      .toEqual([{ place_id: id(1), visited_by: id(10), visited_on: '2024-02-29', rating: 5, notes: 'Visit notes', created: true }]);
  });

  test('deleting a user preserves both place and visit and clears their distinct attribution links', async () => {
    await migrate();
    await db.query('INSERT INTO users VALUES ($1)', [id(10)]);
    await db.query("INSERT INTO weekend_places (id, name, created_by) VALUES ($1, 'Fixture', $2)", [id(1), id(10)]);
    await db.query("INSERT INTO weekend_visits (place_id, visited_by, visited_on) VALUES ($1, $2, '2024-02-29')", [id(1), id(10)]);
    await db.query('DELETE FROM users WHERE id = $1', [id(10)]);
    expect(await rows('SELECT created_by FROM weekend_places')).toEqual([{ created_by: null }]);
    expect(await rows('SELECT visited_by FROM weekend_visits')).toEqual([{ visited_by: null }]);
  });

  test('deleting a place removes only its own visits and keeps unrelated places and visits', async () => {
    await migrate();
    await db.query("INSERT INTO weekend_places (id, name) VALUES ($1, 'Fixture A'), ($2, 'Fixture B')", [id(1), id(2)]);
    await db.query("INSERT INTO weekend_visits (place_id, visited_on) VALUES ($1, '2024-02-28'), ($1, '2024-02-29'), ($2, '2024-02-29')", [id(1), id(2)]);
    await db.query('DELETE FROM weekend_places WHERE id = $1', [id(1)]);
    expect(await rows('SELECT id FROM weekend_places')).toEqual([{ id: id(2) }]);
    expect(await rows('SELECT place_id FROM weekend_visits')).toEqual([{ place_id: id(2) }]);
  });

  test.each(['place_id', 'visited_on'])('requires visit %s', async (column) => {
    await migrate();
    await db.query("INSERT INTO weekend_places (id, name) VALUES ($1, 'Fixture')", [id(1)]);
    await expect(db.query('INSERT INTO weekend_visits (place_id, visited_on) VALUES ($1, $2)',
      [column === 'place_id' ? null : id(1), column === 'visited_on' ? null : '2024-02-29']))
      .rejects.toMatchObject({ code: '23502' });
  });

  test('rejects unknown visit places and unknown place or visit attribution', async () => {
    await migrate();
    await expect(db.query("INSERT INTO weekend_visits (place_id, visited_on) VALUES ($1, '2024-02-29')", [id(999)]))
      .rejects.toMatchObject({ code: '23503' });
    await expect(db.query("INSERT INTO weekend_places (name, created_by) VALUES ('Fixture', $1)", [id(999)]))
      .rejects.toMatchObject({ code: '23503' });
    await db.query("INSERT INTO weekend_places (id, name) VALUES ($1, 'Fixture')", [id(1)]);
    await expect(db.query("INSERT INTO weekend_visits (place_id, visited_by, visited_on) VALUES ($1, $2, '2024-02-29')", [id(1), id(999)]))
      .rejects.toMatchObject({ code: '23503' });
    expect(await count('weekend_visits')).toBe(0);
  });

  test('enforces declared text widths without treating visit dates as SQL date values', async () => {
    await migrate();
    await db.query("INSERT INTO weekend_places (id, name) VALUES ($1, 'Fixture')", [id(1)]);
    await expect(db.query('UPDATE weekend_places SET name = $1', ['x'.repeat(256)]))
      .rejects.toMatchObject({ code: '22001' });
    await expect(db.query('INSERT INTO weekend_visits (place_id, visited_on) VALUES ($1, $2)', [id(1), '2024-02-290']))
      .rejects.toMatchObject({ code: '22001' });
    await db.query('INSERT INTO weekend_visits (place_id, visited_on) VALUES ($1, $2)', [id(1), 'undated']);
    expect(await rows('SELECT visited_on FROM weekend_visits')).toEqual([{ visited_on: 'undated' }]);
  });
});

test('all six migrations replay over a connected graph without changing stored identities or data', async () => {
  await migrate();
  await db.query('INSERT INTO users VALUES ($1)', [id(10)]);
  await db.query('INSERT INTO photos (id, latitude, longitude, is_external) VALUES ($1, 12.25, -34.5, true)', [id(11)]);
  await db.query("INSERT INTO travel_trips (id, name, trip_style, created_by) VALUES ($1, 'Fixture loop', 'loop', $2)", [id(20), id(10)]);
  await addPin(1); await addPin(2);
  await db.query('UPDATE travel_pins SET trip_id = $1, created_by = $2, stops = $3::jsonb WHERE id = $4',
    [id(20), id(10), '["Fixture stop"]', id(1)]);
  await db.query('UPDATE travel_pins SET parent_id = $1 WHERE id = $2', [id(1), id(2)]);
  await db.query('INSERT INTO travel_pin_photos (id, pin_id, photo_id) VALUES ($1, $2, $3)', [id(30), id(2), id(11)]);
  await db.query("INSERT INTO weekend_places (id, name) VALUES ($1, 'Fixture park')", [id(40)]);
  await db.query("INSERT INTO weekend_visits (id, place_id, visited_on) VALUES ($1, $2, '2024-02-29')", [id(41), id(40)]);
  const snapshot = async () => Promise.all([
    rows('SELECT * FROM photos ORDER BY id'), rows('SELECT * FROM travel_pins ORDER BY id'),
    rows('SELECT * FROM travel_pin_photos ORDER BY id'), rows('SELECT * FROM travel_trips ORDER BY id'),
    rows('SELECT * FROM weekend_places ORDER BY id'), rows('SELECT * FROM weekend_visits ORDER BY id'),
  ]);
  const before = await snapshot();
  await migrate(); await migrate();
  expect(await snapshot()).toEqual(before);
  await db.query('DELETE FROM travel_trips WHERE id = $1', [id(20)]);
  expect(await count('travel_pins')).toBe(0);
  expect(await count('travel_pin_photos')).toBe(0);
  expect(await count('photos')).toBe(1);
  expect(await count('weekend_visits')).toBe(1);
});
