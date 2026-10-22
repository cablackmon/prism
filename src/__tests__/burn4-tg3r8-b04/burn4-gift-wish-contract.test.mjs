// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectWishSnapshot, reconcileGiftWishes } from '../../../scripts/burn4-gift-wish-reconcile.mjs';
import { fixture, freeze, idea, wish } from './burn4-gift-wish-fixtures.mjs';

/** @param {unknown} input */
function invalid(input) {
  const result = reconcileGiftWishes(input);
  assert.equal(result.status, 'invalid');
  assert.equal(result.snapshot, null);
  assert.deepEqual(result.actions, []); assert.deepEqual(result.noops, []); assert.deepEqual(result.review, []);
  assert.ok(result.issues.length);
  assert.ok(result.issues.every(row => Object.keys(row).sort().join() === 'code,path'));
}

/** @type {[string, unknown][]} */
const invalidInputs = [
  ['null envelope', null], ['array envelope', []],
  ['missing actor', { memberIds: ['giver'], ideas: [], wishes: [], bindings: [] }],
  ['foreign creator', fixture({ ideas: [idea({ creatorId: 'sibling' })] })],
  ['self recipient', fixture({ ideas: [idea({ recipientId: 'giver' })] })],
  ['actor own secret wish', fixture({ wishes: [wish({ ownerId: 'giver' })] })],
  ['nonmember actor', fixture({ actorId: 'outsider' })],
  ['nonmember recipient', fixture({ ideas: [idea({ recipientId: 'outsider' })] })],
  ['nonmember owner', fixture({ wishes: [wish({ ownerId: 'outsider' })] })],
  ['nonmember claimer', fixture({ wishes: [wish({ claimed: true, claimedById: 'outsider' })] })],
  ['duplicate member', fixture({ memberIds: ['giver', 'recipient', 'giver'] })],
  ['duplicate idea record', fixture({ ideas: [idea(), idea()] })],
  ['duplicate wish record', fixture({ wishes: [wish(), wish()] })],
  ['empty id', fixture({ ideas: [idea({ id: '' })] })],
  ['whitespace id', fixture({ ideas: [idea({ id: '  ' })] })],
  ['oversized id', fixture({ ideas: [idea({ id: 'x'.repeat(257) })] })],
  ['negative revision', fixture({ wishes: [wish({ revision: -1 })] })],
  ['fractional revision', fixture({ wishes: [wish({ revision: 1.5 })] })],
  ['unsafe revision', fixture({ wishes: [wish({ revision: Number.MAX_SAFE_INTEGER + 1 })] })],
  ['NaN revision', fixture({ ideas: [idea({ revision: NaN })] })],
  ['infinite revision', fixture({ ideas: [idea({ revision: Infinity })] })],
  ['string purchased flag', { ...fixture(), ideas: [{ ...idea(), purchased: 'true' }] }],
  ['number claimed flag', { ...fixture(), wishes: [{ ...wish(), claimed: 1 }] }],
  ['null crossedOff flag', { ...fixture(), wishes: [{ ...wish(), crossedOff: null }] }],
  ['undefined claimer', { ...fixture(), wishes: [{ ...wish(), claimedById: undefined }] }],
  ['extra idea text', { ...fixture(), ideas: [{ ...idea(), notes: 'PRIVATE_SENTINEL' }] }],
  ['extra root value', { ...fixture(), PRIVATE_SENTINEL: 'PRIVATE_SENTINEL' }],
  ['malformed binding', { ...fixture(), bindings: [null] }],
  ['sparse ideas', { ...fixture(), ideas: Array(2) }],
  ['too many members', fixture({ memberIds: Array(101).fill('synthetic-member') })],
  ['too many ideas', fixture({ ideas: Array(1001).fill(idea()) })],
  ['too many wishes', fixture({ wishes: Array(1001).fill(wish()) })],
  ['too many links', fixture({ bindings: Array(2001).fill({ ideaId: 'idea-a', wishId: 'wish-a' }) })],
  ['inherited envelope', Object.assign(Object.create({ inherited: true }), fixture())],
];
for (const [name, input] of invalidInputs) {
  test(`invalid contract rejects ${name} without partial transitions`, () => invalid(input));
}

