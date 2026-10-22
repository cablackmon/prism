// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileGiftWishes } from '../../../scripts/burn4-gift-wish-reconcile.mjs';
import { fixture, freeze, idea, wish } from './burn4-gift-wish-fixtures.mjs';

test('purchased confirmed link updates a fresh immutable snapshot and emits exact CAS intent', () => {
  const input = freeze(fixture()); const before = fixture();
  const result = reconcileGiftWishes(input);
  assert.deepEqual(result, {
    status: 'ready',
    snapshot: fixture({ wishes: [wish({ claimed: true, claimedById: 'giver', revision: 8 })] }),
    actions: [{
      operationId: '["giver","idea-a","wish-a",2,7]', ideaId: 'idea-a', wishId: 'wish-a',
      expectedIdea: idea(), expectedWish: wish(),
      changes: { claimed: true, claimedById: 'giver', revision: 8 },
    }], noops: [], review: [], issues: [],
  });
  assert.deepEqual(input, before);
  assert.notEqual(result.snapshot, input);
  assert.ok(result.snapshot);
  assert.notEqual(result.snapshot.ideas, input.ideas);
  assert.notEqual(result.snapshot.ideas[0], input.ideas[0]);
  assert.notEqual(result.snapshot.wishes[0], input.wishes[0]);
  assert.notEqual(result.snapshot.bindings[0], input.bindings[0]);
});

test('returned snapshot directly replays without a second mutation or revision increment', () => {
  const first = reconcileGiftWishes(fixture()); assert.ok(first.snapshot);
  const second = reconcileGiftWishes(freeze(first.snapshot));
  assert.deepEqual(second.snapshot, first.snapshot);
  assert.deepEqual(second.actions, []);
  assert.deepEqual(second.noops, [{ ideaId: 'idea-a', wishId: 'wish-a', code: 'already_claimed_by_actor' }]);
  assert.equal(second.status, 'ready');
});

test('same snapshot always returns the same complete transition', () => {
  const input = fixture();
  assert.deepEqual(reconcileGiftWishes(input), reconcileGiftWishes(input));
});

test('unpurchased ideas never claim or reverse an existing actor claim', () => {
  for (const current of [wish(), wish({ claimed: true, claimedById: 'giver' })]) {
    const input = fixture({ ideas: [idea({ purchased: false })], wishes: [current] });
    const result = reconcileGiftWishes(input);
    assert.deepEqual(result.snapshot, input);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.noops, [{ ideaId: 'idea-a', wishId: 'wish-a', code: 'not_purchased' }]);
  }
});

test('identical duplicate bindings collapse into one canonical link and one action', () => {
  const single = reconcileGiftWishes(fixture());
  assert.deepEqual(reconcileGiftWishes(fixture({ bindings: [
    { ideaId: 'idea-a', wishId: 'wish-a' }, { ideaId: 'idea-a', wishId: 'wish-a' },
  ] })), single);
});

test('one-to-many binding holds the full component while independent purchase succeeds', () => {
  const input = fixture({
    ideas: [idea(), idea({ id: 'idea-b' })],
    wishes: [wish(), wish({ id: 'wish-b' }), wish({ id: 'wish-c' })],
    bindings: [
      { ideaId: 'idea-a', wishId: 'wish-a' }, { ideaId: 'idea-a', wishId: 'wish-b' },
      { ideaId: 'idea-b', wishId: 'wish-c' },
    ],
  });
  const result = reconcileGiftWishes(input); assert.ok(result.snapshot);
  assert.equal(result.status, 'review_required');
  assert.deepEqual(result.review, [
    { ideaId: 'idea-a', wishId: 'wish-a', code: 'ambiguous_binding' },
    { ideaId: 'idea-a', wishId: 'wish-b', code: 'ambiguous_binding' },
  ]);
  assert.deepEqual(result.actions.map(row => row.wishId), ['wish-c']);
  assert.deepEqual(result.snapshot.wishes, [wish(), wish({ id: 'wish-b' }),
    wish({ id: 'wish-c', claimed: true, claimedById: 'giver', revision: 8 })]);
});

test('many purchased ideas targeting one wish cannot silently choose a winner', () => {
  const input = fixture({ ideas: [idea(), idea({ id: 'idea-b' })], bindings: [
    { ideaId: 'idea-a', wishId: 'wish-a' }, { ideaId: 'idea-b', wishId: 'wish-a' },
  ] });
  const result = reconcileGiftWishes(input);
  assert.deepEqual(result.snapshot, input);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.review.map(row => row.code), ['ambiguous_binding', 'ambiguous_binding']);
});

test('missing reference blocks every binding in its connected component', () => {
  const input = fixture({ ideas: [idea(), idea({ id: 'idea-b' })], bindings: [
    { ideaId: 'idea-a', wishId: 'missing-wish' }, { ideaId: 'idea-a', wishId: 'wish-a' },
    { ideaId: 'idea-b', wishId: 'wish-a' },
  ] });
  const result = reconcileGiftWishes(input);
  assert.deepEqual(result.actions, []);
  assert.equal(result.review.length, 3);
  assert.ok(result.review.every(row => row.code === 'missing_reference'));
  assert.deepEqual(result.snapshot?.wishes, [wish()]);
});

