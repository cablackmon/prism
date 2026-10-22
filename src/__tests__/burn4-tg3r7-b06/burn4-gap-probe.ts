import assert from 'node:assert/strict';
import { gaps } from './burn4-gaps';

async function main() {
  let confirmed = 0;
  for (const gap of gaps) {
    try {
      await gap.assertDesired();
      console.error(`UNEXPECTED PASS ${gap.id}`);
    } catch (error) {
      if (error instanceof assert.AssertionError && error.message.includes(`GAP ${gap.id}:`)) {
        confirmed++;
        console.log(`INTENDED ASSERTION ${gap.id}: ${error.message.split('\n')[0]}`);
      } else {
        console.error(`UNEXPECTED FAILURE ${gap.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  console.log(`Confirmed intended assertions: ${confirmed}/${gaps.length}`);
  process.exitCode = confirmed === gaps.length ? 1 : 2;
}

void main();
