import {
  SmokeHarness, completedHarness, initialization, initializedHarness,
  requiredNames, toolsResponse,
} from './burn4-smoke-harness';

describe('offline MCP smoke handshake', () => {
  test('starts the server through three fake pipes with only explicit environment keys', async () => {
    const harness = new SmokeHarness();
    expect(harness.spawns).toEqual([{
      executable: 'node', args: ['/burn4-fixture/.mcp/dist/index.js'],
      environmentKeys: ['PRISM_API_TOKEN', 'PRISM_BASE_URL'],
      stdio: ['pipe', 'pipe', 'pipe'],
    }]);
    await harness.finish();
  });

  test('initialization includes protocol and client identity before any other write', async () => {
    const harness = new SmokeHarness();
    expect(harness.writes).toEqual([{
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-06-18', capabilities: {},
        clientInfo: { name: 'smoke', version: '0.0.0' },
      },
    }]);
    await harness.finish();
  });

  test('waits for initialization before notifying and listing tools', async () => {
    const harness = new SmokeHarness();
    await harness.advance(250);
    expect(harness.writes.map(frame => frame.method)).toEqual(['initialize']);
    harness.frame(initialization());
    await harness.advance(25);
    expect(harness.writes.map(frame => frame.method)).toEqual([
      'initialize', 'notifications/initialized', 'tools/list',
    ]);
    expect(harness.writes[1]).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(harness.writes[2]).toEqual({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await harness.finish();
  });

  test('successful discovery kills the fake server once and exits successfully', async () => {
    const harness = await completedHarness();
    expect(harness.exits).toEqual([0]);
    expect(harness.kills).toBe(1);
    expect(harness.pendingTimers).toBe(0);
    expect(harness.errors).toEqual([]);
    expect(harness.escapes).toEqual([]);
    expect(harness.emittedErrors).toEqual([]);
    expect(harness.logs).toEqual([
      expect.stringContaining('server: burn4-fixture v0.0.0'),
      expect.stringContaining('6 tools'),
      expect.stringContaining('all expected tools present'),
      expect.stringContaining('Smoke test PASSED'),
    ]);
  });

  test('each request and notification is a complete independent JSON line', async () => {
    const harness = await completedHarness();
    expect(harness.wireWrites).toHaveLength(3);
    for (const text of harness.wireWrites) {
      expect(text.endsWith('\n')).toBe(true);
      expect(text.split('\n')).toHaveLength(2);
      expect(() => JSON.parse(text)).not.toThrow();
    }
  });

  test('does not invoke any MCP tool during discovery', async () => {
    const harness = await completedHarness();
    expect(harness.writes.map(frame => frame.method)).toEqual([
      'initialize', 'notifications/initialized', 'tools/list',
    ]);
  });

  test('accepts responses emitted synchronously during stdin writes', async () => {
    const harness = new SmokeHarness({ onWrite: (frame, runtime) => {
      if (frame.method === 'initialize') runtime.frame(initialization());
      if (frame.method === 'tools/list') runtime.frame(toolsResponse());
    } });
    await harness.advance(50);
    expect(harness.exits).toEqual([0]);
    expect(harness.pendingTimers).toBe(0);
  });

  test('independent concurrent instances cannot exchange responses or timers', async () => {
    const first = new SmokeHarness();
    const second = new SmokeHarness();
    first.frame(initialization());
    await first.advance(25);
    expect(second.writes).toHaveLength(1);
    expect(second.now).toBe(0);
    first.frame(toolsResponse());
    await first.advance(25);
    await second.advance(3025);
    expect(first.exits).toEqual([0]);
    expect(second.exits).toEqual([1]);
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([expect.stringContaining('timeout waiting for id 1')]);
    expect(first.kills).toBe(1);
    expect(second.kills).toBe(1);
  });
});

describe('offline MCP smoke stream framing', () => {
  test('holds a fragmented frame until its newline arrives', async () => {
    const harness = new SmokeHarness();
    const wire = JSON.stringify(initialization());
    harness.chunk(wire.slice(0, 12));
    await harness.advance(25);
    expect(harness.writes).toHaveLength(1);
    harness.chunk(wire.slice(12));
    await harness.advance(25);
    expect(harness.writes).toHaveLength(1);
    harness.chunk('\n');
    await harness.advance(25);
    expect(harness.writes).toHaveLength(3);
    harness.frame(toolsResponse());
    await harness.advance(25);
    expect(harness.exits).toEqual([0]);
  });

  test('handles responses fragmented one character at a time', async () => {
    const harness = new SmokeHarness();
    for (const character of JSON.stringify(initialization()) + '\n') harness.chunk(character);
    await harness.advance(25);
    for (const character of JSON.stringify(toolsResponse()) + '\n') harness.chunk(character);
    await harness.advance(25);
    expect(harness.exits).toEqual([0]);
    expect(harness.emittedErrors).toEqual([]);
  });

  test('ignores blank lines, whitespace and CRLF separators', async () => {
    const harness = new SmokeHarness();
    harness.chunk('\n  \r\n\t\n  ' + JSON.stringify(initialization()) + '\r\n\n');
    await harness.advance(25);
    harness.chunk('\r\n' + JSON.stringify(toolsResponse()) + '  \r\n');
    await harness.advance(25);
    expect(harness.exits).toEqual([0]);
    expect(harness.emittedErrors).toEqual([]);
  });

  test('parses several frames in one chunk and caches the later response', async () => {
    const harness = new SmokeHarness();
    harness.chunk(JSON.stringify(initialization()) + '\n' + JSON.stringify(toolsResponse()) + '\n');
    await harness.advance(50);
    expect(harness.exits).toEqual([0]);
    expect(harness.writes.map(frame => frame.method)).toEqual([
      'initialize', 'notifications/initialized', 'tools/list',
    ]);
  });

  test('retains a trailing partial frame after a complete earlier frame', async () => {
    const harness = new SmokeHarness();
    const list = JSON.stringify(toolsResponse());
    harness.chunk(JSON.stringify(initialization()) + '\n' + list.slice(0, 18));
    await harness.advance(25);
    expect(harness.exits).toEqual([]);
    harness.chunk(list.slice(18) + '\n');
    await harness.advance(25);
    expect(harness.exits).toEqual([0]);
  });

  test('matches numeric response IDs while ignoring notifications and unrelated replies', async () => {
    const harness = new SmokeHarness();
    harness.frame({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } });
    harness.frame(initialization(99));
    harness.frame(initialization('1'));
    await harness.advance(75);
    expect(harness.writes).toHaveLength(1);
    harness.frame(initialization());
    await harness.advance(25);
    harness.frame(toolsResponse(requiredNames, '2'));
    await harness.advance(25);
    expect(harness.exits).toEqual([]);
    harness.frame(toolsResponse());
    await harness.advance(25);
    expect(harness.exits).toEqual([0]);
  });

  test('stderr text does not contaminate stdout response framing', async () => {
    const harness = await initializedHarness();
    harness.emit('stderr', 'data', 'synthetic diagnostic\n');
    harness.frame(toolsResponse());
    await harness.advance(25);
    expect(harness.stderrWrites).toEqual(['[server] synthetic diagnostic\n']);
    expect(harness.exits).toEqual([0]);
  });
});

