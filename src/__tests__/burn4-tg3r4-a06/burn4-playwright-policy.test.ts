import { globsToMatcher } from 'jest-util';
import { browserPolicy } from './burn4-tooling-harness';

describe('Playwright policy without browser or server startup', () => {
  it.each([undefined, ''])('allows local debugging and reuses the local server for CI=%p', ci => {
    const { policy, reads, defineConfig } = browserPolicy(ci);
    expect(policy.forbidOnly).toBe(false);
    expect(policy.retries).toBe(0);
    expect(policy.workers).toBeUndefined();
    expect(policy.webServer.reuseExistingServer).toBe(true);
    expect(reads).toEqual(['CI', 'CI', 'CI', 'CI']);
    expect(defineConfig).toHaveBeenCalledTimes(1);
  });

  it.each(['build', 'false'])('isolates CI runs and retries failures for a nonempty CI marker %p', ci => {
    const { policy, reads } = browserPolicy(ci);
    expect(policy.forbidOnly).toBe(true);
    expect(policy.retries).toBe(2);
    expect(policy.workers).toBe(1);
    expect(policy.webServer.reuseExistingServer).toBe(false);
    expect(reads).toEqual(['CI', 'CI', 'CI', 'CI']);
  });

  it('keeps browser requests and readiness checks on the same local origin', () => {
    const { policy } = browserPolicy();
    expect(new URL(policy.use.baseURL).origin).toBe(new URL(policy.webServer.url).origin);
    expect(new URL(policy.webServer.url).hostname).toBe('localhost');
    expect(policy.use.trace).toBe('on-first-retry');
    expect(policy.webServer.command).toBe('npm run dev');
  });

  it('excludes recorded demos while keeping ordinary e2e scenario paths eligible', () => {
    const { policy } = browserPolicy();
    const ignored = globsToMatcher(policy.testIgnore);
    expect(ignored('/synthetic/e2e/demos/scenarios/burn4-example.spec.ts')).toBe(true);
    expect(ignored('/synthetic/e2e/burn4-example.spec.ts')).toBe(false);
    expect(policy.testDir).toBe('./e2e');
    expect(policy.globalTeardown).toBe('./e2e/global-teardown.ts');
  });

  it('copies the selected device profile into the project without mutating other evaluations', () => {
    const first = browserPolicy().policy;
    const second = browserPolicy('build').policy;
    expect(first.projects[0]?.use.viewport).toEqual({ width: 1280, height: 720 });
    expect(first.projects[0]?.use).not.toBe(second.projects[0]?.use);
    expect(first.fullyParallel).toBe(true);
    expect(second.webServer.reuseExistingServer).toBe(false);
    expect(first.webServer.reuseExistingServer).toBe(true);
  });
});
