import { SmokeHarness, initialization, initializedHarness, toolsResponse } from './burn4-smoke-harness';

describe('offline MCP smoke timer and cleanup boundaries', () => {
  test('initialization timeout waits through the exact deadline, then fails at the next poll', async () => {
    const harness = new SmokeHarness();
    await harness.advance(3000);
    expect(harness.exits).toEqual([]);
    expect(harness.pendingTimers).toBe(1);
    await harness.advance(24);
    expect(harness.exits).toEqual([]);
    await harness.advance(1);
    expect(harness.errors).toEqual(['SMOKE TEST FAILED: timeout waiting for id 1']);
    expect(harness.exits).toEqual([1]);
    expect(harness.kills).toBe(1);
    expect(harness.pendingTimers).toBe(0);
    expect(harness.writes).toHaveLength(1);
  });

  test('tool discovery receives its own full timeout window after delayed initialization', async () => {
    const harness = new SmokeHarness();
    await harness.advance(2975);
    harness.frame(initialization());
    await harness.advance(25);
    expect(harness.writes).toHaveLength(3);
    await harness.advance(3000);
    expect(harness.exits).toEqual([]);
    await harness.advance(25);
    expect(harness.errors).toEqual(['SMOKE TEST FAILED: timeout waiting for id 2']);
    expect(harness.exits).toEqual([1]);
    expect(harness.kills).toBe(1);
    expect(harness.pendingTimers).toBe(0);
  });

  test('a response buffered at the deadline succeeds before timeout evaluation', async () => {
    const harness = new SmokeHarness();
    await harness.advance(3000);
    harness.frame(initialization());
    await harness.advance(25);
    harness.frame(toolsResponse());
    await harness.advance(25);
    expect(harness.exits).toEqual([0]);
    expect(harness.errors).toEqual([]);
  });

  test('unrelated responses do not reset the initialization deadline', async () => {
    const harness = new SmokeHarness();
    await harness.advance(2975);
    harness.frame(initialization(42));
    await harness.advance(50);
    expect(harness.exits).toEqual([1]);
    expect(harness.errors).toEqual(['SMOKE TEST FAILED: timeout waiting for id 1']);
    expect(harness.pendingTimers).toBe(0);
  });

  test.each(['initialize', 'notifications/initialized', 'tools/list'])(
    'stdin write failure during %s kills the child and reports controlled failure', async method => {
      const harness = new SmokeHarness({ onWrite: (frame, runtime) => {
        if (frame.method === method) throw new Error('synthetic pipe write failed');
        if (frame.method === 'initialize') runtime.frame(initialization());
      } });
      await harness.advance(25);
      expect(harness.exits).toEqual([1]);
      expect(harness.errors).toEqual(['SMOKE TEST FAILED: synthetic pipe write failed']);
      expect(harness.kills).toBe(1);
      expect(harness.pendingTimers).toBe(0);
      expect(harness.escapes).toEqual([]);
    },
  );

  test('both phases clear their polling timers after success', async () => {
    const harness = new SmokeHarness();
    expect(harness.pendingTimers).toBe(1);
    harness.frame(initialization());
    await harness.advance(25);
    expect(harness.pendingTimers).toBe(1);
    harness.frame(toolsResponse());
    await harness.advance(25);
    expect(harness.pendingTimers).toBe(0);
    await harness.advance(10000);
    expect(harness.exits).toEqual([0]);
    expect(harness.kills).toBe(1);
  });

  test('server failure during tool listing cannot produce a success marker', async () => {
    const harness = await initializedHarness();
    await harness.advance(3025);
    expect(harness.logs.some(line => line.includes('PASSED'))).toBe(false);
    expect(harness.errors).toEqual(['SMOKE TEST FAILED: timeout waiting for id 2']);
    expect(harness.exits).toEqual([1]);
  });
});
