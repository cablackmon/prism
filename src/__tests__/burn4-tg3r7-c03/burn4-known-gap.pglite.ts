import { id, withSchema } from './burn4-database';

test.failing('KNOWN GAP prior root tg3r6-b05: shadow-schema recipe FK name suppresses the public fresh-install FK', () => withSchema(async (db) => {
  await expect(db.query('INSERT INTO public.recipes (id,name,source_id) VALUES ($1,$2,$3)',
    [id(200), 'Synthetic orphan recipe', id(999)]))
    .rejects.toMatchObject({ code: '23503', table: 'recipes' });
}, true));
