# Offline MCP smoke protocol tests

These tests execute the existing `.mcp/smoke.mjs` CLI body in a VM. They cover
initialization and notification order, expected tool discovery, fragmented and
multiple JSON lines, irrelevant responses, isolated concurrent runs, timeout
boundaries, write failures, and explicit failure regressions.

All source process, environment, child, pipe, console, clock and timer objects are
fake. The harness imports no child-process module, launches no server, reads no
caller environment and invokes no MCP tool. It retains environment key names
only, never values. Fixture names and diagnostics are synthetic. No family data,
database, network, credential operation or paid API is used.

The harness removes exactly the source's three fixed import statements and
substitutes a synthetic module URL before wrapping the otherwise unchanged body
in an async VM script. Pure URL and path functions resolve the fake server path.
The VM has no import loader or real timers. A manually advanced clock runs the
25 ms polling callbacks, with promise checkpoints between ticks. VM synchronous
execution has a one second limit. Event-handler exceptions are captured at the
fake emitter boundary so tests can inspect missing controlled failure behavior.

`process.exit` records the requested status and returns. This models the current
source because both exits occur at their branch tails and there is no `finally`
block. It does not model OS termination, inherited descriptors, process signals,
or future code after an exit call. `child.kill` records a request; these tests
verify requested cleanup rather than real process termination.

From the repository root, run only this package's tests:

```sh
./node_modules/.bin/jest --runInBand --cacheDirectory /tmp/prism-burn4-tg3r4-a02-jest-cache --runTestsByPath src/__tests__/burn4-tg3r4-a02/burn4-smoke-protocol.test.ts src/__tests__/burn4-tg3r4-a02/burn4-smoke-lifecycle.test.ts src/__tests__/burn4-tg3r4-a02/burn4-smoke-gaps.test.ts
./node_modules/.bin/eslint --max-warnings 0 src/__tests__/burn4-tg3r4-a02/burn4-smoke-harness.ts src/__tests__/burn4-tg3r4-a02/burn4-smoke-protocol.test.ts src/__tests__/burn4-tg3r4-a02/burn4-smoke-lifecycle.test.ts src/__tests__/burn4-tg3r4-a02/burn4-smoke-gaps.test.ts
./node_modules/.bin/tsc -p src/__tests__/burn4-tg3r4-a02/burn4-tsconfig.json
```

The focused run has 46 cases: 38 ordinary passes and 8 expected failures, with no
skipped cases. Strict TypeScript covers tests and harness only. The unchanged
JavaScript CLI is exercised at runtime, not typechecked. Lint covers the four
new TypeScript files. No full suite or repository build is claimed.

Each `test.failing` case asserts desired behavior. A fix should make that case
unexpectedly pass until its expected-failure marker is removed. Isolated inverse
probes remove that marker in a temporary copy and run each named case, verifying
that it fails at the behavior assertion rather than setup.

KNOWN GAP cases:

- Initialize RPC errors are accepted as a successful handshake, allowing an
  eventual success exit after the server refused initialization.
- Tools/list RPC errors lose the server's failure message and report unrelated
  missing tools instead.
- Malformed stdout JSON throws from the data callback without controlled
  failure or immediate cleanup.
- A JSON null frame throws in response matching on every polling callback,
  preventing even the timeout path from completing.
- Child error events have no listener and escape the controlled failure path.
- Child exit events do not stop polling or report the actual early exit.
- Synchronous spawn exceptions occur outside the failure handler.
- Stdin error events have no listener and escape controlled cleanup.

Final frames without a newline remain buffered by design for this newline
delimited transport; this package does not call that a defect. Needs-decision:
none. Production source is unchanged.
