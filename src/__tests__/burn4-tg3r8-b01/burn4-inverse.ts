import assert from 'node:assert/strict';
import { DesiredContractFailure, gaps } from './burn4-known-gaps';

async function main(): Promise<void> {
  const proof: { id: string; intendedAssertion: string }[] = [];
  for (const gap of gaps) {
    let observed: unknown;
    try {
      // Same desired assertion as the permanent case, without Jest inversion.
      await gap.assertDesired();
    } catch (error) {
      observed = error;
    }
    assert.ok(observed instanceof DesiredContractFailure, `wrong or absent failure for ${gap.id}`);
    assert.equal(observed.message, gap.message);
    proof.push({ id: gap.id, intendedAssertion: observed.message });
  }
  console.log(JSON.stringify({ confirmed: proof.length, proof }, null, 2));
}

void main();
