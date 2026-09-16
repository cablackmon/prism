import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Collector } from '../../src/lib/diagnostics/store';
let count = 0;
const results: string[] = [];
const root = fs.mkdtempSync(
  path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'collector-tests-')
);
function make() {
  let time = 100000;
  const c = new Collector(
    path.join(root, String(count++)),
    'a'.repeat(64),
    'b'.repeat(64),
    'https://kyst-wall-proxy.fly.dev',
    () => time
  );
  const session = 'nox11625-test-session';
  const send = (action: string, body: any = {}, op = true, doc = 'document-12345678') =>
    c.handle({ action, session, document: doc, body }, op, op ? '' : 'cookie-hash') as any;
  send('begin', { expires: time + 2700000, build: 'a'.repeat(64), probe: 'b'.repeat(64) });
  return {
    c,
    send,
    set: (t: number) => {
      time = t;
    },
  };
}
function check(name: string, fn: () => void) {
  fn();
  results.push(name);
}
check('duplicate session refuses durable replacement', () => {
  const { send } = make();
  assert.throws(
    () => send('begin', { expires: 200000, build: 'a'.repeat(64), probe: 'b'.repeat(64) }),
    /already exists/
  );
});
check('lost grant response cannot reissue', () => {
  const { send } = make();
  send('arm', { operation: 'bootstrap' });
  assert.throws(() => send('arm', { operation: 'bootstrap' }), /consumed/);
});
check('lost publication acknowledgement cannot requeue', () => {
  const { send } = make();
  const g = send('arm', { operation: 'bootstrap' });
  send('publish', { operation: 'bootstrap', grant: g.id });
  assert.throws(() => send('publish', { operation: 'bootstrap', grant: g.id }), /consumed/);
});
check('wrong publication grant rejected', () => {
  const { send } = make();
  send('arm', { operation: 'bootstrap' });
  assert.throws(
    () => send('publish', { operation: 'bootstrap', grant: 'wrong-123456789012' }),
    /consumed/
  );
});
check('unverified renderer cannot arm measurement', () => {
  const { send } = make();
  assert.throws(() => send('arm', { operation: 'measure' }), /unverified/);
});
check('grant expiry prevents publication but preserves claim', () => {
  const { send, set } = make();
  const g = send('arm', { operation: 'bootstrap' });
  set(120001);
  assert.throws(() => send('publish', { operation: 'bootstrap', grant: g.id }), /expired/);
  assert.throws(() => send('arm', { operation: 'bootstrap' }), /consumed/);
});
check('expired session refuses effects but records native terminal', () => {
  const { send, set } = make();
  const g = send('arm', { operation: 'bootstrap' });
  send('publish', { operation: 'bootstrap', grant: g.id });
  set(3000000);
  assert.throws(() => send('arm', { operation: 'identity-frame' }), /Expired/);
  assert.equal(
    send('capture-terminal', {
      operation: 'bootstrap',
      grant: g.id,
      ok: false,
      commandReceipt: 'c'.repeat(64),
      error: 'uncertain',
    }).status,
    'terminal'
  );
  assert.equal(send('status').active, 'bootstrap');
});
check('wrong build cannot claim renderer', () => {
  const { send } = make();
  assert.throws(
    () =>
      send(
        'claim',
        {
          origin: 'https://kyst-wall-proxy.fly.dev',
          build: 'c'.repeat(64),
          probe: 'b'.repeat(64),
          iframe: true,
          pathname: '/',
          geometry: { width: 2560, height: 1440, dpr: 1.5, scale: 1 },
        },
        false
      ),
    /Wrong renderer/
  );
});
check('cross-operation serialization rejects overlap', () => {
  const { send } = make();
  send('arm', { operation: 'bootstrap' });
  assert.throws(() => send('arm', { operation: 'identity-frame' }), /Another operation/);
});
console.log(
  JSON.stringify(
    {
      passed: results.length,
      total: 9,
      cases: results,
      scope: 'Actual durable filesystem collector; deterministic clock, no native queue',
    },
    null,
    2
  )
);
