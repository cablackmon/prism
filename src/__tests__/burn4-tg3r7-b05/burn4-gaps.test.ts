import { gaps, verifyGap } from './burn4-gap-cases';

for (const gap of gaps) {
  test.failing(`KNOWN GAP: ${gap.name}`, () => verifyGap(gap));
  test(`Fixture reaches the intended boundary: ${gap.name}`, async () => {
    expect((await gap.exercise()).exercised).toBe(true);
  });
  test(`Intended repair satisfies the contract: ${gap.name}`, () => verifyGap(gap, true));
}
