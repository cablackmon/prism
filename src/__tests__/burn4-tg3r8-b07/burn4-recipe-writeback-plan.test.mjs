import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRecipeWriteback as plan, serializeRecipeWritebackPlan as serialize,
  RecipePlanInputError, RECIPE_PLAN_LIMITS } from '../../../scripts/burn4-recipe-writeback-plan.mjs';

/** @typedef {import('../../../scripts/burn4-recipe-writeback-plan.mjs').RecipeContent} RecipeContent */
/** @typedef {import('../../../scripts/burn4-recipe-writeback-plan.mjs').RecipeBinding} RecipeBinding */
/** @typedef {import('../../../scripts/burn4-recipe-writeback-plan.mjs').RecipePlanInput} RecipePlanInput */
/** @typedef {import('../../../scripts/burn4-recipe-writeback-plan.mjs').RecipeField} RecipeField */

/** @type {RecipeField[]} */
const fields = ['name', 'description', 'ingredients', 'instructions', 'prepMinutes',
  'cookMinutes', 'servings', 'cuisine', 'category', 'tags', 'sourceUrl'];

/** @param {Partial<RecipeContent>} [patch] @returns {RecipeContent} */
function content(patch = {}) {
  return { name: 'Garden Soup', description: null, ingredients: [{ heading: 'Soup' }, { text: '2 carrots' }],
    instructions: 'Chop carrots.\nSimmer gently.', prepMinutes: 10, cookMinutes: 20,
    servings: 4, cuisine: null, category: 'Soup', tags: ['garden', 'weeknight'], sourceUrl: null, ...patch };
}

/** @param {string} [id] @param {Partial<RecipeContent>} [localPatch] @param {Partial<RecipeContent>} [remotePatch] @returns {RecipeBinding} */
function pair(id = 'one', localPatch = {}, remotePatch = {}) {
  return { localId: `local-${id}`, remoteId: `remote-${id}`, baseline: content(),
    local: { status: 'present', revision: 'L1', content: content(localPatch) },
    remote: { status: 'present', revision: 'R1', content: content(remotePatch) } };
}

/** @param {RecipeBinding[]} [bindings] @returns {RecipePlanInput} */
function input(bindings = [pair()]) {
  return { schemaVersion: 1, source: { provider: 'tandoor', sourceId: 'synthetic-source' },
    snapshots: { localComplete: true, remoteComplete: true },
    policy: { remoteWritesEnabled: true, remoteWritableFields: [...fields], remoteDeletesEnabled: true,
      deletionBudget: { maxCount: 1000, maxFraction: 1 } }, bindings };
}

/** @param {string} id @param {'local'|'remote'} target @returns {RecipeBinding} */
function deletion(id, target) {
  const binding = pair(id);
  binding[target === 'local' ? 'remote' : 'local'] = { status: 'deleted', revision: 'tombstone-1' };
  return binding;
}

/** @param {unknown} value @param {string} code */
function rejects(value, code) {
  assert.throws(() => plan(value), error => error instanceof RecipePlanInputError && error.code === code && error.path.startsWith('$'));
}

/** @param {unknown} recipe */
function invalidContent(recipe) {
  return { ...input(), bindings: [{ ...pair(), local: { status: 'present', revision: 'L1', content: recipe } }] };
}

test('unchanged linked recipe has no operation and no finding', () => {
  const result = plan(input());
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.unchangedPairs, 1);
  assert.equal(result.summary.pairs, 1);
});

test('Prism edits create an exact remote patch with both revision preconditions', () => {
  const result = plan(input([pair('one', { name: 'Carrot Soup', prepMinutes: null })]));
  const op = result.operations[0]; assert.ok(op);
  assert.equal(op.kind, 'update_remote');
  assert.deepEqual(op.patch, { name: 'Carrot Soup', prepMinutes: null });
  assert.deepEqual(op.before, { name: 'Garden Soup', prepMinutes: 10 });
  assert.deepEqual(op.desired, content({ name: 'Carrot Soup', prepMinutes: null }));
  assert.equal(op.preconditions.local.revision, 'L1');
  assert.equal(op.preconditions.remote.revision, 'R1');
  assert.equal(op.preconditions.local.status, 'present');
  assert.match(op.preconditions.remote.contentHash ?? '', /^[a-f0-9]{64}$/);
  assert.notEqual(op.preconditions.local.contentHash, op.preconditions.remote.contentHash);
  assert.match(op.baselineHash, /^[a-f0-9]{64}$/);
  assert.equal(op.selectedByDefault, true);
  assert.equal(op.requiresExplicitApproval, false);
});

