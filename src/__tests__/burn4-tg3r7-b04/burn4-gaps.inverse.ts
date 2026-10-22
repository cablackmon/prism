import { gapCases } from './burn4-gap-cases';

// Run separately with an explicit matcher. Each case must fail at its GAP assertion.
test.each(gapCases)('$name', async ({ verify }) => { await verify(); });
