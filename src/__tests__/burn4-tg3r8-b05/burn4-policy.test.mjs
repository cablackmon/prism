import test from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_LIMITS, planNotificationBadges } from '../../../scripts/burn4-notification-badges.mjs';

/** @typedef {import('../../../scripts/burn4-notification-badges.mjs').BadgeInput} BadgeInput */
/** @typedef {import('../../../scripts/burn4-notification-badges.mjs').BadgeMessage} BadgeMessage */
/** @typedef {import('../../../scripts/burn4-notification-badges.mjs').BadgeCompletion} BadgeCompletion */

/** @param {Partial<BadgeMessage>} [changes] @returns {BadgeMessage} */
function message(changes = {}) {
  return { id: 'message-a', authorId: 'other', createdAtMs: 100, expiresAtMs: null, readByViewer: false, ...changes };
}

/** @param {Partial<BadgeCompletion>} [changes] @returns {BadgeCompletion} */
function completion(changes = {}) {
  return { id: 'completion-a', choreId: 'chore-a', completedAtMs: 100, requiresApproval: true, approvedById: null, approvedAtMs: null, ...changes };
}

/** @param {Partial<BadgeInput>} [changes] @returns {BadgeInput} */
function input(changes = {}) {
  return {
    schemaVersion: 1, nowMs: 1_000, viewer: { id: 'parent-a', role: 'parent' }, mode: 'normal',
    messages: { status: 'ready', complete: true, forUserId: 'parent-a', records: [message()] },
    completions: { status: 'ready', complete: true, forUserId: 'parent-a', records: [completion()] },
    ...changes,
  };
}

test('parent attention combines unread messages and distinct pending completion records', () => {
  const data = input();
  data.completions?.records.push(completion({ id: 'completion-b' }));
  assert.deepEqual(planNotificationBadges(data), {
    readiness: 'exact', ownerId: 'parent-a',
    counts: { unapprovedChores: 2, unreadMessages: 1, total: 3 }, diagnostics: [],
  });
});

test('child receives unread attention without inspecting the approval source', () => {
  const plan = planNotificationBadges(input({
    viewer: { id: 'child-a', role: 'child' },
    messages: { status: 'ready', complete: true, forUserId: 'child-a', records: [message()] },
    completions: undefined,
  }));
  assert.deepEqual(plan.counts, { unapprovedChores: 0, unreadMessages: 1, total: 1 });
  assert.equal(plan.readiness, 'exact');
});

/** @type {Array<[string, Partial<BadgeInput>]>} */
const privateCases = [
  ['logged out', { viewer: null }],
  ['guest', { viewer: { id: 'display', role: 'guest' } }],
  ['away', { mode: 'away' }],
  ['babysitter', { mode: 'babysitter' }],
];
for (const [name, changes] of privateCases) {
  test(`${name} suppresses all underlying source counts`, () => {
    const plan = planNotificationBadges(input(changes));
    assert.equal(plan.readiness, 'suppressed');
    assert.equal(plan.ownerId, null);
    assert.equal(plan.counts, null);
    assert.deepEqual(plan.diagnostics, [{ code: 'visibility-suppressed', path: 'viewer' }]);
  });
}

test('privacy suppression does not access message or completion payloads', () => {
  const data = input({ mode: 'away' });
  Object.defineProperty(data, 'messages', { get() { throw new Error('private source inspected'); } });
  Object.defineProperty(data, 'completions', { get() { throw new Error('private source inspected'); } });
  assert.equal(planNotificationBadges(data).readiness, 'suppressed');
});

test('expiration equality and past expiration are excluded; future expiration is live', () => {
  const data = input();
  assert.ok(data.messages);
  data.messages.records = [
    message({ id: 'at-boundary', expiresAtMs: 1_000 }),
    message({ id: 'past', expiresAtMs: 999 }),
    message({ id: 'future', expiresAtMs: 1_001 }),
    message({ id: 'no-expiry' }),
  ];
  assert.equal(planNotificationBadges(data).counts?.unreadMessages, 2);
});