test('provider-only edit becomes a local patch even with remote writes disabled', () => {
  const data = input([pair('one', {}, { cookMinutes: 35 })]);
  data.policy.remoteWritesEnabled = false; data.policy.remoteWritableFields = [];
  const result = plan(data);
  assert.deepEqual(result.operations.map(op => [op.kind, op.patch]), [['update_local', { cookMinutes: 35 }]]);
});

test('independent local and remote edits merge in both directions', () => {
  const result = plan(input([pair('one', { description: 'From the garden' }, { servings: 6 })]));
  assert.deepEqual(result.operations.map(op => [op.kind, op.patch]), [
    ['update_local', { servings: 6 }], ['update_remote', { description: 'From the garden' }],
  ]);
  for (const op of result.operations) assert.deepEqual(op.desired, content({ description: 'From the garden', servings: 6 }));
});

test('same concurrent edit converges without an outbound capability', () => {
  const data = input([pair('one', { name: 'Shared Title' }, { name: 'Shared Title' })]);
  data.policy.remoteWritesEnabled = false; data.policy.remoteWritableFields = [];
  const result = plan(data);
  assert.deepEqual(result.operations, []); assert.deepEqual(result.findings, []);
  assert.equal(result.summary.convergedPairs, 1);
});

test('divergent field edits report base/local/remote and block the complete pair', () => {
  const result = plan(input([pair('one', { name: 'Local Soup', servings: 8 }, { name: 'Remote Soup' })]));
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.findings[0]?.details, { fields: [{ field: 'name', base: 'Garden Soup', local: 'Local Soup', remote: 'Remote Soup' }] });
  assert.equal(result.summary.conflictedPairs, 1);
});

test('conflicted pair does not prevent an independent safe recipe update', () => {
  const result = plan(input([pair('conflict', { name: 'A' }, { name: 'B' }), pair('safe', { servings: 8 })]));
  assert.deepEqual(result.operations.map(op => op.localId), ['local-safe']);
  assert.deepEqual(result.operations[0]?.patch, { servings: 8 });
  assert.equal(result.summary.conflictedPairs, 1);
});

test('ingredients preserve heading/text types and ordering in a remote patch', () => {
  const ingredients = [{ text: '2 carrots' }, { heading: 'Finish' }, { text: '1 tsp thyme' }];
  const result = plan(input([pair('one', { ingredients })]));
  assert.deepEqual(result.operations[0]?.patch, { ingredients });
  assert.equal(result.operations[0]?.kind, 'update_remote');
});

test('different concurrent ingredient arrays conflict atomically', () => {
  const result = plan(input([pair('one', { ingredients: [{ text: '3 carrots' }] }, { ingredients: [{ text: '4 carrots' }] })]));
  assert.equal(result.findings[0]?.reason, 'field_conflict');
  assert.deepEqual(result.operations, []);
});

test('instructions normalize CRLF while preserving other whitespace and line breaks', () => {
  const same = plan(input([pair('one', { instructions: 'Chop carrots.\r\nSimmer gently.' })]));
  assert.equal(same.summary.unchangedPairs, 1);
  const changed = plan(input([pair('one', { instructions: 'Chop carrots.\n\n  Simmer gently. ' })]));
  assert.deepEqual(changed.operations[0]?.patch, { instructions: 'Chop carrots.\n\n  Simmer gently. ' });
});

test('concurrent instruction edits are one atomic conflict', () => {
  const result = plan(input([pair('one', { instructions: 'Local step\nSecond step' }, { instructions: 'Remote step\nSecond step' })]));
  assert.deepEqual(result.operations, []); assert.equal(result.findings[0]?.reason, 'field_conflict');
});

test('tags are case-sensitive unordered sets with duplicate normalization', () => {
  assert.equal(plan(input([pair('one', { tags: ['weeknight', 'garden', 'garden'] })])).summary.unchangedPairs, 1);
  const result = plan(input([pair('one', { tags: ['Garden', 'garden'] })]));
  assert.deepEqual(result.operations[0]?.patch, { tags: ['Garden', 'garden'] });
});

