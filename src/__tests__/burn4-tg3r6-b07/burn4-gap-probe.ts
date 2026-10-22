import { gaps } from './burn4-gap-cases';

// Run this non-discovered probe separately. It exposes the two desired-behavior
// assertion failures without Jest's expected-failure inversion.
for (const gap of gaps) test(gap.name, gap.assertDesiredBehavior);
