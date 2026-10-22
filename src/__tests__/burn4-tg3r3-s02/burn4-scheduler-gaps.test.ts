import { cleanFixtures, createFixture } from './burn4-shell-fixture';

afterEach(cleanFixtures);

test.failing('KNOWN GAP: scheduler promises an immediate startup backup but skips it outside the configured hour', () => {
  const fixture = createFixture({ hourSequence: ['02'] });
  fixture.runScheduler();
  expect(fixture.calls().filter(call => ['burn4-backup.sh', 'sleep'].includes(call.command))[0]?.command)
    .toBe('burn4-backup.sh');
});