test('unsupported outbound field blocks both directions for its pair', () => {
  const data = input([pair('one', { name: 'Changed' }, { servings: 8 })]);
  data.policy.remoteWritableFields = ['servings'];
  const result = plan(data);
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.findings[0]?.details, { fields: ['name'] });
  assert.equal(result.findings[0]?.reason, 'unsupported_remote_field');
});

test('remote write disabled blocks local write-back without affecting unrelated pulls', () => {
  const data = input([pair('push', { name: 'Changed' }), pair('pull', {}, { name: 'Provider Title' })]);
  data.policy.remoteWritesEnabled = false;
  const result = plan(data);
  assert.deepEqual(result.operations.map(op => op.kind), ['update_local']);
  assert.equal(result.findings[0]?.reason, 'remote_write_disabled');
});

test('missing common baseline refuses both directions and initial creation', () => {
  const binding = pair('new', { name: 'Local Title' }); binding.baseline = null;
  const result = plan(input([binding]));
  assert.deepEqual(result.operations, []); assert.equal(result.findings[0]?.reason, 'baseline_required');
});

for (const side of /** @type {const} */ (['local', 'remote'])) {
  test(`${side} unknown never implies deletion, recreation, or an update`, () => {
    const binding = pair(); binding[side] = { status: 'unknown' };
    const result = plan(input([binding]));
    assert.deepEqual(result.operations, []); assert.equal(result.findings[0]?.reason, 'snapshot_unknown');
    assert.equal(result.summary.deleteCandidates, 0);
  });
}

for (const target of /** @type {const} */ (['local', 'remote'])) {
  test(`explicit peer tombstone proposes opt-in delete_${target} with tombstone revision`, () => {
    const result = plan(input([deletion('gone', target)]));
    const op = result.operations[0]; assert.ok(op);
    assert.equal(op.kind, `delete_${target}`);
    assert.equal(op.preconditions[target].status, 'present');
    const peer = target === 'local' ? 'remote' : 'local';
    assert.deepEqual(op.preconditions[peer], { status: 'deleted', revision: 'tombstone-1', contentHash: null });
    assert.equal(op.patch, null); assert.equal(op.desired, null);
    assert.equal(op.selectedByDefault, false); assert.equal(op.requiresExplicitApproval, true);
    assert.equal(result.summary.deleteCandidates, 1);
  });
  test(`delete_${target} versus a surviving edit is a conflict without resurrection`, () => {
    const binding = deletion('gone', target);
    binding[target] = { status: 'present', revision: 'edited', content: content({ servings: 9 }) };
    const result = plan(input([binding]));
    assert.deepEqual(result.operations, []); assert.equal(result.findings[0]?.reason, 'delete_edit_conflict');
    assert.equal(result.summary.conflictedPairs, 1); assert.equal(result.summary.deleteCandidates, 0);
  });
  for (const side of /** @type {const} */ (['localComplete', 'remoteComplete'])) {
    test(`delete_${target} blocked by incomplete ${side}`, () => {
      const data = input([deletion('gone', target)]); data.snapshots[side] = false;
      const result = plan(data);
      assert.deepEqual(result.operations, []); assert.equal(result.findings[0]?.reason, 'incomplete_snapshot');
      assert.equal(result.summary.blockedDeleteCandidates, 1);
    });
  }
}

test('both explicit tombstones are already deleted without a new operation', () => {
  const binding = deletion('gone', 'local'); binding.local = { status: 'deleted', revision: 'L-deleted' };
  const result = plan(input([binding]));
  assert.deepEqual(result.operations, []); assert.equal(result.summary.alreadyDeletedPairs, 1);
});

test('an unknown entry blocks all source deletions while independent updates survive', () => {
  const unknown = pair('unknown'); unknown.remote = { status: 'unknown' };
  const result = plan(input([deletion('gone', 'local'), unknown, pair('safe', { name: 'Safe' })]));
  assert.deepEqual(result.operations.map(op => op.kind), ['update_remote']);
  assert.equal(result.findings.find(f => f.localId === 'local-gone')?.reason, 'source_snapshot_unknown');
});