test('read, self-authored and future-created messages do not add attention', () => {
  const data = input();
  assert.ok(data.messages);
  data.messages.records = [
    message({ id: 'read', readByViewer: true }),
    message({ id: 'own', authorId: 'parent-a' }),
    message({ id: 'future', createdAtMs: 1_001 }),
    message({ id: 'at-now', createdAtMs: 1_000 }),
  ];
  assert.equal(planNotificationBadges(data).counts?.unreadMessages, 1);
});

test('either approval marker, no approval requirement, and future completion exclude pending attention', () => {
  const data = input();
  assert.ok(data.completions);
  data.completions.records = [
    completion({ id: 'by-parent', approvedById: 'parent-b' }),
    completion({ id: 'at-time', approvedAtMs: 500 }),
    completion({ id: 'automatic', requiresApproval: false }),
    completion({ id: 'future', completedAtMs: 1_001 }),
    completion({ id: 'at-now', completedAtMs: 1_000 }),
  ];
  assert.equal(planNotificationBadges(data).counts?.unapprovedChores, 1);
});

test('complete empty sources provide an exact zero rather than unknown attention', () => {
  const data = input();
  assert.ok(data.messages && data.completions);
  data.messages.records = [];
  data.completions.records = [];
  assert.deepEqual(planNotificationBadges(data).counts, { unapprovedChores: 0, unreadMessages: 0, total: 0 });
});

test('identical duplicate message and completion IDs collapse in separate namespaces', () => {
  const data = input();
  assert.ok(data.messages && data.completions);
  data.messages.records = [message({ id: 'same' }), message({ id: 'same' })];
  data.completions.records = [completion({ id: 'same' }), completion({ id: 'same' })];
  assert.equal(planNotificationBadges(data).counts?.total, 2);
});

test('conflicting duplicate read state makes message totals unknown', () => {
  const data = input();
  data.messages?.records.push(message({ readByViewer: true }));
  const plan = planNotificationBadges(data);
  assert.equal(plan.readiness, 'unknown');
  assert.equal(plan.counts, null);
  assert.deepEqual(plan.diagnostics, [{ code: 'duplicate-conflict', path: 'messages.records[1]' }]);
});

test('conflicting completion approval metadata makes totals unknown', () => {
  const data = input();
  data.completions?.records.push(completion({ approvedAtMs: 500 }));
  assert.equal(planNotificationBadges(data).readiness, 'unknown');
});

test('record order and irrelevant presentation metadata do not change attention', () => {
  const data = input();
  assert.ok(data.messages);
  data.messages.records = [message(), message({ id: 'read', readByViewer: true })];
  const before = planNotificationBadges(data);
  data.messages.records.reverse();
  Object.assign(data.messages.records[0] ?? {}, { pinned: true, important: true, updatedAtMs: 2_000 });
  assert.deepEqual(planNotificationBadges(data), before);
});

test('an incomplete relevant source prevents a false exact zero or partial total', () => {
  const data = input();
  assert.ok(data.messages);
  data.messages.complete = false;
  data.messages.records = [];
  assert.equal(planNotificationBadges(data).counts, null);
  assert.deepEqual(planNotificationBadges(data).diagnostics, [{ code: 'source-incomplete', path: 'messages' }]);
});

test('an unavailable approval source prevents exact parent attention', () => {
  const data = input();
  assert.ok(data.completions);
  data.completions.status = 'unavailable';
  assert.equal(planNotificationBadges(data).readiness, 'unknown');
});

test('a snapshot for a previous viewer cannot supply current read state', () => {
  const data = input();
  assert.ok(data.messages);
  data.messages.forUserId = 'previous-viewer';
  const plan = planNotificationBadges(data);
  assert.equal(plan.counts, null);
  assert.deepEqual(plan.diagnostics, [{ code: 'source-owner-mismatch', path: 'messages' }]);
});