test('invalid private text and unknown property names never appear in diagnostics', () => {
  const result = reconcileGiftWishes({ ...fixture(), ideas: [{ ...idea(), PRIVATE_SENTINEL: 'PRIVATE_SENTINEL' }] });
  assert.equal(result.status, 'invalid');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  assert.deepEqual(result.issues, [{ code: 'invalid_shape', path: '/ideas/0' }]);
});

test('data getters are rejected without invoking their side effects', () => {
  let read = false;
  const input = Object.defineProperty(fixture(), 'actorId', { get() { read = true; return 'giver'; } });
  invalid(input); assert.equal(read, false);
  const rows = Object.defineProperty([idea()], '0', { get() { read = true; return idea(); } });
  invalid({ ...fixture(), ideas: rows }); assert.equal(read, false);
});

test('symbol and extra array metadata are rejected rather than silently carried', () => {
  invalid({ ...fixture(), [Symbol('private')]: 'PRIVATE_SENTINEL' });
  invalid({ ...fixture(), wishes: Object.assign([wish()], { private: 'PRIVATE_SENTINEL' }) });
});

test('all output ordering is independent of source order and duplicate links', () => {
  const input = fixture({
    ideas: [idea({ id: 'idea-z' }), idea()], wishes: [wish({ id: 'wish-z' }), wish()],
    bindings: [{ ideaId: 'idea-z', wishId: 'wish-z' }, { ideaId: 'idea-a', wishId: 'wish-a' }],
  });
  const reversed = {
    ...input, memberIds: [...input.memberIds].reverse(), ideas: [...input.ideas].reverse(),
    wishes: [...input.wishes].reverse(), bindings: [...input.bindings].reverse().concat(input.bindings),
  };
  assert.equal(JSON.stringify(reconcileGiftWishes(input)), JSON.stringify(reconcileGiftWishes(reversed)));
});

test('prototype-like IDs remain ordinary explicit identities', () => {
  const input = fixture({ ideas: [idea({ id: '__proto__' })], wishes: [wish({ id: 'constructor' })],
    bindings: [{ ideaId: '__proto__', wishId: 'constructor' }] });
  const result = reconcileGiftWishes(input);
  assert.equal(result.status, 'ready');
  assert.deepEqual(JSON.parse(result.actions[0]?.operationId ?? ''), ['giver', '__proto__', 'constructor', 2, 7]);
});

test('tuple-encoded operation identities avoid delimiter collisions', () => {
  const first = fixture({ ideas: [idea({ id: 'a,b' })], wishes: [wish({ id: 'c' })],
    bindings: [{ ideaId: 'a,b', wishId: 'c' }] });
  const second = fixture({ ideas: [idea({ id: 'a' })], wishes: [wish({ id: 'b,c' })],
    bindings: [{ ideaId: 'a', wishId: 'b,c' }] });
  assert.notEqual(reconcileGiftWishes(first).actions[0]?.operationId, reconcileGiftWishes(second).actions[0]?.operationId);
});

test('owner sees exactly the same complete public projection before and after secret claim', () => {
  const input = fixture(); const next = reconcileGiftWishes(input).snapshot; assert.ok(next);
  const before = projectWishSnapshot({ viewerId: 'recipient', memberIds: input.memberIds, wishes: input.wishes });
  const after = projectWishSnapshot({ viewerId: 'recipient', memberIds: next.memberIds, wishes: next.wishes });
  assert.deepEqual(before, { status: 'ready', wishes: [{ id: 'wish-a', ownerId: 'recipient', crossedOff: false }], issues: [] });
  assert.deepEqual(after, before);
});