for (const setting of /** @type {const} */ (['remoteDeletesEnabled', 'remoteWritesEnabled'])) {
  test(`remote deletion disabled by ${setting} cannot become a different operation`, () => {
    const data = input([deletion('gone', 'remote')]); data.policy[setting] = false;
    const result = plan(data);
    assert.deepEqual(result.operations, []); assert.equal(result.findings[0]?.reason, 'remote_delete_disabled');
  });
}

test('mass-delete count guard blocks the complete candidate group', () => {
  const data = input([deletion('a', 'local'), deletion('b', 'local'), pair('safe')]);
  data.policy.deletionBudget = { maxCount: 1, maxFraction: 1 };
  const result = plan(data);
  assert.deepEqual(result.operations, []);
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every(f => f.reason === 'mass_delete_guard'));
  assert.equal(result.summary.blockedDeleteCandidates, 2);
  assert.deepEqual(result.findings[0]?.details, { target: 'local', candidates: 2, denominator: 3, fraction: 2 / 3 });
});

test('mass-delete fraction guard permits its exact boundary and blocks just below', () => {
  const data = input([deletion('gone', 'remote'), pair('safe')]);
  data.policy.deletionBudget = { maxCount: 1, maxFraction: 0.5 };
  assert.equal(plan(data).operations[0]?.kind, 'delete_remote');
  data.policy.deletionBudget.maxFraction = 0.499;
  const result = plan(data);
  assert.deepEqual(result.operations, []); assert.equal(result.findings[0]?.reason, 'mass_delete_guard');
});

test('opposite targets have independent deletion denominators and budgets', () => {
  const data = input([deletion('remote-gone', 'local'), deletion('local-gone', 'remote'), pair('safe')]);
  data.policy.deletionBudget = { maxCount: 1, maxFraction: 0.5 };
  const result = plan(data);
  assert.deepEqual(result.operations.map(op => op.kind).sort(), ['delete_local', 'delete_remote']);
  assert.equal(result.summary.deleteLocal, 1); assert.equal(result.summary.deleteRemote, 1);
});

test('zero deletion budget prevents all candidates but accepts no-candidate empty input', () => {
  const data = input([deletion('gone', 'local')]); data.policy.deletionBudget = { maxCount: 0, maxFraction: 0 };
  assert.equal(plan(data).findings[0]?.reason, 'mass_delete_guard');
  const empty = input([]); empty.policy.deletionBudget = { maxCount: 0, maxFraction: 0 };
  const result = plan(empty);
  assert.deepEqual(result.operations, []); assert.deepEqual(result.findings, []);
  assert.equal(result.summary.pairs, 0); assert.equal(result.summary.deleteCandidates, 0);
});

test('canonical output and IDs survive input, property, tag, and policy-field permutation', () => {
  const data = input([pair('z', { name: 'Z' }), pair('a', { name: 'A', tags: ['x', 'garden'] })]);
  const permuted = structuredClone(data);
  permuted.bindings.reverse(); permuted.policy.remoteWritableFields.reverse();
  for (const binding of permuted.bindings) {
    if (binding.local.status === 'present') binding.local.content.tags.reverse();
    if (binding.remote.status === 'present') binding.remote.content = /** @type {RecipeContent} */ (Object.fromEntries(Object.entries(binding.remote.content).reverse()));
  }
  const reordered = Object.fromEntries(Object.entries(permuted).reverse());
  assert.equal(serialize(plan(reordered)), serialize(plan(data)));
  assert.deepEqual(plan(data).operations.map(op => op.localId), ['local-a', 'local-z']);
});

test('source/provider identity and either observed revision fence operation IDs', () => {
  const data = input([pair('one', { name: 'Changed' })]);
  const id = plan(data).operations[0]?.operationId;
  for (const variant of ['source', 'provider', 'localRevision', 'remoteRevision', 'content']) {
    const copy = structuredClone(data); const binding = copy.bindings[0]; assert.ok(binding);
    if (variant === 'source') copy.source.sourceId = 'second-synthetic-source';
    if (variant === 'provider') copy.source.provider = 'mealie';
    if (variant === 'localRevision' && binding.local.status !== 'unknown') binding.local.revision = 'L2';
    if (variant === 'remoteRevision' && binding.remote.status !== 'unknown') binding.remote.revision = 'R2';
    if (variant === 'content' && binding.local.status === 'present') binding.local.content.name = 'Another Title';
    assert.notEqual(plan(copy).operations[0]?.operationId, id, variant);
  }
});

