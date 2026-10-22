import { gapCases } from './burn4-gap-cases';

describe('desired contracts for confirmed source defects', () => {
  test.failing.each(gapCases)('$name', async ({ verify }) => { await verify(); });
});
