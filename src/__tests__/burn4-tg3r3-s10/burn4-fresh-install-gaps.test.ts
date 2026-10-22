import { cleanFixtures, createFixture } from './burn4-fresh-install-fixture';

afterEach(cleanFixtures);

test.failing('KNOWN GAP: failed container enumeration is accepted when its partial output contains three names', () => {
  const fixture = createFixture({ containersExit: 19 });
  const result = fixture.run();
  expect(result.status).not.toBe(0);
});

test.failing('KNOWN GAP: failed database query is accepted when its partial output contains a valid count', () => {
  const fixture = createFixture({ databaseExit: 27, databaseOutput: ' 7 \n' });
  const result = fixture.run();
  expect(result.status).not.toBe(0);
});

test.failing.each(['', 'not-a-count', '-1'])(
  'KNOWN GAP: invalid database count %j is reported as successful database verification', databaseOutput => {
    const fixture = createFixture({ databaseOutput });
    const result = fixture.run();
    expect(result.status).not.toBe(0);
  },
);

test.failing('KNOWN GAP: partial health response hides curl failure because the failed marker is appended to the body', () => {
  const fixture = createFixture({ healthOutput: '{"status":', healthExit: 18 });
  const result = fixture.run();
  expect(result.status).not.toBe(0);
});

test.failing('KNOWN GAP: page transport failure is accepted after curl emits an HTML prefix', () => {
  const fixture = createFixture({ pageOutput: '<!DOCTYPE html><html>', pageExit: 18 });
  const result = fixture.run();
  expect(result.status).not.toBe(0);
});