test('owner-secret values or missing fields cannot alter owner projection or diagnostics', () => {
  const base = { id: 'wish-a', ownerId: 'recipient', crossedOff: false };
  const expected = projectWishSnapshot({ viewerId: 'recipient', memberIds: fixture().memberIds, wishes: [base] });
  for (const secret of [
    {}, { claimed: true, claimedById: 'giver', revision: 8 },
    { claimed: 'PRIVATE_SENTINEL', claimedById: ['PRIVATE_SENTINEL'], revision: { secret: 'PRIVATE_SENTINEL' } },
  ]) {
    assert.deepEqual(projectWishSnapshot({ viewerId: 'recipient', memberIds: fixture().memberIds, wishes: [{ ...base, ...secret }] }), expected);
  }
});

test('other family viewers get only permitted claim metadata with no idea or revision fields', () => {
  const next = reconcileGiftWishes(fixture()).snapshot; assert.ok(next);
  const result = projectWishSnapshot(freeze({ viewerId: 'sibling', memberIds: next.memberIds, wishes: next.wishes }));
  assert.deepEqual(result, { status: 'ready', wishes: [
    { id: 'wish-a', ownerId: 'recipient', crossedOff: false, claimed: true, claimedById: 'giver' },
  ], issues: [] });
  for (const forbidden of ['revision', 'idea-a', 'bindings', 'actions', 'review', 'creatorId', 'purchased']) {
    assert.equal(JSON.stringify(result).includes(forbidden), false);
  }
});

test('one viewer hides their own claims while seeing other family claims in sorted order', () => {
  const result = projectWishSnapshot({ viewerId: 'recipient', memberIds: fixture().memberIds, wishes: [
    wish({ id: 'wish-z', ownerId: 'sibling', claimed: true, claimedById: 'giver' }),
    wish({ claimed: true, claimedById: 'sibling' }),
  ] });
  assert.deepEqual(result.wishes, [
    { id: 'wish-a', ownerId: 'recipient', crossedOff: false },
    { id: 'wish-z', ownerId: 'sibling', crossedOff: false, claimed: true, claimedById: 'giver' },
  ]);
});

test('nonmember viewer gets no wish IDs or creator metadata', () => {
  const result = projectWishSnapshot({ viewerId: 'outsider', memberIds: fixture().memberIds, wishes: [wish()] });
  assert.equal(result.status, 'invalid'); assert.deepEqual(result.wishes, []);
  assert.equal(JSON.stringify(result).includes('wish-a'), false);
  assert.equal(JSON.stringify(result).includes('outsider'), false);
});

test('projection rejects a complete creator-private snapshot instead of forwarding it', () => {
  const next = reconcileGiftWishes(fixture());
  assert.deepEqual(projectWishSnapshot(next), { status: 'invalid', wishes: [], issues: [{ code: 'invalid_shape', path: '/' }] });
  assert.equal(JSON.stringify(projectWishSnapshot(next)).includes('idea-a'), false);
});

test('projection rejects unknown fields without echoing private names or values', () => {
  const result = projectWishSnapshot({ viewerId: 'recipient', memberIds: fixture().memberIds,
    wishes: [{ ...wish(), PRIVATE_SENTINEL: 'PRIVATE_SENTINEL' }] });
  assert.equal(result.status, 'invalid'); assert.deepEqual(result.wishes, []);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
});

test('projection validates visible fields, nonowner claims and duplicate wish identities', () => {
  for (const wishes of [
    [wish(), wish()], [wish({ ownerId: 'outsider' })], [{ ...wish(), crossedOff: 'no' }],
    [{ ...wish(), claimedById: undefined }], [{ ...wish(), claimed: 1 }],
  ]) {
    const result = projectWishSnapshot({ viewerId: 'sibling', memberIds: fixture().memberIds, wishes });
    assert.equal(result.status, 'invalid'); assert.deepEqual(result.wishes, []);
  }
});
