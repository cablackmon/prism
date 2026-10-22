import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationBadgeController } from '../../../scripts/burn4-notification-badges.mjs';

/** @typedef {import('../../../scripts/burn4-notification-badges.mjs').BadgeInput} BadgeInput */
/** @typedef {import('../../../scripts/burn4-notification-badges.mjs').BadgePorts} BadgePorts */
/** @typedef {import('../../../scripts/burn4-notification-badges.mjs').BadgeFallback} BadgeFallback */
/** @typedef {import('../../../scripts/burn4-notification-badges.mjs').BadgeControllerResult} BadgeControllerResult */
/** @typedef {ReturnType<typeof createNotificationBadgeController>} Controller */

/** @param {number} [count] @param {string} [owner] @returns {BadgeInput} */
function input(count = 1, owner = 'parent-a') {
  return {
    schemaVersion: 1, nowMs: 1_000, viewer: { id: owner, role: 'parent' }, mode: 'normal',
    messages: {
      status: 'ready', complete: true, forUserId: owner,
      records: Array.from({ length: count }, (_, index) => ({
        id: `message-${index}`, authorId: 'other', createdAtMs: 100, expiresAtMs: null, readByViewer: false,
      })),
    },
    completions: { status: 'ready', complete: true, forUserId: owner, records: [] },
  };
}

