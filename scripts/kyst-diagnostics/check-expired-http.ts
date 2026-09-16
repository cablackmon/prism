import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import pins from '../../src/lib/diagnostics/generated-pins.json';
async function main() {
  const root = process.env.PAPERCLIP_RUN_SCRATCH_DIR!,
    origin = 'http://127.0.0.1:4398',
    token = 'v1.' + crypto.randomBytes(32).toString('hex');
  const p = spawn(
    process.execPath,
    ['--import', 'tsx', 'scripts/kyst-diagnostics/http-harness.ts'],
    {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        TEST_PORT: '4398',
        KYST_DIAGNOSTIC_ENABLED: '1',
        KYST_DIAGNOSTIC_TEST_DIR: fs.mkdtempSync(path.join(root, 'expired-http-')),
        KYST_DIAGNOSTIC_TEST_ORIGIN: origin,
        KYST_AUTH_PASSWORD: 'test-only',
        KYST_AUTH_SECRET: crypto.randomBytes(32).toString('hex'),
        KYST_AUTH_SERVICE_TOKEN: token,
      },
      stdio: 'ignore',
    }
  );
  const call = (action: string, body: any) =>
    fetch(origin + '/api/kyst-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kyst-service-token': token },
      body: JSON.stringify({ action, session: 'nox11625-expired-test', body }),
    });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        await fetch(origin + '/api/kyst-diagnostics');
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(ready);
    assert.equal(
      (await call('begin', { expires: Date.now() + 300, build: pins.build, probe: pins.probe }))
        .status,
      200
    );
    await new Promise((r) => setTimeout(r, 350));
    assert.equal((await call('arm', { operation: 'bootstrap' })).status, 409);
    assert.equal((await call('status', {})).status, 200);
    fs.writeFileSync(
      path.join(root, 'expired-http-checks.json'),
      JSON.stringify({
        passed: 2,
        total: 2,
        cases: [
          'expired actual HTTP session refuses arming',
          'expired state remains readable to operator',
        ],
      })
    );
  } finally {
    p.kill('SIGTERM');
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
