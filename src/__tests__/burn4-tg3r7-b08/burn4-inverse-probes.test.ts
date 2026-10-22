import assert from 'node:assert/strict';
import { gaps } from './burn4-gap-cases';

describe('Direct inverse probes identify intended assertions', () => {
  for (const gap of gaps) test(`${gap.id} fails at its named desired-contract assertion`, async () => {
    await assert.rejects(gap.probe, error => {
      assert.ok(error instanceof assert.AssertionError, `Unexpected loader/fake failure in ${gap.id}`);
      assert.ok(error.message.includes(`[B08 ${gap.id}]`), `Unexpected prerequisite failure in ${gap.id}: ${error.message}`);
      console.log(`${gap.id}: ${error.message}`);
      return true;
    });
  });
});
