import { createFixture } from './burn4-command-harness';

const fixtures: Array<ReturnType<typeof createFixture>> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); });

describe('deployment KNOWN GAP regressions', () => {
  test.failing.each([7, 22])('KNOWN GAP: readiness curl failure %i returns zero after printing a warning', (failCode) => {
    const fixture = createFixture({ failStage: 'readiness', failCode });
    fixtures.push(fixture);
    const result = fixture.run('deploy');
    expect(result.status).not.toBe(0);
  });
});