test('missing per-viewer read state is unknown rather than inferred from time', () => {
  const data = input();
  const malformed = { ...message(), readByViewer: undefined, updatedAtMs: 100 };
  const plan = planNotificationBadges({ ...data, messages: { ...data.messages, records: [malformed] } });
  assert.equal(plan.readiness, 'unknown');
  assert.deepEqual(plan.diagnostics, [{ code: 'record-invalid', path: 'messages.records[0]' }]);
});

test('oversized snapshot is bounded and is not silently truncated', () => {
  const data = input();
  assert.ok(data.messages);
  data.messages.records = Array.from({ length: BADGE_LIMITS.recordsPerSource + 1 }, () => message());
  assert.deepEqual(planNotificationBadges(data).diagnostics, [{ code: 'source-limit', path: 'messages.records' }]);
});

test('record IDs have a bounded length and malformed records do not expose values', () => {
  const data = input();
  assert.ok(data.messages);
  data.messages.records = [message({ id: 'x'.repeat(BADGE_LIMITS.idLength + 1) })];
  const plan = planNotificationBadges(data);
  assert.equal(plan.counts, null);
  assert.equal(JSON.stringify(plan).includes('x'.repeat(100)), false);
});

/** @type {Array<[string, unknown]>} */
const badContexts = [
  ['null input', null],
  ['array input', []],
  ['schema', { ...input(), schemaVersion: 2 }],
  ['missing viewer', { ...input(), viewer: undefined }],
  ['invalid role', { ...input(), viewer: { id: 'person', role: 'administrator' } }],
  ['invalid mode', { ...input(), mode: 'public' }],
  ['NaN time', { ...input(), nowMs: Number.NaN }],
  ['infinite time', { ...input(), nowMs: Infinity }],
  ['unsafe time', { ...input(), nowMs: Number.MAX_SAFE_INTEGER + 1 }],
  ['negative time', { ...input(), nowMs: -1 }],
];
for (const [name, data] of badContexts) {
  test(`${name} produces a suppressed controlled context error`, () => {
    const plan = planNotificationBadges(data);
    assert.equal(plan.readiness, 'suppressed');
    assert.equal(plan.counts, null);
    assert.equal(plan.ownerId, null);
    assert.equal(plan.diagnostics[0]?.code, 'context-invalid');
  });
}

test('invalid expiry and approval timestamps do not count as clean absent state', () => {
  const data = input();
  const plan = planNotificationBadges({
    ...data,
    messages: { ...data.messages, records: [message({ expiresAtMs: Number.NaN })] },
    completions: { ...data.completions, records: [completion({ approvedAtMs: -1 })] },
  });
  assert.equal(plan.readiness, 'unknown');
  assert.equal(plan.diagnostics.length, 2);
});

test('throwing context/source accessors and proxies are sanitized into privacy suppression', () => {
  for (const field of ['schemaVersion', 'viewer', 'messages']) {
    const data = input();
    Object.defineProperty(data, field, { get() { throw new Error('private accessor detail'); } });
    const plan = planNotificationBadges(data);
    assert.deepEqual(plan, {
      readiness: 'suppressed', ownerId: null, counts: null,
      diagnostics: [{ code: 'context-invalid', path: 'input' }],
    });
  }
  const hostile = new Proxy({}, { get() { throw new Error('proxy detail'); } });
  assert.equal(planNotificationBadges(hostile).readiness, 'suppressed');
});

test('planning does not mutate frozen input and read flags remain explicitly caller-owned', () => {
  const data = input();
  assert.ok(data.messages && data.completions);
  Object.freeze(data.messages.records[0]);
  Object.freeze(data.messages.records);
  Object.freeze(data.messages);
  Object.freeze(data.completions.records[0]);
  Object.freeze(data.completions.records);
  Object.freeze(data.completions);
  const before = JSON.stringify(data);
  planNotificationBadges(Object.freeze(data));
  assert.equal(JSON.stringify(data), before);
});