function deferred() {
  /** @type {() => void} */
  let resolve = () => {};
  /** @type {(error: Error) => void} */
  let reject = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** @param {Partial<BadgePorts>} [changes] @param {import('../../../scripts/burn4-notification-badges.mjs').BadgeControllerOptions} [options] */
function setup(changes = {}, options = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {BadgeFallback[]} */
  const states = [];
  const controller = createNotificationBadgeController({
    setAppBadge(count) { calls.push(`set:${count}`); },
    clearAppBadge() { calls.push('clear'); },
    renderFallback(state) { states.push(state); },
    ...changes,
  }, options);
  return { controller, calls, states };
}

test('actual injected delivery clears unknown ownership then sets; fallback hides on success', async () => {
  const { controller, calls, states } = setup();
  assert.equal((await controller.update(input(3))).status, 'applied');
  assert.deepEqual(calls, ['clear', 'set:3']);
  assert.deepEqual(states, [
    { kind: 'exact', count: 3, reason: 'pending' },
    { kind: 'hidden', count: null, reason: 'native-applied' },
  ]);
  await controller.dispose();
});

test('same owner/count is not redundantly written; zero is cleared instead of set', async () => {
  const { controller, calls } = setup();
  await controller.update(input(2));
  await controller.update(input(2));
  await controller.update(input(0));
  await controller.update(input(0));
  assert.deepEqual(calls, ['clear', 'set:2', 'clear']);
  await controller.dispose();
});

test('a supplied applied state is copied and avoids an unnecessary write', async () => {
  const initialApplied = { ownerId: 'parent-a', count: 2 };
  const { controller, calls } = setup({}, { initialApplied });
  initialApplied.count = 7;
  await controller.update(input(2));
  assert.deepEqual(calls, []);
  await controller.dispose();
});

/** @type {Array<[string, Partial<BadgeInput>]>} */
const privateCases = [
  ['logout', { viewer: null }],
  ['guest', { viewer: { id: 'display', role: 'guest' } }],
  ['away', { mode: 'away' }],
  ['babysitter', { mode: 'babysitter' }],
];
for (const [name, changes] of privateCases) {
  test(`${name} clears previously applied attention and only publishes hidden fallback`, async () => {
    const { controller, calls, states } = setup({}, { initialApplied: { ownerId: 'parent-a', count: 5 } });
    await controller.update({ ...input(7), ...changes });
    assert.deepEqual(calls, ['clear']);
    assert.ok(states.length > 0);
    assert.ok(states.every((state) => state.kind === 'hidden' && state.count === null));
    await controller.dispose();
  });
}

test('invalid context clears potentially foreign state without exposing its count', async () => {
  const { controller, calls, states } = setup({}, { initialApplied: { ownerId: 'old', count: 8 } });
  const result = await controller.update({ invalid: true });
  assert.deepEqual(calls, ['clear']);
  assert.ok(states.every((state) => state.kind === 'hidden' && state.count === null));
  assert.equal(result.diagnostics[0]?.code, 'context-invalid');
  await controller.dispose();
});

test('throwing unknown-input accessors still return a promise, hide fallback and clear prior native state', async () => {
  const { controller, calls, states } = setup({}, { initialApplied: { ownerId: 'parent-a', count: 8 } });
  const data = Object.defineProperty({}, 'schemaVersion', {
    get() { throw new Error('raw accessor detail must not escape'); },
  });
  const pending = controller.update(data);
  assert.ok(pending instanceof Promise);
  const result = await pending;
  assert.deepEqual(calls, ['clear']);
  assert.ok(states.every((state) => state.kind === 'hidden' && state.count === null));
  assert.deepEqual(result.diagnostics, [{ code: 'context-invalid', path: 'input' }]);
  assert.equal(JSON.stringify(result).includes('accessor detail'), false);
  await controller.dispose();
});

test('complete user switch resets native ownership before setting new attention', async () => {
  const { controller, calls, states } = setup({}, { initialApplied: { ownerId: 'parent-a', count: 4 } });
  await controller.update(input(2, 'parent-b'));
  assert.deepEqual(calls, ['clear', 'set:2']);
  assert.deepEqual(states[0], { kind: 'exact', count: 2, reason: 'pending' });
  await controller.dispose();
});

test('incomplete same-owner input holds native state and publishes unknown without a guessed number', async () => {
  const { controller, calls, states } = setup({}, { initialApplied: { ownerId: 'parent-a', count: 4 } });
  const data = input();
  assert.ok(data.messages);
  data.messages.complete = false;
  assert.equal((await controller.update(data)).status, 'held');
  assert.deepEqual(calls, []);
  assert.deepEqual(states, [{ kind: 'unknown', count: null, reason: 'pending' }]);
  await controller.dispose();
});

test('incomplete user switch clears old native state instead of retaining the old viewer count', async () => {
  const { controller, calls, states } = setup({}, { initialApplied: { ownerId: 'parent-a', count: 4 } });
  const data = input(2, 'parent-b');
  data.messages = undefined;
  await controller.update(data);
  assert.deepEqual(calls, ['clear']);
  assert.ok(states.every((state) => state.kind === 'unknown' && state.count === null));
  await controller.dispose();
});

test('unsupported native capability renders an exact visible fallback', async () => {
  const { controller, calls, states } = setup({ setAppBadge: undefined, clearAppBadge: undefined });
  assert.equal((await controller.update(input(3))).status, 'fallback');
  assert.deepEqual(calls, []);
  assert.deepEqual(states.at(-1), { kind: 'exact', count: 3, reason: 'native-unsupported' });
  await controller.dispose();
});

test('setter without a clearer is never used for personal native delivery', async () => {
  const { controller, calls, states } = setup({ clearAppBadge: undefined });
  await controller.update(input(3));
  assert.deepEqual(calls, []);
  assert.equal(states.at(-1)?.count, 3);
  await controller.dispose();
});

test('unsupported capability with incomplete data reports unknown fallback rather than claiming a held badge', async () => {
  const { controller, calls, states } = setup({ setAppBadge: undefined, clearAppBadge: undefined });
  const data = input();
  data.messages = undefined;
  assert.equal((await controller.update(data)).status, 'fallback');
  assert.deepEqual(calls, []);
  assert.deepEqual(states.at(-1), { kind: 'unknown', count: null, reason: 'native-unsupported' });
  await controller.dispose();
});

test('queued native work uses the immediate plan instead of later caller mutations', async () => {
  const { controller, calls } = setup();
  const data = input(3);
  const pending = controller.update(data);
  data.messages = undefined;
  data.viewer = null;
  await pending;
  assert.deepEqual(calls, ['clear', 'set:3']);
  await controller.dispose();
});

test('clearer without a setter still removes previous owner state and renders fallback', async () => {
  const { controller, calls, states } = setup({ setAppBadge: undefined }, { initialApplied: { ownerId: 'old', count: 9 } });
  await controller.update(input(3));
  assert.deepEqual(calls, ['clear']);
  assert.equal(states.at(-1)?.reason, 'native-unsupported');
  await controller.dispose();
});

test('synchronous set throw produces current fallback and sanitized diagnostics', async () => {
  const { controller, states } = setup({ setAppBadge() { throw new Error('do not expose host details'); } });
  const result = await controller.update(input(3));
  assert.equal(result.status, 'fallback');
  assert.equal(result.diagnostics.at(-1)?.code, 'native-set-failed');
  assert.deepEqual(states.at(-1), { kind: 'exact', count: 3, reason: 'native-set-failed' });
  assert.equal(JSON.stringify(result).includes('host details'), false);
  await controller.dispose();
});

test('rejected set promise is caught and a later update can retry', async () => {
  let fail = true;
  const { controller, states } = setup({
    setAppBadge() { return fail ? Promise.reject(new Error('host rejection')) : Promise.resolve(); },
  });
  assert.equal((await controller.update(input())).status, 'fallback');
  fail = false;
  assert.equal((await controller.update(input())).status, 'applied');
  assert.equal(states.at(-1)?.kind, 'hidden');
  await controller.dispose();
});

test('failed ownership clear prevents a new set and keeps only the new fallback count', async () => {
  const { controller, calls, states } = setup({ clearAppBadge() { throw new Error('clear failed'); } });
  const result = await controller.update(input(2, 'parent-b'));
  assert.equal(result.status, 'fallback');
  assert.deepEqual(calls, []);
  assert.deepEqual(states.at(-1), { kind: 'exact', count: 2, reason: 'native-clear-failed' });
  await controller.dispose();
});

test('failed privacy clear never exposes an exact fallback count', async () => {
  const { controller, states } = setup({ clearAppBadge() { return Promise.reject(new Error('clear rejected')); } });
  const result = await controller.update({ ...input(9), mode: 'away' });
  assert.equal(result.status, 'fallback');
  assert.ok(states.every((state) => state.kind === 'hidden' && state.count === null));
  await controller.dispose();
});

test('fallback rendering throws are controlled while native work still reconciles', async () => {
  const { controller, calls } = setup({ renderFallback() { throw new Error('renderer details'); } });
  const result = await controller.update(input(2));
  assert.equal(result.status, 'applied');
  assert.deepEqual(calls, ['clear', 'set:2']);
  assert.ok(result.diagnostics.every((entry) => entry.code === 'fallback-render-failed'));
  assert.equal(result.diagnostics.length, 2);
  assert.equal((await controller.dispose()).diagnostics[0]?.code, 'fallback-render-failed');
});

test('pending updates are coalesced and stale success cannot publish an old count', async () => {
  const started = deferred();
  const gate = deferred();
  /** @type {number[]} */
  const sets = [];
  const { controller, states } = setup({
    setAppBadge(count) {
      sets.push(count);
      if (count === 1) { started.resolve(); return gate.promise; }
    },
  });
  const first = controller.update(input(1));
  await started.promise;
  const second = controller.update(input(2));
  const stateIndex = states.length;
  const third = controller.update(input(3));
  assert.equal((await first).status, 'superseded');
  assert.equal((await second).status, 'superseded');
  gate.resolve();
  assert.equal((await third).status, 'applied');
  assert.deepEqual(sets, [1, 3]);
  assert.ok(states.slice(stateIndex).every((state) => state.count !== 1 && state.count !== 2));
  await controller.dispose();
});

test('late old-owner rejection cannot overwrite the new viewer fallback', async () => {
  const started = deferred();
  const gate = deferred();
  const { controller, states, calls } = setup({
    setAppBadge(count) {
      calls.push(`set:${count}`);
      if (count === 1) { started.resolve(); return gate.promise; }
    },
  });
  const old = controller.update(input(1));
  await started.promise;
  const index = states.length;
  const next = controller.update(input(2, 'parent-b'));
  gate.reject(new Error('old owner failure'));
  assert.equal((await old).status, 'superseded');
  assert.equal((await next).status, 'applied');
  assert.deepEqual(calls, ['clear', 'set:1', 'clear', 'set:2']);
  assert.ok(states.slice(index).every((state) => state.count !== 1 && state.reason !== 'native-set-failed'));
  await controller.dispose();
});

test('privacy transition while set is pending is hidden immediately and clears after settlement', async () => {
  const started = deferred();
  const gate = deferred();
  const { controller, calls, states } = setup({
    setAppBadge(count) { calls.push(`set:${count}`); started.resolve(); return gate.promise; },
  });
  const old = controller.update(input(4));
  await started.promise;
  const index = states.length;
  const hidden = controller.update({ ...input(8), viewer: null });
  assert.deepEqual(states.at(-1), { kind: 'hidden', count: null, reason: 'pending' });
  gate.resolve();
  await old;
  await hidden;
  assert.deepEqual(calls, ['clear', 'set:4', 'clear']);
  assert.ok(states.slice(index).every((state) => state.kind === 'hidden' && state.count === null));
  await controller.dispose();
});

test('fallback callback can replace the update before any native effect begins', async () => {
  /** @type {Controller} */
  let controller;
  /** @type {Promise<BadgeControllerResult>|undefined} */
  let replacement;
  /** @type {string[]} */
  const calls = [];
  let reentered = false;
  controller = createNotificationBadgeController({
    setAppBadge(count) { calls.push(`set:${count}`); },
    clearAppBadge() { calls.push('clear'); },
    renderFallback(state) {
      if (state.kind === 'exact' && !reentered) {
        reentered = true;
        replacement = controller.update(input(2));
      }
    },
  });
  assert.equal((await controller.update(input(1))).status, 'superseded');
  assert.ok(replacement);
  await replacement;
  assert.deepEqual(calls, ['clear', 'set:2']);
  await controller.dispose();
});

test('fallback callback can dispose before any set, including reentrant dispose', async () => {
  /** @type {Controller} */
  let controller;
  /** @type {Promise<BadgeControllerResult>|undefined} */
  let closing;
  /** @type {string[]} */
  const calls = [];
  controller = createNotificationBadgeController({
    setAppBadge(count) { calls.push(`set:${count}`); },
    clearAppBadge() { calls.push('clear'); },
    renderFallback(state) {
      if (state.kind === 'exact') closing = controller.dispose();
      if (state.reason === 'disposed') closing = controller.dispose();
    },
  });
  assert.equal((await controller.update(input())).status, 'disposed');
  assert.ok(closing);
  await closing;
  assert.deepEqual(calls, ['clear']);
});

test('native port can synchronously reenter update without publishing stale completion', async () => {
  /** @type {Controller} */
  let controller;
  /** @type {Promise<BadgeControllerResult>|undefined} */
  let replacement;
  /** @type {string[]} */
  const calls = [];
  /** @type {BadgeFallback[]} */
  const states = [];
  controller = createNotificationBadgeController({
    setAppBadge(count) {
      calls.push(`set:${count}`);
      if (count === 1) replacement = controller.update(input(2, 'parent-b'));
    },
    clearAppBadge() { calls.push('clear'); },
    renderFallback(state) { states.push(state); },
  });
  assert.equal((await controller.update(input(1))).status, 'superseded');
  assert.ok(replacement);
  await replacement;
  assert.deepEqual(calls, ['clear', 'set:1', 'clear', 'set:2']);
  const replacementIndex = states.findIndex((state) => state.count === 2);
  assert.ok(replacementIndex >= 0);
  assert.ok(states.slice(replacementIndex).every((state) => state.count !== 1));
  await controller.dispose();
});

test('disposal during pending set hides immediately, fences callbacks and eventually clears once', async () => {
  const started = deferred();
  const gate = deferred();
  const { controller, calls, states } = setup({
    setAppBadge(count) { calls.push(`set:${count}`); started.resolve(); return gate.promise; },
  });
  const pending = controller.update(input(1));
  await started.promise;
  const closing = controller.dispose();
  const countAfterDisposal = states.length;
  assert.equal((await pending).status, 'disposed');
  assert.equal(controller.dispose(), closing);
  assert.deepEqual(states.at(-1), { kind: 'hidden', count: null, reason: 'disposed' });
  assert.equal((await controller.update(input(9))).status, 'disposed');
  gate.resolve();
  assert.equal((await closing).status, 'disposed');
  assert.deepEqual(calls, ['clear', 'set:1', 'clear']);
  assert.equal(states.length, countAfterDisposal);
});

test('failed final disposal clear resolves with a controlled diagnostic and no later callbacks', async () => {
  const { controller, states } = setup({ clearAppBadge() { throw new Error('cleanup failure'); } });
  const result = await controller.dispose();
  assert.equal(result.status, 'disposed');
  assert.deepEqual(result.diagnostics, [{ code: 'native-clear-failed', path: 'ports.clearAppBadge' }]);
  assert.equal(states.length, 1);
});

test('invalid controller ports and initial applied state fail with bounded static errors', () => {
  assert.throws(() => Reflect.apply(createNotificationBadgeController, null, [{ renderFallback: undefined }]), /renderFallback/);
  assert.throws(() => Reflect.apply(createNotificationBadgeController, null, [{ renderFallback() {}, setAppBadge: 1 }]), /ports/);
  assert.throws(() => setup({}, { initialApplied: { ownerId: 'a', count: -1 } }), /initialApplied/);
});
