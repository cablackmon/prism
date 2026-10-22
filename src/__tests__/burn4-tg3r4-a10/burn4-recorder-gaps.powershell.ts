import { RecorderFixture, type Options } from './burn4-recorder-fixture';

describe('demo recorder KNOWN GAP regressions', () => {
  const fixtures: RecorderFixture[] = [];
  function fixture(options: Options): RecorderFixture {
    const created = new RecorderFixture(options);
    fixtures.push(created);
    return created;
  }
  afterEach(() => { for (const created of fixtures.splice(0)) created.dispose(); });

  test.failing.each([
    { stage: 'database', databaseStatus: 17 },
    { stage: 'redis', redisStatus: 18 },
  ])('KNOWN GAP: native $stage reset failure is announced as Data reset', (options) => {
    const result = fixture(options).run();
    expect(result.invocations.find((call) => call.stage === options.stage)?.status).toBe(options.databaseStatus ?? options.redisStatus);
    expect(result.events).toEqual(['health', 'database', 'redis', 'record', 'encode']);
    expect(result.stderr).not.toContain('unexpected');
    expect(result.stdout).not.toContain('[OK] Data reset');
  });

  test.failing('KNOWN GAP: failed encoding accepts a stale GIF as successful output', () => {
    const created = fixture({ encoderStatus: 23, staleGifs: { 'dashboard-overview.gif': 19 } });
    const result = created.run();
    expect(result.invocations.find((call) => call.stage === 'encode')?.status).toBe(23);
    expect(created.gif('dashboard-overview.gif')?.length).toBe(19);
    expect(result.stderr).not.toContain('unexpected');
    expect(result.stdout).not.toContain('-> dashboard-overview.gif (0 MB)');
  });


});
