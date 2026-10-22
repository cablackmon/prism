import assert from 'node:assert/strict';
import { addPin, db, id, migrate } from './burn4-database';

export async function prepareCollision(): Promise<void> {
  await migrate(1, 2);
  await db.exec(`
    CREATE SCHEMA collision;
    CREATE TABLE collision.travel_pins (
      parent_id uuid,
      CONSTRAINT travel_pins_parent_id_fkey CHECK (parent_id IS NULL)
    );
  `);
  await migrate(3, 3);
  await addPin(1);
}

export async function parentForeignKeyContract(): Promise<void> {
  await assert.rejects(
    db.query('UPDATE public.travel_pins SET parent_id = $1 WHERE id = $2', [id(999), id(1)]),
    { code: '23503' },
    'A same-named constraint in another schema must not suppress the public parent foreign key',
  );
}
