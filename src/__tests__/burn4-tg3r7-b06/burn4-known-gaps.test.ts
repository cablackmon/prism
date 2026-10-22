import { gaps } from './burn4-gaps';

describe('KNOWN GAP desired contracts in unchanged E2E callbacks', () => {
  test.failing.each(gaps)('$id: $name', async gap => gap.assertDesired());
});
