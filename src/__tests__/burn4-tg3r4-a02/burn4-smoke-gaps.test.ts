import { SmokeHarness, initializedHarness, toolsResponse } from './burn4-smoke-harness';

describe('actual MCP smoke failure regressions', () => {
  test.failing('KNOWN GAP: initialize RPC errors are accepted as a successful handshake', async () => {
    const harness = new SmokeHarness();
    harness.frame({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'synthetic initialization refused' } });
    await harness.advance(25);
    harness.frame(toolsResponse());
    await harness.advance(25);
    expect(harness.exits).toEqual([1]);
    expect(harness.writes.map(frame => frame.method)).toEqual(['initialize']);
    expect(harness.errors).toContainEqual(expect.stringContaining('synthetic initialization refused'));
  });

  test.failing('KNOWN GAP: tools/list RPC errors discard the actual server failure diagnostic', async () => {
    const harness = await initializedHarness();
    harness.frame({ jsonrpc: '2.0', id: 2, error: { code: -32603, message: 'synthetic discovery refused' } });
    await harness.advance(25);
    expect(harness.exits).toEqual([1]);
    expect(harness.kills).toBe(1);
    expect(harness.errors).toContainEqual(expect.stringContaining('synthetic discovery refused'));
  });

  test.failing('KNOWN GAP: malformed stdout JSON escapes the handler without controlled cleanup', async () => {
    const harness = new SmokeHarness();
    harness.chunk('{invalid synthetic frame}\n');
    await harness.flush();
    try {
      expect(harness.exits).toEqual([1]);
      expect(harness.emittedErrors).toEqual([]);
      expect(harness.kills).toBe(1);
      expect(harness.pendingTimers).toBe(0);
    } finally { await harness.finish(); }
  });

  test.failing('KNOWN GAP: JSON null stdout frames crash response matching and cannot report failure', async () => {
    const harness = new SmokeHarness();
    harness.chunk('null\n');
    await harness.advance(25);
    try {
      expect(harness.exits).toEqual([1]);
      expect(harness.emittedErrors).toEqual([]);
      expect(harness.kills).toBe(1);
    } finally { await harness.finish(); }
  });

  test.failing('KNOWN GAP: child error events have no listener and escape without cleanup', async () => {
    const harness = new SmokeHarness();
    harness.emit('child', 'error', new Error('synthetic spawn event failure'));
    await harness.flush();
    try {
      expect(harness.exits).toEqual([1]);
      expect(harness.emittedErrors).toEqual([]);
      expect(harness.pendingTimers).toBe(0);
    } finally { await harness.finish(); }
  });

  test.failing('KNOWN GAP: an exited child waits for a response timeout instead of reporting its failure', async () => {
    const harness = new SmokeHarness();
    harness.emit('child', 'exit', 7);
    await harness.advance(25);
    try {
      expect(harness.emittedErrors).toEqual([]);
      expect(harness.exits).toEqual([1]);
      expect(harness.errors).toContainEqual(expect.stringContaining('7'));
      expect(harness.pendingTimers).toBe(0);
    } finally { await harness.finish(); }
  });

  test.failing('KNOWN GAP: synchronous spawn failures bypass the controlled failure handler', async () => {
    const harness = new SmokeHarness({ spawnFailure: 'synthetic spawn call failure' });
    await harness.flush();
    expect(harness.exits).toEqual([1]);
    expect(harness.escapes).toEqual([]);
    expect(harness.errors).toContainEqual(expect.stringContaining('synthetic spawn call failure'));
  });

  test.failing('KNOWN GAP: stdin error events lack a listener and bypass controlled cleanup', async () => {
    const harness = await initializedHarness();
    harness.emit('stdin', 'error', new Error('synthetic stdin error event'));
    await harness.flush();
    try {
      expect(harness.exits).toEqual([1]);
      expect(harness.emittedErrors).toEqual([]);
      expect(harness.kills).toBe(1);
      expect(harness.pendingTimers).toBe(0);
    } finally { await harness.finish(); }
  });
});