test('opaque identity is never inferred from equal names or URLs', () => {
  const result = plan(input([pair('a', { name: 'Changed' }), pair('b', { name: 'Changed' })]));
  assert.equal(result.operations.length, 2);
  assert.notEqual(result.operations[0]?.operationId, result.operations[1]?.operationId);
  assert.deepEqual(result.operations.map(op => op.remoteId), ['remote-a', 'remote-b']);
});

test('operation ordering uses code-point identity comparison without locale rules', () => {
  const result = plan(input(['é', 'a', 'A'].map(id => pair(id, { servings: 5 }))));
  assert.deepEqual(result.operations.map(op => op.localId), ['local-A', 'local-a', 'local-é']);
});

test('repeat planning is idempotent and explicit successful reconciliation yields no operation', () => {
  const data = input([pair('one', { name: 'Merged' }, { servings: 6 })]);
  const first = plan(data); assert.equal(serialize(plan(data)), serialize(first));
  const desired = first.operations[0]?.desired; assert.ok(desired);
  const binding = data.bindings[0]; assert.ok(binding);
  binding.baseline = structuredClone(desired);
  binding.local = { status: 'present', revision: 'L2', content: structuredClone(desired) };
  binding.remote = { status: 'present', revision: 'R2', content: structuredClone(desired) };
  const result = plan(data);
  assert.deepEqual(result.operations, []); assert.equal(result.summary.unchangedPairs, 1);
});

test('frozen input remains unchanged and results do not alias caller-owned content', () => {
  const data = input([pair('one', { ingredients: [{ heading: 'Sauce' }, { text: '1 carrot' }] })]);
  const before = JSON.stringify(data);
  /** @param {unknown} value */
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(data);
  const result = plan(data);
  const desired = result.operations[0]?.desired; assert.ok(desired);
  desired.ingredients.push({ text: '1 onion' });
  assert.equal(JSON.stringify(data), before);
  assert.equal(plan(data).operations[0]?.desired?.ingredients.length, 2);
});

test('mixed plan summary separates operation counts, conflicts, blocks, and no-ops', () => {
  const converged = pair('converged', { name: 'Same' }, { name: 'Same' });
  const missing = pair('baseline'); missing.baseline = null;
  const unknown = pair('unknown'); unknown.local = { status: 'unknown' };
  const result = plan(input([pair('unchanged'), converged, pair('push', { servings: 7 }), pair('pull', {}, { servings: 8 }),
    pair('conflict', { name: 'A' }, { name: 'B' }), missing, unknown, deletion('gone', 'local')]));
  assert.deepEqual(result.summary, { pairs: 8, unchangedPairs: 1, convergedPairs: 1, alreadyDeletedPairs: 0,
    conflictedPairs: 1, blockedPairs: 3, updateLocal: 1, updateRemote: 1,
    deleteCandidates: 1, deleteLocal: 0, deleteRemote: 0, blockedDeleteCandidates: 1 });
});

