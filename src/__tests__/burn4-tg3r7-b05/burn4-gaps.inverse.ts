import { gaps, verifyGap } from './burn4-gap-cases';

for (const gap of gaps) {
  test(`INVERSE KNOWN GAP: ${gap.name}`, () => verifyGap(gap));
}
