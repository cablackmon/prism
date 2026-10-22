# Immutable gift/wish reconciliation

`scripts/burn4-gift-wish-reconcile.mjs` exports two pure functions and imports no application code. All inputs are explicit JSON-compatible synthetic snapshots. There is no CLI, filesystem access, ambient identity, clock, environment access, provider, network or database call.

Written backlog: `docs/planning.md:75` and `docs/features/WISHES.md:184-186` describe purchased Gift Ideas auto-claiming matching wishes as future work. The secrecy requirements are `WISHES.md:44-46,55,81,100-106,147-154`. Purchased ideas remain present (`112-114`). Existing application routes, hooks, UI, adapters and tests are outside this package.

## Local transition

```js
import { reconcileGiftWishes, projectWishSnapshot } from './scripts/burn4-gift-wish-reconcile.mjs';

const input = {
  actorId: 'giver', memberIds: ['giver', 'recipient', 'sibling'],
  ideas: [{ id: 'idea-a', creatorId: 'giver', recipientId: 'recipient', purchased: true, revision: 2 }],
  wishes: [{ id: 'wish-a', ownerId: 'recipient', claimed: false, claimedById: null, crossedOff: false, revision: 7 }],
  bindings: [{ ideaId: 'idea-a', wishId: 'wish-a' }],
};
const privateResult = reconcileGiftWishes(input);
// privateResult.snapshot.wishes[0] is claimed by giver at local revision 8.
// Input is unchanged. Reconcile the returned snapshot to get zero new actions.
const ownerView = projectWishSnapshot({
  viewerId: 'recipient', memberIds: input.memberIds,
  wishes: privateResult.snapshot.wishes,
});
// ownerView contains only wish-a's id, ownerId and crossedOff, exactly as before.
```

The complete reconciliation result is creator-private and must never be sent to recipients or external sync. It includes a newly allocated canonical snapshot, CAS intents, noops, review reasons and validation issues. Invalid envelopes return a null snapshot and zero partial actions. A result with review conflicts still applies unrelated eligible components in the returned local snapshot. Only the projection output is suitable for the specified family viewer.

These are explicit design choices, not inferred existing product policy:

- Caller-confirmed exact ID bindings only. Names, URLs, notes, prices and other keys are rejected. Duplicate identical bindings collapse. Distinct one-to-many or many-to-one bindings hold their whole connected component. Missing references also hold the connected component. Recipient must equal wish owner.
- Every idea belongs to the explicit actor and targets another listed member. Reconciliation takes only other members' wishes, so the actor's own secret claims are not required. Roster equality is input consistency, not authentication or RLS.
- Purchased, unclaimed, not-crossed-off wishes become claimed by actor and increment their explicit non-negative safe-integer revision. CAS intents contain both original records, all purchase/claim preconditions, and desired claim/revision changes. Existing actor claims are noops. Another/unknown claimer, inconsistent flags, crossed-off wishes and revision exhaustion require review and retain their state.
- Unpurchased ideas never claim or unclaim. Purchased ideas are retained. No binding produces an `unlinked` review reason. After an intentional unclaim, a new eligible explicit snapshot can be reclaimed while its idea remains purchased; user-intent history is outside this interface.
- Output uses code-point ordering, tuple-encoded operation IDs and deduplicated bindings. The same snapshot returns identical output. Refeeding the returned snapshot changes no further wish state and emits no further CAS intents.
- A snapshot has at most 100 unique member IDs, 1,000 ideas, 1,000 wishes and 2,000 binding rows. IDs are nonempty strings of at most 256 characters. Revisions are non-negative safe integers. Plain records/data properties and dense arrays only. Diagnostics emit schema paths and codes without unknown key names or supplied values.

## Family viewer projection

`projectWishSnapshot({ viewerId, memberIds, wishes })` is a separate strict interface. Never pass the full private result into it or into a family response. It returns `{ status, wishes, issues }` and never includes ideas, purchase flags, bindings, operation IDs, private review counts or revisions.

The wish owner sees `{ id, ownerId, crossedOff }`. The owner-secret claim/revision values are not inspected or required, so changing or removing them cannot affect the owner's view, status or diagnostics. Other listed family viewers also see `claimed` and `claimedById`, as permitted by the written requirements. A successful secret claim produces deeply equal before/after owner projections. Nonmember viewers and invalid visible/envelope fields get no wish output. This family view does not authorize public Internet publication or external sync.

## Limits and decisions

No known unchanged-source defect is claimed: KNOWN GAP list is empty. Scope limits: no app/API/UI trigger, authentication, database adapter, provider sync, text matching or persisted mutation. Revisions and roster truth are caller-supplied; this module's local integer convention does not establish a production database schema or transaction. A future trusted adapter must atomically recheck both source records before persisting CAS intents, and must discard/reconcile stale results. Exactly-once persistence is not claimed.

Needs decision before adoption: how the giver confirms links; which trusted layer supplies actor-scoped records and maps local revision conventions; how persisted atomicity and intentional unclaim history are handled. The upstream end-user auto-claim feature remains unfinished until that integration exists.

## Focused offline verification

Only own runtime/tests/fixtures are loaded. Tests assert actual state transitions, exact preconditions, retained records, frozen-input immutability, direct replay, component isolation, invalid-input privacy and recipient projection equality. No expected-failure cases excuse defects in this new implementation.

```sh
timeout 60s node --test --test-reporter=tap --test-concurrency=1 src/__tests__/burn4-tg3r8-b04/burn4-gift-wish-reconcile.test.mjs src/__tests__/burn4-tg3r8-b04/burn4-gift-wish-contract.test.mjs
timeout 60s node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r8-b04/burn4-tsconfig.json --noEmit
timeout 60s node node_modules/eslint/bin/eslint.js --no-config-lookup --no-ignore --config src/__tests__/burn4-tg3r8-b04/burn4-eslint.config.mjs --max-warnings 0 scripts/burn4-gift-wish-reconcile.mjs src/__tests__/burn4-tg3r8-b04/burn4-gift-wish-reconcile.test.mjs src/__tests__/burn4-tg3r8-b04/burn4-gift-wish-contract.test.mjs src/__tests__/burn4-tg3r8-b04/burn4-gift-wish-fixtures.mjs src/__tests__/burn4-tg3r8-b04/burn4-eslint.config.mjs
```

The owned tsconfig uses strict checkJs/JSDoc, noUncheckedIndexedAccess, Node types and an explicit runtime/test/fixture file list, with no root extends. ESLint uses its own config and zero-warning limit. No root Jest/TypeScript/ESLint config, full test suite or root build is run.
