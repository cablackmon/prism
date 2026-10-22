import { gapCases } from './burn4-gap-cases';

describe('KNOWN GAP desired contracts with independent direct probes', () => {
  test.failing.each(gapCases)('$name', async gap => { await gap.run(); });
});