test('missing idea reference is reviewed without pretending the wish is claimed', () => {
  const result = reconcileGiftWishes(fixture({ ideas: [], bindings: [{ ideaId: 'missing', wishId: 'wish-a' }] }));
  assert.deepEqual(result.review, [{ ideaId: 'missing', wishId: 'wish-a', code: 'missing_reference' }]);
  assert.deepEqual(result.snapshot?.wishes, [wish()]);
});

test('confirmed link cannot claim a different recipient wish', () => {
  const input = fixture({ wishes: [wish({ ownerId: 'sibling' })] });
  const result = reconcileGiftWishes(input);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.snapshot, input);
  assert.deepEqual(result.review, [{ ideaId: 'idea-a', wishId: 'wish-a', code: 'recipient_mismatch' }]);
});

test('unlinked ideas produce review with no guessed matching', () => {
  const result = reconcileGiftWishes(fixture({ bindings: [] }));
  assert.deepEqual(result.review, [{ ideaId: 'idea-a', wishId: null, code: 'unlinked' }]);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.snapshot?.wishes, [wish()]);
});

/** @type {[string, Partial<import('../../../scripts/burn4-gift-wish-reconcile.mjs').Wish>][]} */
const conflicts = [
  ['claimed_by_other', { claimed: true, claimedById: 'sibling' }],
  ['unknown_claimer', { claimed: true, claimedById: null }],
  ['inconsistent_claim', { claimed: false, claimedById: 'giver' }],
  ['inconsistent_claim', { claimed: true, claimedById: 'recipient' }],
  ['wish_crossed_off', { crossedOff: true }],
  ['inconsistent_claim', { claimed: true, claimedById: 'giver', crossedOff: true }],
  ['revision_exhausted', { revision: Number.MAX_SAFE_INTEGER }],
];
for (const [index, [code, state]] of conflicts.entries()) {
  test(`claim conflict ${index + 1}: ${code} preserves local state`, () => {
    const input = fixture({ wishes: [wish(state)] });
    const result = reconcileGiftWishes(freeze(input));
    assert.equal(result.status, 'review_required');
    assert.deepEqual(result.snapshot, input);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.review, [{ ideaId: 'idea-a', wishId: 'wish-a', code }]);
  });
}

test('existing actor claim is retained even at exhausted revision', () => {
  const input = fixture({ wishes: [wish({ claimed: true, claimedById: 'giver', revision: Number.MAX_SAFE_INTEGER })] });
  const result = reconcileGiftWishes(input);
  assert.deepEqual(result.snapshot, input);
  assert.deepEqual(result.actions, []);
  assert.equal(result.noops[0]?.code, 'already_claimed_by_actor');
});

test('CAS intent includes both old record versions and all purchase and claim preconditions', () => {
  const result = reconcileGiftWishes(fixture()); const action = result.actions[0]; assert.ok(action);
  assert.deepEqual(action.expectedIdea, idea());
  assert.deepEqual(action.expectedWish, wish());
  assert.notDeepEqual(action.expectedIdea, idea({ purchased: false }));
  assert.notDeepEqual(action.expectedIdea, idea({ revision: 3 }));
  assert.notDeepEqual(action.expectedWish, wish({ revision: 8 }));
  assert.notDeepEqual(action.expectedWish, wish({ claimed: true, claimedById: 'sibling' }));
  assert.notDeepEqual(action.expectedWish, wish({ crossedOff: true }));
});

test('fresh explicit unclaim can be locally reclaimed under documented snapshot-only policy', () => {
  const first = reconcileGiftWishes(fixture());
  const later = reconcileGiftWishes(fixture({ wishes: [wish({ revision: 9 })] }));
  assert.equal(later.snapshot?.wishes[0]?.revision, 10);
  assert.notEqual(first.actions[0]?.operationId, later.actions[0]?.operationId);
});

test('unrelated wishes and retained purchased ideas survive local reconciliation', () => {
  const input = fixture({ wishes: [wish(), wish({ id: 'wish-z', ownerId: 'sibling', crossedOff: true })] });
  const result = reconcileGiftWishes(input); assert.ok(result.snapshot);
  assert.deepEqual(result.snapshot.wishes[1], input.wishes[1]);
  assert.deepEqual(result.snapshot.ideas, input.ideas);
  assert.ok(result.snapshot.ideas[0]);
  result.snapshot.ideas[0].purchased = false;
  assert.equal(input.ideas[0]?.purchased, true);
});

test('empty explicit collections are valid and stable', () => {
  const input = fixture({ ideas: [], wishes: [], bindings: [] });
  assert.deepEqual(reconcileGiftWishes(input), {
    status: 'ready', snapshot: input, actions: [], noops: [], review: [], issues: [],
  });
});