/** @type {{name:string, value:()=>unknown, code:string}[]} */
const invalidCases = [
  { name: 'unknown version', value: () => ({ ...input(), schemaVersion: 2 }), code: 'version' },
  { name: 'unknown provider', value: () => ({ ...input(), source: { provider: 'other', sourceId: 'x' } }), code: 'provider' },
  { name: 'unknown top key', value: () => ({ ...input(), extra: true }), code: 'keys' },
  { name: 'missing source identity', value: () => ({ ...input(), source: { provider: 'tandoor' } }), code: 'keys' },
  { name: 'empty source identity', value: () => ({ ...input(), source: { provider: 'tandoor', sourceId: ' ' } }), code: 'string' },
  { name: 'overlong source identity', value: () => ({ ...input(), source: { provider: 'tandoor', sourceId: 'x'.repeat(257) } }), code: 'limit' },
  { name: 'duplicate local binding', value: () => input([pair(), { ...pair('two'), localId: 'local-one' }]), code: 'duplicate_identity' },
  { name: 'duplicate remote binding', value: () => input([pair(), { ...pair('two'), remoteId: 'remote-one' }]), code: 'duplicate_identity' },
  { name: 'unsupported policy field', value: () => ({ ...input(), policy: { ...input().policy, remoteWritableFields: ['image'] } }), code: 'field' },
  { name: 'duplicate policy field', value: () => ({ ...input(), policy: { ...input().policy, remoteWritableFields: ['name', 'name'] } }), code: 'duplicate' },
  { name: 'nonboolean capability', value: () => ({ ...input(), policy: { ...input().policy, remoteWritesEnabled: 1 } }), code: 'boolean' },
  { name: 'nonboolean completeness', value: () => ({ ...input(), snapshots: { localComplete: null, remoteComplete: true } }), code: 'boolean' },
  { name: 'fraction above one', value: () => ({ ...input(), policy: { ...input().policy, deletionBudget: { maxCount: 1, maxFraction: 1.1 } } }), code: 'number' },
  { name: 'negative delete count', value: () => ({ ...input(), policy: { ...input().policy, deletionBudget: { maxCount: -1, maxFraction: 1 } } }), code: 'number' },
  { name: 'fractional delete count', value: () => ({ ...input(), policy: { ...input().policy, deletionBudget: { maxCount: 1.5, maxFraction: 1 } } }), code: 'number' },
  { name: 'unknown recipe field', value: () => invalidContent({ ...content(), favorite: true }), code: 'keys' },
  { name: 'omitted recipe field', value: () => { const { sourceUrl: omitted, ...rest } = content(); assert.equal(omitted, null); return invalidContent(rest); }, code: 'keys' },
  { name: 'empty required name', value: () => invalidContent(content({ name: ' ' })), code: 'string' },
  { name: 'negative minutes', value: () => invalidContent(content({ prepMinutes: -1 })), code: 'number' },
  { name: 'fractional minutes', value: () => invalidContent(content({ cookMinutes: 1.5 })), code: 'number' },
  { name: 'nonfinite servings', value: () => invalidContent(content({ servings: Infinity })), code: 'number' },
  { name: 'zero servings', value: () => invalidContent(content({ servings: 0 })), code: 'positive' },
  { name: 'nonstring nullable field', value: () => invalidContent({ ...content(), cuisine: 12 }), code: 'string' },
  { name: 'ingredient with both entry types', value: () => invalidContent({ ...content(), ingredients: [{ text: 'x', heading: 'y' }] }), code: 'ingredient' },
  { name: 'empty ingredient text', value: () => invalidContent(content({ ingredients: [{ text: '' }] })), code: 'string' },
  { name: 'empty tag', value: () => invalidContent(content({ tags: [''] })), code: 'string' },
  { name: 'overlong text', value: () => invalidContent(content({ instructions: 'x'.repeat(RECIPE_PLAN_LIMITS.text + 1) })), code: 'limit' },
  { name: 'too many ingredients', value: () => invalidContent(content({ ingredients: Array.from({ length: 501 }, () => ({ text: 'x' })) })), code: 'limit' },
  { name: 'too many tags', value: () => invalidContent(content({ tags: Array.from({ length: 129 }, () => 'x') })), code: 'limit' },
  { name: 'too many bindings', value: () => input(Array.from({ length: 1001 }, (_, i) => pair(String(i)))), code: 'limit' },
  { name: 'unknown state discriminant', value: () => ({ ...input(), bindings: [{ ...pair(), local: { status: 'absent' } }] }), code: 'state_status' },
  { name: 'missing current revision', value: () => ({ ...input(), bindings: [{ ...pair(), remote: { status: 'deleted' } }] }), code: 'keys' },
  { name: 'empty tombstone revision', value: () => ({ ...input(), bindings: [{ ...pair(), remote: { status: 'deleted', revision: '' } }] }), code: 'string' },
  { name: 'unknown state with hidden content', value: () => ({ ...input(), bindings: [{ ...pair(), remote: { status: 'unknown', content: content() } }] }), code: 'keys' },
  { name: 'missing baseline property', value: () => { const { baseline: omitted, ...rest } = pair(); assert.ok(omitted); return { ...input(), bindings: [rest] }; }, code: 'keys' },
  { name: 'class object', value: () => { class NotJson { schemaVersion = 1; } return new NotJson(); }, code: 'prototype' },
  { name: 'function object', value: () => () => input(), code: 'record' },
  { name: 'symbol key', value: () => ({ ...input(), [Symbol('extra')]: true }), code: 'keys' },
  { name: 'special JSON property', value: () => invalidContent({ ...content(), ...JSON.parse('{"__proto__":{"polluted":true}}') }), code: 'keys' },
  { name: 'array subclass', value: () => { class NotJson extends Array {} return { ...input(), bindings: new NotJson() }; }, code: 'array' },
  { name: 'sparse array', value: () => ({ ...input(), bindings: new Array(1) }), code: 'array_keys' },
  { name: 'NaN numeric field', value: () => invalidContent(content({ servings: NaN })), code: 'number' },
  { name: 'cyclic field value', value: () => { const data = /** @type {Record<string,unknown>} */ ({ ...content() }); data.instructions = data; return invalidContent(data); }, code: 'string' },
];

