import { parentForeignKeyContract, prepareCollision } from './burn4-collision';
import { db, reset } from './burn4-database';

async function main(): Promise<void> {
  try {
    await reset();
    await prepareCollision();
    await parentForeignKeyContract();
  } finally {
    await db.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
