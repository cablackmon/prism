import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from '@playwright/test';
import { createHouseholdSession } from '../../src/lib/auth/householdAuth';
import pins from '../../src/lib/diagnostics/generated-pins.json';
const scratch = process.env.PAPERCLIP_RUN_SCRATCH_DIR!;
const port = 4397,
  origin = `http://127.0.0.1:${port}`,
  secret = crypto.randomBytes(32).toString('hex'),
  token = 'v1.' + crypto.randomBytes(32).toString('hex');
const server = spawn(
  process.execPath,
  ['--import', 'tsx', 'scripts/kyst-diagnostics/http-harness.ts'],
  {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      KYST_DIAGNOSTIC_ENABLED: '1',
      KYST_DIAGNOSTIC_TEST_DIR: fs.mkdtempSync(path.join(scratch, 'http-ledger-')),
      KYST_DIAGNOSTIC_TEST_ORIGIN: origin,
      KYST_AUTH_PASSWORD: 'test-only',
      KYST_AUTH_SECRET: secret,
      KYST_AUTH_SERVICE_TOKEN: token,
      ENTRY_BUNDLE: path.join(scratch, 'entry.js'),
      TEST_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let logs = '';
server.stdout.on('data', (v) => (logs += v));
server.stderr.on('data', (v) => (logs += v));
const checks: string[] = [];
let browser: any;
const session = 'nox11625-browser-session';
async function api(action: string, body: any = {}, status = 200, extra: any = {}) {
  const r = await fetch(origin + '/api/kyst-diagnostics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-kyst-service-token': token, ...extra },
    body: JSON.stringify({ action, session, body }),
  });
  const value = await r.json();
  assert.equal(r.status, status, JSON.stringify(value));
  return value;
}
const wait = async (fn: () => Promise<any>, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out');
};
const native = async (op: string, sha = 'a'.repeat(64)) => {
  const g = await api('arm', { operation: op });
  await api('publish', { operation: op, grant: g.id });
  await api('capture-terminal', {
    operation: op,
    grant: g.id,
    ok: true,
    sha256: sha,
    width: 3840,
    height: 2160,
    capturedAt: Date.now(),
    commandReceipt: 'b'.repeat(64),
  });
  return g;
};
async function main() {
  try {
    await wait(async () => {
      try {
        return (await fetch(origin + '/api/kyst-diagnostics')).status === 401;
      } catch {
        return false;
      }
    });
    const unauthorized = await fetch(origin + '/api/kyst-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(unauthorized.status, 403);
    checks.push('unauthenticated mutation refused');
    await api(
      'begin',
      { expires: Date.now() + 20 * 60000, build: 'a'.repeat(64), probe: pins.probe },
      409
    );
    checks.push('wrong runtime build refused via HTTP');
    await api('begin', { expires: Date.now() + 20 * 60000, build: pins.build, probe: pins.probe });
    await api('begin', { expires: Date.now() + 60000, build: pins.build, probe: pins.probe }, 409);
    checks.push('duplicate session refused via real HTTP');
    const bootstrap = await api('arm', { operation: 'bootstrap' });
    await api('arm', { operation: 'bootstrap' }, 409);
    await api('publish', { operation: 'bootstrap', grant: bootstrap.id });
    await api('publish', { operation: 'bootstrap', grant: bootstrap.id }, 409);
    checks.push('lost/duplicate publication is permanently consumed via HTTP');
    await api('capture-terminal', {
      operation: 'bootstrap',
      grant: bootstrap.id,
      ok: true,
      commandReceipt: 'b'.repeat(64),
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 2560, height: 1440 },
      deviceScaleFactor: 1.5,
    });
    await context.addCookies([
      { name: 'kyst_household_session', value: await createHouseholdSession(secret), url: origin },
    ]);
    const page = await context.newPage();
    page.on('console', (m: any) => {
      logs += '\nBROWSER ' + m.type() + ': ' + m.text();
    });
    page.on('pageerror', (e: any) => {
      logs += '\nPAGEERROR ' + e;
    });
    await page.goto(origin + '/outer');
    const ready = await wait(async () => {
      const s = await api('status');
      return s.renderer?.ready ? s : undefined;
    });
    checks.push('integrated browser entry claimed exact document and reported ready');
    await api('arm', { operation: 'measure' }, 409);
    checks.push('unverified renderer cannot arm');
    const frame=page.frames().find((f:any)=>f!==page.mainFrame())!;
    const accessibility=await frame.evaluate(`(() => {
      const el=document.querySelector('[data-kyst-diagnostic-identity]');
      const style=getComputedStyle(el);
      function luminance(css){const channels=css.match(/\\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;}
      const rect=el.getBoundingClientRect();
      return {contrast:(luminance(style.color)+0.05)/(luminance(style.backgroundColor)+0.05),role:el.getAttribute('role'),focus:document.activeElement?.tagName,fit:rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight};
    })()`);
    assert.ok(accessibility.contrast>=4.5);assert.equal(accessibility.role,'status');assert.equal(accessibility.focus,'BODY');assert.equal(accessibility.fit,true);
    fs.writeFileSync(path.join(scratch,'accessibility.json'),JSON.stringify(accessibility));
    await page.screenshot({ path: path.join(scratch, 'diagnostic-before.png') });
    const bytes = fs.readFileSync(path.join(scratch, 'diagnostic-before.png'));
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    await native('identity-frame', sha);
    const evidence = {
      challenge: ready.renderer.challenge,
      document: ready.renderer.document,
      identityReceipt: 'c'.repeat(64),
      frame: sha,
      pid: 123,
      createdTicks: '1234567890',
      session: 1,
      width: 3840,
      height: 2160,
    };
    await api('verify', { ...evidence, challenge: 'wrong-123456789012' }, 409);
    await api('verify', evidence);
    checks.push('wrong challenge refuses; correlated development renderer accepted');
    const measure = await api('arm', { operation: 'measure' });
    await api('arm', { operation: 'scroll' }, 409);
    const measured = await wait(async () => {
      const s = await api('status');
      return s.grants.measure.status === 'terminal' ? s.grants.measure.result : null;
    }, 20000);
    assert.equal(measured.restoreVerified, true);
    assert.equal(measured.ok, true);
    assert.equal(measured.trustedTouchSampleCount, 0);
    checks.push(
      'actual browser10second rAF session and restoration; zero touch explicitly retained'
    );
    await api('arm', { operation: 'scroll' });
    await wait(async () => {
      const s = await api('status');
      return s.captureWindow;
    });
    const capture = await api('arm', { operation: 'scrolled-frame' });
    await api('publish', { operation: 'scrolled-frame', grant: capture.id });
    await api(
      'capture-terminal',
      {
        operation: 'scrolled-frame',
        grant: 'wrong-123456789012',
        ok: true,
        sha256: 'd'.repeat(64),
        width: 3840,
        height: 2160,
        capturedAt: Date.now(),
        commandReceipt: 'b'.repeat(64),
      },
      409
    );
    await api(
      'capture-terminal',
      {
        operation: 'scrolled-frame',
        grant: capture.id,
        ok: true,
        sha256: 'd'.repeat(64),
        width: 1920,
        height: 1080,
        capturedAt: Date.now(),
        commandReceipt: 'b'.repeat(64),
      },
      409
    );
    checks.push('wrong acknowledgement geometry refuses without settling issuance');
    await page.screenshot({ path: path.join(scratch, 'diagnostic-scrolled.png') });
    const scrolledHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(scratch, 'diagnostic-scrolled.png')))
      .digest('hex');
    await api('capture-terminal', {
      operation: 'scrolled-frame',
      grant: capture.id,
      ok: true,
      sha256: scrolledHash,
      width: 3840,
      height: 2160,
      capturedAt: Date.now(),
      commandReceipt: 'b'.repeat(64),
    });
    const done = await wait(async () => {
      const s = await api('status');
      return s.grants.scroll.status === 'terminal' ? s : null;
    });
    assert.equal(done.grants.scroll.result.ok, true);
    assert.equal(done.grants.scroll.result.restoreVerified, true);
    checks.push(
      'real browser scroll waits for authenticated matching issuance acknowledgement and restores'
    );
    await api('arm', { operation: 'scrolled-frame' }, 409);
    await api('arm', { operation: 'scroll' }, 409);
    checks.push('capture and scroll duplicates refused after completion');
    await page.screenshot({ path: path.join(scratch, 'diagnostic-after.png') });
    await api('disable');
    await api('arm', { operation: 'restored-frame' }, 409);
    checks.push('deactivation prevents new effects');
    checks.push('overlapping measurement and scroll refused via HTTP');
    fs.writeFileSync(
      path.join(scratch, 'http-browser-checks.json'),
      JSON.stringify(
        {
          passed: checks.length,
          total: 13,
          cases: checks,
          measurement: measured,
          scroll: done.grants.scroll.result,
          scope:
            'Real HTTP route/auth/durable filesystem and Chromium with integrated client; controlled seven-widget DOM. Native process/receipts mocked, physical touch0; not kiosk proof.',
        },
        null,
        2
      )
    );
    console.log(JSON.stringify({ passed: checks.length, total: 13 }));
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    fs.writeFileSync(path.join(scratch, 'http-server.log'), logs);
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
