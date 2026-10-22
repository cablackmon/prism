/** @jest-environment node */
import { type MemoryDatabase, addRecipe, addSource, applyRecipes, id, openDatabase, resetFixture } from './burn4-harness';

jest.setTimeout(30000);

describe('0014 recipe source identity and lifecycle migration', () => {
  let db: MemoryDatabase;

  beforeAll(async () => { db = openDatabase(); await db.waitReady; });
  beforeEach(async () => { await resetFixture(db); });
  afterAll(async () => { await db.close(); });

  test('existing local recipes preserve their titles and receive null linkage', async () => {
    await db.query('INSERT INTO recipes (id, title) VALUES ($1, $2)', [id(1), 'Legacy fixture recipe']);
    await applyRecipes(db);
    expect((await db.query('SELECT id, title, source_id, external_id, external_updated_at FROM recipes')).rows).toEqual([
      { id: id(1), title: 'Legacy fixture recipe', source_id: null, external_id: null, external_updated_at: null },
    ]);
  });

  test('minimal source insertion enables syncing and initializes both timestamps', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    expect((await db.query(`
      SELECT id, enabled, name, last_synced, sync_errors, provider_config, created_by,
        created_at IS NOT NULL AS has_created, updated_at IS NOT NULL AS has_updated,
        created_at = updated_at AS same_initial_time
      FROM recipe_sources
    `)).rows).toEqual([{
      id: id(1), enabled: true, name: null, last_synced: null, sync_errors: null,
      provider_config: null, created_by: null, has_created: true, has_updated: true, same_initial_time: true,
    }]);
  });

  test.each([
    ['provider', 'server_url', 'https://recipes.example.test'],
    ['server_url', 'provider', 'fixture-provider'],
  ])('rejects a source missing required %s', async (missing, present, value) => {
    await applyRecipes(db);
    // The column is drawn only from this literal table, never from fixture data.
    await expect(db.query(`INSERT INTO recipe_sources (id, ${present}) VALUES ($1, $2)`, [id(1), value]))
      .rejects.toMatchObject({ code: '23502', column: missing });
  });

  test('rejects an explicit null enabled flag', async () => {
    await applyRecipes(db);
    await expect(db.query(`
      INSERT INTO recipe_sources (id, provider, server_url, enabled)
      VALUES ($1, 'fixture-provider', 'https://recipes.example.test', NULL)
    `, [id(1)])).rejects.toMatchObject({ code: '23502', column: 'enabled' });
  });

  test('keeps an explicitly disabled source disabled', async () => {
    await applyRecipes(db);
    await db.query(`
      INSERT INTO recipe_sources (id, provider, server_url, enabled)
      VALUES ($1, 'fixture-provider', 'https://recipes.example.test', false)
    `, [id(1)]);
    expect((await db.query('SELECT enabled FROM recipe_sources')).rows).toEqual([{ enabled: false }]);
  });

  test('rejects duplicate source primary identities', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await expect(addSource(db, 1)).rejects.toMatchObject({ code: '23505', constraint: 'recipe_sources_pkey' });
    expect((await db.query('SELECT id FROM recipe_sources')).rows).toEqual([{ id: id(1) }]);
  });

  test('round-trips only nonsensitive provider preferences and sync diagnostics', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    const config = { displayMode: 'compact', includeImages: false, limit: 4 };
    const errors = { code: 'fixture-unavailable', retries: 2 };
    await db.query('UPDATE recipe_sources SET provider_config = $1, sync_errors = $2 WHERE id = $3',
      [JSON.stringify(config), JSON.stringify(errors), id(1)]);
    expect((await db.query('SELECT provider_config, sync_errors FROM recipe_sources')).rows)
      .toEqual([{ provider_config: config, sync_errors: errors }]);
  });

  test('deleting a creator keeps the source and clears only its creator link', async () => {
    await applyRecipes(db);
    await db.query('INSERT INTO users (id, label) VALUES ($1, $2)', [id(9), 'Fixture creator']);
    await addSource(db, 1, id(9));
    await addRecipe(db, 2, id(1), 'fixture-remote');
    await db.query('DELETE FROM users WHERE id = $1', [id(9)]);
    expect((await db.query('SELECT id, created_by FROM recipe_sources')).rows).toEqual([{ id: id(1), created_by: null }]);
    expect((await db.query('SELECT id, source_id FROM recipes')).rows).toEqual([{ id: id(2), source_id: id(1) }]);
  });

  test('rejects a nonexistent source creator', async () => {
    await applyRecipes(db);
    await expect(addSource(db, 1, id(99))).rejects.toMatchObject({ code: '23503' });
  });

  test('rejects a recipe linked to a nonexistent source', async () => {
    await applyRecipes(db);
    await expect(addRecipe(db, 1, id(99), 'fixture-remote')).rejects.toMatchObject({
      code: '23503', constraint: 'recipes_source_id_recipe_sources_id_fk',
    });
  });

  test('deleting a source preserves recipes and remote metadata while clearing their source links', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addRecipe(db, 2, id(1), 'fixture-remote', '2030-04-05 06:07:08');
    await addRecipe(db, 3, id(1), null);
    await db.query('DELETE FROM recipe_sources WHERE id = $1', [id(1)]);
    expect((await db.query(`
      SELECT id, title, source_id, external_id, external_updated_at::text AS remote_time
      FROM recipes ORDER BY id
    `)).rows).toEqual([
      { id: id(2), title: 'Fixture recipe', source_id: null, external_id: 'fixture-remote', remote_time: '2030-04-05 06:07:08' },
      { id: id(3), title: 'Fixture recipe', source_id: null, external_id: null, remote_time: null },
    ]);
  });

  test('deleting one source does not detach another source recipes or local recipes', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addSource(db, 2);
    await addRecipe(db, 3, id(1), 'fixture-a');
    await addRecipe(db, 4, id(2), 'fixture-b');
    await addRecipe(db, 5);
    await db.query('DELETE FROM recipe_sources WHERE id = $1', [id(1)]);
    expect((await db.query('SELECT id, source_id FROM recipes ORDER BY id')).rows).toEqual([
      { id: id(3), source_id: null }, { id: id(4), source_id: id(2) }, { id: id(5), source_id: null },
    ]);
  });

  test('a referenced source identity cannot be updated into a dangling recipe link', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addRecipe(db, 2, id(1), 'fixture-remote');
    await expect(db.query('UPDATE recipe_sources SET id = $1 WHERE id = $2', [id(9), id(1)]))
      .rejects.toMatchObject({ code: '23503' });
    expect((await db.query('SELECT source_id FROM recipes')).rows).toEqual([{ source_id: id(1) }]);
  });

  test('rejects the same remote identity twice within a source', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addRecipe(db, 2, id(1), 'fixture-remote');
    await expect(addRecipe(db, 3, id(1), 'fixture-remote')).rejects.toMatchObject({
      code: '23505', constraint: 'recipes_source_external_unique',
    });
    expect((await db.query('SELECT id FROM recipes')).rows).toEqual([{ id: id(2) }]);
  });

  test('different sources can reuse a remote identity even for the same provider and URL', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addSource(db, 2);
    await addRecipe(db, 3, id(1), 'shared-remote');
    await addRecipe(db, 4, id(2), 'shared-remote');
    expect((await db.query('SELECT source_id, external_id FROM recipes ORDER BY id')).rows).toEqual([
      { source_id: id(1), external_id: 'shared-remote' }, { source_id: id(2), external_id: 'shared-remote' },
    ]);
  });

  test('a single source can own multiple distinct remote identities', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addRecipe(db, 2, id(1), 'fixture-a');
    await addRecipe(db, 3, id(1), 'fixture-b');
    expect((await db.query('SELECT external_id FROM recipes ORDER BY external_id')).rows)
      .toEqual([{ external_id: 'fixture-a' }, { external_id: 'fixture-b' }]);
  });

  test('multiple local recipes with both identity components null never collide', async () => {
    await applyRecipes(db);
    await addRecipe(db, 1);
    await addRecipe(db, 2);
    expect((await db.query('SELECT id, source_id, external_id FROM recipes ORDER BY id')).rows).toEqual([
      { id: id(1), source_id: null, external_id: null }, { id: id(2), source_id: null, external_id: null },
    ]);
  });

  test('multiple source-linked recipes with unknown remote identity remain distinct', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addRecipe(db, 2, id(1));
    await addRecipe(db, 3, id(1));
    expect((await db.query('SELECT id, source_id, external_id FROM recipes ORDER BY id')).rows).toEqual([
      { id: id(2), source_id: id(1), external_id: null }, { id: id(3), source_id: id(1), external_id: null },
    ]);
  });

  test('detached recipes can retain an identical remote identity without collision', async () => {
    await applyRecipes(db);
    await addRecipe(db, 1, null, 'shared-detached');
    await addRecipe(db, 2, null, 'shared-detached');
    expect((await db.query('SELECT id FROM recipes ORDER BY id')).rows).toEqual([{ id: id(1) }, { id: id(2) }]);
  });

  test('an empty remote identity is a value and still enforces source uniqueness', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addRecipe(db, 2, id(1), '');
    await expect(addRecipe(db, 3, id(1), '')).rejects.toMatchObject({ code: '23505' });
  });

  test('remote identities preserve case and Unicode without implicit normalization', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    const remoteIds = ['Fixture', 'fixture', 'r\u00e9cipe', 're\u0301cipe'];
    for (const [index, remoteId] of remoteIds.entries()) {
      await addRecipe(db, index + 2, id(1), remoteId);
    }
    expect((await db.query('SELECT external_id FROM recipes ORDER BY id')).rows)
      .toEqual(remoteIds.map(external_id => ({ external_id })));
  });

  test('accepts a 255-character Unicode remote identity', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    const remoteId = '\u00e9'.repeat(255);
    await addRecipe(db, 2, id(1), remoteId);
    expect((await db.query('SELECT external_id, char_length(external_id) AS characters FROM recipes')).rows)
      .toEqual([{ external_id: remoteId, characters: 255 }]);
  });

  test('rejects a remote identity longer than 255 characters without truncation', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await expect(addRecipe(db, 2, id(1), 'x'.repeat(256))).rejects.toMatchObject({ code: '22001' });
    expect((await db.query('SELECT id FROM recipes')).rows).toEqual([]);
  });

  test('accepts exact provider/name limits and an unrestricted metadata URL', async () => {
    await applyRecipes(db);
    const provider = 'p'.repeat(50);
    const name = '\u00e9'.repeat(255);
    const url = `https://recipes.example.test/${'p'.repeat(1024)}`;
    await db.query('INSERT INTO recipe_sources (id, provider, name, server_url) VALUES ($1, $2, $3, $4)',
      [id(1), provider, name, url]);
    expect((await db.query('SELECT provider, name, server_url FROM recipe_sources')).rows)
      .toEqual([{ provider, name, server_url: url }]);
  });

  test.each([['provider', 51], ['name', 256]] as const)('rejects an overlong source %s', async (column, length) => {
    await applyRecipes(db);
    await addSource(db, 1);
    await expect(db.query(`UPDATE recipe_sources SET ${column} = $1 WHERE id = $2`, ['x'.repeat(length), id(1)]))
      .rejects.toMatchObject({ code: '22001' });
  });

  test('replay preserves user preferences, creator links and imported recipe metadata', async () => {
    await applyRecipes(db);
    await db.query('INSERT INTO users (id) VALUES ($1)', [id(9)]);
    await addSource(db, 1, id(9));
    await addRecipe(db, 2, id(1), 'retained-remote', '2030-01-02 03:04:05');
    await db.query(`
      UPDATE recipe_sources SET enabled = false, name = 'Fixture server',
        provider_config = '{"includeImages":false}', last_synced = '2030-01-02 00:00:00',
        created_at = '2029-12-01 00:00:00', updated_at = '2030-01-02 00:00:00'
      WHERE id = $1
    `, [id(1)]);
    const sourcesBefore = await db.query(`
      SELECT id, provider, server_url, name, enabled, created_by, provider_config,
        last_synced::text, created_at::text, updated_at::text FROM recipe_sources
    `);
    const recipesBefore = await db.query('SELECT id, title, source_id, external_id, external_updated_at::text FROM recipes');
    await applyRecipes(db);
    await applyRecipes(db);
    expect((await db.query(`
      SELECT id, provider, server_url, name, enabled, created_by, provider_config,
        last_synced::text, created_at::text, updated_at::text FROM recipe_sources
    `)).rows).toEqual(sourcesBefore.rows);
    expect((await db.query('SELECT id, title, source_id, external_id, external_updated_at::text FROM recipes')).rows)
      .toEqual(recipesBefore.rows);
    await expect(addRecipe(db, 3, id(1), 'retained-remote')).rejects.toMatchObject({ code: '23505' });
    await expect(addRecipe(db, 4, id(99), 'other-remote')).rejects.toMatchObject({ code: '23503' });
  });

  test('adds missing constraints to a partially migrated recipe table without losing populated linkage', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addRecipe(db, 2, id(1), 'retained-remote');
    await db.exec(`
      ALTER TABLE recipes DROP CONSTRAINT recipes_source_id_recipe_sources_id_fk;
      DROP INDEX recipes_source_external_unique;
      ALTER TABLE recipes DROP COLUMN external_updated_at;
    `);
    await applyRecipes(db);
    expect((await db.query('SELECT id, source_id, external_id, external_updated_at FROM recipes')).rows).toEqual([
      { id: id(2), source_id: id(1), external_id: 'retained-remote', external_updated_at: null },
    ]);
    await expect(addRecipe(db, 3, id(1), 'retained-remote')).rejects.toMatchObject({ code: '23505' });
    await expect(addRecipe(db, 4, id(99), 'new-remote')).rejects.toMatchObject({ code: '23503' });
  });

  test('identity updates cannot merge two existing recipes accidentally', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addRecipe(db, 2, id(1), 'fixture-a');
    await addRecipe(db, 3, id(1), 'fixture-b');
    await expect(db.query('UPDATE recipes SET external_id = $1 WHERE id = $2', ['fixture-a', id(3)]))
      .rejects.toMatchObject({ code: '23505' });
    expect((await db.query('SELECT external_id FROM recipes ORDER BY id')).rows)
      .toEqual([{ external_id: 'fixture-a' }, { external_id: 'fixture-b' }]);
  });

  test('the source-created unique index supports fixture upserts scoped to each source', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addSource(db, 2);
    await addRecipe(db, 3, id(1), 'upsert-remote');
    // This query is fixture-authored to exercise the migration's conflict identity.
    const upsert = `
      INSERT INTO recipes (id, title, source_id, external_id)
      VALUES ($1, $2, $3, 'upsert-remote')
      ON CONFLICT (source_id, external_id) DO UPDATE SET title = EXCLUDED.title
      RETURNING id, title, source_id
    `;
    expect((await db.query(upsert, [id(4), 'Updated fixture', id(1)])).rows).toEqual([
      { id: id(3), title: 'Updated fixture', source_id: id(1) },
    ]);
    expect((await db.query(upsert, [id(5), 'Independent fixture', id(2)])).rows).toEqual([
      { id: id(5), title: 'Independent fixture', source_id: id(2) },
    ]);
    expect((await db.query('SELECT id FROM recipes ORDER BY id')).rows).toEqual([{ id: id(3) }, { id: id(5) }]);
  });

  test('deleting two sources with the same remote identity detaches both recipes without collision', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await addSource(db, 2);
    await addRecipe(db, 3, id(1), 'shared-remote');
    await addRecipe(db, 4, id(2), 'shared-remote');
    await db.exec('DELETE FROM recipe_sources');
    expect((await db.query('SELECT id, source_id, external_id FROM recipes ORDER BY id')).rows).toEqual([
      { id: id(3), source_id: null, external_id: 'shared-remote' },
      { id: id(4), source_id: null, external_id: 'shared-remote' },
    ]);
  });

  test('duplicate legacy identities fail index creation and caller rollback restores the prior schema', async () => {
    await applyRecipes(db);
    await addSource(db, 1);
    await db.exec('DROP INDEX recipes_source_external_unique');
    await addRecipe(db, 2, id(1), 'legacy-duplicate');
    await addRecipe(db, 3, id(1), 'legacy-duplicate');
    await db.exec('ALTER TABLE recipes DROP COLUMN external_updated_at');
    await expect(db.transaction(async tx => { await applyRecipes(tx); }))
      .rejects.toMatchObject({ code: '23505' });
    await expect(db.query('SELECT external_updated_at FROM recipes')).rejects.toMatchObject({ code: '42703' });
    expect((await db.query('SELECT id, external_id FROM recipes ORDER BY id')).rows).toEqual([
      { id: id(2), external_id: 'legacy-duplicate' }, { id: id(3), external_id: 'legacy-duplicate' },
    ]);
  });

  test('missing prerequisite users is diagnosed before recipe linkage is added', async () => {
    await db.exec('DROP TABLE users');
    await expect(applyRecipes(db)).rejects.toMatchObject({ code: '42P01' });
    await expect(db.query('SELECT source_id FROM recipes')).rejects.toMatchObject({ code: '42703' });
  });

  describe('foreign key guard with another schema present', () => {
    let outcome: 'accepted' | 'rejected';

    beforeEach(async () => {
      await db.exec(`
        CREATE SCHEMA fixture_shadow;
        CREATE TABLE fixture_shadow.recipe_sources (id uuid PRIMARY KEY);
        CREATE TABLE fixture_shadow.recipes (
          id uuid PRIMARY KEY, source_id uuid,
          CONSTRAINT recipes_source_id_recipe_sources_id_fk
            FOREIGN KEY (source_id) REFERENCES fixture_shadow.recipe_sources(id)
        );
      `);
      await expect(db.query('INSERT INTO fixture_shadow.recipes (id, source_id) VALUES ($1, $2)', [id(1), id(99)]))
        .rejects.toMatchObject({ code: '23503' });
      await applyRecipes(db);
      // Setup and engine errors are outside the expected-failure assertion.
      try {
        await addRecipe(db, 2, id(99), 'must-not-be-dangling');
        outcome = 'accepted';
      } catch (error: unknown) {
        expect(error).toMatchObject({ code: '23503', constraint: 'recipes_source_id_recipe_sources_id_fk' });
        outcome = 'rejected';
      }
      if (outcome === 'accepted') {
        expect((await db.query('SELECT id, source_id FROM recipes')).rows)
          .toEqual([{ id: id(2), source_id: id(99) }]);
      }
    });

    test.failing('KNOWN GAP: a same-named foreign key in another schema must not disable recipe source integrity', () => {
      expect(outcome).toBe('rejected');
    });
  });
});
