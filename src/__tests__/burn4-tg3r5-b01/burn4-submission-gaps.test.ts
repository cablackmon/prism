import { gaps } from './burn4-gap-cases';

for (const gap of gaps) {
  test.failing(gap.name, gap.check);
}