describe('offline MCP smoke required tool verification', () => {
  test('accepts unordered expected names mixed with additional and duplicate tools', async () => {
    const harness = await completedHarness(['additional_fixture_tool', ...requiredNames.slice().reverse(), 'list_family']);
    expect(harness.exits).toEqual([0]);
    expect(harness.logs).toContainEqual(expect.stringContaining('8 tools'));
  });

  test.each(requiredNames)('fails discovery when %s is missing', async missing => {
    const harness = await completedHarness(requiredNames.filter(name => name !== missing));
    expect(harness.exits).toEqual([1]);
    expect(harness.kills).toBe(1);
    expect(harness.errors).toEqual([`SMOKE TEST FAILED: missing expected tools: ${missing}`]);
    expect(harness.logs.some(line => line.includes('PASSED'))).toBe(false);
    expect(harness.pendingTimers).toBe(0);
  });

  test('reports all missing names in a deterministic order', async () => {
    const harness = await completedHarness([]);
    expect(harness.errors).toEqual([`SMOKE TEST FAILED: missing expected tools: ${requiredNames.join(', ')}`]);
    expect(harness.exits).toEqual([1]);
  });

  test.each([
    { jsonrpc: '2.0', id: 2 },
    { jsonrpc: '2.0', id: 2, result: null },
    { jsonrpc: '2.0', id: 2, result: {} },
    { jsonrpc: '2.0', id: 2, result: { tools: null } },
  ])('handles an absent tool array as a missing-tool failure: %#', async response => {
    const harness = await initializedHarness();
    harness.frame(response);
    await harness.advance(25);
    expect(harness.exits).toEqual([1]);
    expect(harness.errors).toEqual([expect.stringContaining('missing expected tools:')]);
    expect(harness.kills).toBe(1);
  });

  test('malformed nonarray tools fail through the controlled error path', async () => {
    const harness = await initializedHarness();
    harness.frame({ id: 2, result: { tools: { name: 'fixture' } } });
    await harness.advance(25);
    expect(harness.exits).toEqual([1]);
    expect(harness.errors).toEqual([expect.stringContaining('tools.some is not a function')]);
    expect(harness.escapes).toEqual([]);
    expect(harness.kills).toBe(1);
  });

  test('malformed null tool entries fail through the controlled error path', async () => {
    const harness = await initializedHarness();
    harness.frame({ id: 2, result: { tools: [null] } });
    await harness.advance(25);
    expect(harness.exits).toEqual([1]);
    expect(harness.errors).toEqual([expect.stringContaining('SMOKE TEST FAILED:')]);
    expect(harness.kills).toBe(1);
    expect(harness.escapes).toEqual([]);
  });
});
