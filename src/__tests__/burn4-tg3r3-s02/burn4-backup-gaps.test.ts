import { cleanFixtures, createFixture } from './burn4-shell-fixture';

const health = 'https://health.invalid/burn4';
const settings = { RCLONE_REMOTE: 'fixture:prism/database', HC_URL: health };

afterEach(cleanFixtures);

test.failing('KNOWN GAP: a failed pg_dump with a large partial stream is accepted as a successful backup', () => {
  const fixture = createFixture({ dumpExit: 12, dumpBytes: 12001 });
  const result = fixture.runBackup(settings);
  expect(result.status).not.toBe(0);
});

test.failing('KNOWN GAP: compression failure exits without sending a failure health ping', () => {
  const fixture = createFixture({ gzipExit: 8 });
  fixture.runBackup(settings);
  expect(fixture.calls().filter(call => call.command === 'curl').at(-1)?.args.at(-1))
    .toBe(`${health}/fail`);
});

test.failing.each(['copy:database', 'sync:data', 'check:database', 'check:data'])(
  'KNOWN GAP: off-site failure %s returns a successful process exit status', failure => {
    const fixture = createFixture({ rcloneFailures: [failure] });
    fixture.writeData('avatars/burn4-avatar.txt');
    const result = fixture.runBackup(settings);
    expect(result.status).not.toBe(0);
  },
);

test.failing('KNOWN GAP: a configured remote with missing rclone sends a successful health ping', () => {
  const fixture = createFixture({ rcloneInstalled: false });
  fixture.runBackup(settings);
  expect(fixture.calls().filter(call => call.command === 'curl').at(-1)?.args.at(-1))
    .toBe(`${health}/fail`);
});

test.failing('KNOWN GAP: asset verification skips non-photo cache folders that are included in asset sync', () => {
  const fixture = createFixture();
  fixture.writeData('avatars/cache/burn4-avatar.txt');
  fixture.runBackup(settings);
  expect(fixture.calls().filter(call => call.command === 'rclone'
    && call.args[0] === 'check' && call.args[1] === fixture.data)).toHaveLength(1);
});