for (const entry of invalidCases) test(`schema rejects ${entry.name}`, () => rejects(entry.value(), entry.code));

test('descriptor validation rejects top-level, state, recipe, and array getters without calling them', () => {
  let called = 0;
  const top = input(); Object.defineProperty(top, 'source', { enumerable: true, get() { called++; return {}; } });
  rejects(top, 'data_property');
  const stateInput = input(); const binding = stateInput.bindings[0]; assert.ok(binding);
  Object.defineProperty(binding.local, 'status', { enumerable: true, get() { called++; return 'present'; } });
  rejects(stateInput, 'state_status');
  const recipeInput = input(); const recipeBinding = recipeInput.bindings[0]; assert.ok(recipeBinding);
  assert.equal(recipeBinding.local.status, 'present');
  if (recipeBinding.local.status === 'present') Object.defineProperty(recipeBinding.local.content, 'name', { enumerable: true, get() { called++; return 'Title'; } });
  rejects(recipeInput, 'data_property');
  const arrayInput = input(); Object.defineProperty(arrayInput.bindings, '0', { enumerable: true, get() { called++; return pair(); } });
  rejects(arrayInput, 'array_data');
  assert.equal(called, 0);
});

test('aggregate text budget is enforced across all baseline and current recipes', () => {
  const text = 'x'.repeat(RECIPE_PLAN_LIMITS.text);
  const bindings = Array.from({ length: 24 }, (_, i) => {
    const binding = pair(String(i), { description: text }, { description: text });
    binding.baseline = content({ description: text }); return binding;
  });
  rejects(input(bindings), 'total_text_limit');
});

test('null-prototype JSON records and special opaque identity strings remain safe', () => {
  const data = Object.assign(Object.create(null), input([pair('__proto__', { name: 'Changed' }), pair('constructor', { name: 'Other' })]));
  const result = plan(data);
  assert.equal(result.operations.length, 2);
  assert.deepEqual(result.operations.map(op => op.localId), ['local-__proto__', 'local-constructor']);
  assert.equal(Object.prototype.hasOwnProperty.call({}, 'polluted'), false);
});

test('fractional servings, empty optional text, null times, and empty ingredient lists are explicit values', () => {
  const result = plan(input([pair('one', { servings: 1.5, description: '', prepMinutes: null, cookMinutes: null, ingredients: [] })]));
  assert.deepEqual(result.operations[0]?.patch, { description: '', ingredients: [], prepMinutes: null, cookMinutes: null, servings: 1.5 });
});

test('all managed recipe fields can participate in a concrete outbound patch', () => {
  const changed = content({ name: 'Herb Soup', description: 'A light broth', ingredients: [{ text: '1 carrot' }],
    instructions: 'Simmer.\nServe.', prepMinutes: 5, cookMinutes: 15, servings: 2, cuisine: 'Fictional',
    category: 'Main', tags: ['herbs'], sourceUrl: 'https://recipes.example.test/soup' });
  const result = plan(input([pair('one', changed)]));
  assert.deepEqual(result.operations[0]?.patch, changed);
  assert.deepEqual(Object.keys(result.operations[0]?.patch ?? {}), fields);
  assert.equal(result.operations[0]?.kind, 'update_remote');
});
