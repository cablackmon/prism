import { gaps } from './burn4-gap-cases';

describe('KNOWN GAP desired contracts in original E2E callbacks', () => {
  for (const gap of gaps) test.failing(`${gap.id}: ${gap.name}`, gap.probe);
});
