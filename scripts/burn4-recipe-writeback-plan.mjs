import { createHash } from 'node:crypto';

/**
 * Offline preflight for docs/planning.md:14,30 and features/RECIPES.md:13-22,85-88.
 * Caller supplies normalized linked recipes and a common approved baseline.
 * Output is a review plan, never a provider payload or an applied mutation.
 * No initial linking/creation, images, personal metadata, baseline persistence,
 * provider transport/encoding, or remote atomic-apply guarantee is implemented.
 */

/** @typedef {'name'|'description'|'ingredients'|'instructions'|'prepMinutes'|'cookMinutes'|'servings'|'cuisine'|'category'|'tags'|'sourceUrl'} RecipeField */
/** @typedef {{text:string, heading?:never}|{heading:string, text?:never}} Ingredient */
/** @typedef {{name:string, description:string|null, ingredients:Ingredient[], instructions:string, prepMinutes:number|null, cookMinutes:number|null, servings:number|null, cuisine:string|null, category:string|null, tags:string[], sourceUrl:string|null}} RecipeContent */
/** @typedef {{status:'present', revision:string, content:RecipeContent}|{status:'deleted', revision:string}|{status:'unknown'}} RecipeState */
/** @typedef {{localId:string, remoteId:string, baseline:RecipeContent|null, local:RecipeState, remote:RecipeState}} RecipeBinding */
/** @typedef {{provider:'tandoor'|'mealie', sourceId:string}} RecipeSource */
/** @typedef {{schemaVersion:1, source:RecipeSource, snapshots:{localComplete:boolean, remoteComplete:boolean}, policy:{remoteWritesEnabled:boolean, remoteWritableFields:RecipeField[], remoteDeletesEnabled:boolean, deletionBudget:{maxCount:number, maxFraction:number}}, bindings:RecipeBinding[]}} RecipePlanInput */
/** @typedef {{status:'present'|'deleted', revision:string, contentHash:string|null}} Observation */
/** @typedef {'update_local'|'update_remote'|'delete_local'|'delete_remote'} OperationKind */
/** @typedef {{operationId:string, kind:OperationKind, source:RecipeSource, localId:string, remoteId:string, baselineHash:string, preconditions:{local:Observation, remote:Observation}, patch:Partial<RecipeContent>|null, before:Partial<RecipeContent>|null, desired:RecipeContent|null, selectedByDefault:boolean, requiresExplicitApproval:boolean}} RecipeOperation */
/** @typedef {{field:RecipeField, base:RecipeContent[RecipeField], local:RecipeContent[RecipeField], remote:RecipeContent[RecipeField]}} RecipeConflict */
/** @typedef {null|{fields:RecipeField[]|RecipeConflict[]}|{deletedSide:'local'|'remote'}|{target:'local'|'remote', candidates:number, denominator:number, fraction:number}} FindingDetails */
/** @typedef {{localId:string, remoteId:string, reason:string, details:FindingDetails}} RecipeFinding */
/** @typedef {{pairs:number, unchangedPairs:number, convergedPairs:number, alreadyDeletedPairs:number, conflictedPairs:number, blockedPairs:number, updateLocal:number, updateRemote:number, deleteCandidates:number, deleteLocal:number, deleteRemote:number, blockedDeleteCandidates:number}} RecipeSummary */
/** @typedef {{schemaVersion:1, source:RecipeSource, operations:RecipeOperation[], findings:RecipeFinding[], summary:RecipeSummary}} RecipeWritebackPlan */

/** @type {readonly RecipeField[]} */
const FIELDS = Object.freeze(['name', 'description', 'ingredients', 'instructions',
  'prepMinutes', 'cookMinutes', 'servings', 'cuisine', 'category', 'tags', 'sourceUrl']);
/** @type {readonly OperationKind[]} */
const KINDS = ['update_local', 'update_remote', 'delete_local', 'delete_remote'];

export const RECIPE_PLAN_LIMITS = Object.freeze({
  bindings: 1000, ingredients: 500, tags: 128, text: 65536, identity: 256,
  totalText: 4194304,
});

export class RecipePlanInputError extends TypeError {
  /** @param {string} path @param {string} code */
  constructor(path, code) {
    super(`Invalid recipe plan input at ${path}: ${code}`);
    this.name = 'RecipePlanInputError';
    this.path = path;
    this.code = code;
  }
}

/** @param {string} path @param {string} code @returns {never} */
function invalid(path, code) { throw new RecipePlanInputError(path, code); }

/** Validate descriptors before reading values. Never invoke ordinary getters.
 * @param {unknown} value @param {string} path @param {readonly string[]} keys
 * @returns {Record<string,unknown>}
 */
function record(value, path, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'record');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path, 'prototype');
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) invalid(path, 'keys');
  /** @type {Record<string,unknown>} */
  const copy = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid(path, 'data_property');
    copy[key] = /** @type {unknown} */ (descriptor.value);
  }
  return copy;
}

/** @param {unknown} value @param {string} path @param {number} max @returns {unknown[]} */
function array(value, path, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid(path, 'array');
  if (value.length > max) invalid(path, 'limit');
  if (Reflect.ownKeys(value).length !== value.length + 1) invalid(path, 'array_keys');
  /** @type {unknown[]} */
  const copy = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid(path, 'array_data');
    copy.push(/** @type {unknown} */ (descriptor.value));
  }
  return copy;
}

/** @param {unknown} value @param {string} path @returns {boolean} */
function boolean(value, path) {
  if (typeof value !== 'boolean') invalid(path, 'boolean');
  return value;
}

/** @typedef {{remaining:number}} TextBudget */
/** @param {unknown} value @param {string} path @param {TextBudget} budget @param {boolean} [nonempty] @param {number} [max] @returns {string} */
function string(value, path, budget, nonempty = false, max = RECIPE_PLAN_LIMITS.text) {
  if (typeof value !== 'string' || (nonempty && !value.trim())) invalid(path, 'string');
  if (value.length > max) invalid(path, 'limit');
  budget.remaining -= value.length;
  if (budget.remaining < 0) invalid(path, 'total_text_limit');
  return value;
}

/** @param {unknown} value @param {string} path @param {number} min @param {number} max @param {boolean} integer @returns {number} */
function number(value, path, min, max, integer) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(path, 'number');
  return Object.is(value, -0) ? 0 : value;
}

/** @param {string} left @param {string} right */
function compare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

/** @param {unknown} value @param {string} path @param {TextBudget} budget @returns {RecipeContent} */
function recipe(value, path, budget) {
  const data = record(value, path, FIELDS);
  /** @param {RecipeField} field */
  const optionalString = field => data[field] === null ? null : string(data[field], `${path}.${field}`, budget);
  /** @param {'prepMinutes'|'cookMinutes'|'servings'} field */
  const quantity = field => {
    if (data[field] === null) return null;
    const result = number(data[field], `${path}.${field}`, 0, Number.MAX_SAFE_INTEGER, field !== 'servings');
    if (field === 'servings' && result === 0) invalid(`${path}.${field}`, 'positive');
    return result;
  };
  const ingredients = array(data.ingredients, `${path}.ingredients`, RECIPE_PLAN_LIMITS.ingredients).map((entry, i) => {
    const p = `${path}.ingredients[${i}]`;
    // Determine the single allowed key from descriptors, not property values.
    if (entry === null || typeof entry !== 'object') invalid(p, 'ingredient');
    const keys = Reflect.ownKeys(entry);
    const key = keys[0];
    if (keys.length !== 1 || (key !== 'text' && key !== 'heading')) invalid(p, 'ingredient');
    const item = record(entry, p, [key]);
    const text = string(item[key], `${p}.${key}`, budget, true);
    return key === 'text' ? { text } : { heading: text };
  });
  const tags = array(data.tags, `${path}.tags`, RECIPE_PLAN_LIMITS.tags)
    .map((tag, i) => string(tag, `${path}.tags[${i}]`, budget, true));
  return {
    name: string(data.name, `${path}.name`, budget, true),
    description: optionalString('description'), ingredients,
    instructions: string(data.instructions, `${path}.instructions`, budget).replace(/\r\n/g, '\n'),
    prepMinutes: quantity('prepMinutes'), cookMinutes: quantity('cookMinutes'), servings: quantity('servings'),
    cuisine: optionalString('cuisine'), category: optionalString('category'),
    tags: [...new Set(tags)].sort(compare), sourceUrl: optionalString('sourceUrl'),
  };
}

/** @param {unknown} value @param {string} path @param {TextBudget} budget @returns {RecipeState} */
function state(value, path, budget) {
  // First check only the discriminant's descriptor, without invoking accessors.
  if (value === null || typeof value !== 'object') invalid(path, 'state');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'status');
  if (!descriptor || !('value' in descriptor)) invalid(path, 'state_status');
  const status = /** @type {unknown} */ (descriptor.value);
  if (status === 'unknown') { record(value, path, ['status']); return { status }; }
  if (status !== 'present' && status !== 'deleted') invalid(path, 'state_status');
  const data = record(value, path, status === 'present' ? ['status', 'revision', 'content'] : ['status', 'revision']);
  const revision = string(data.revision, `${path}.revision`, budget, true, RECIPE_PLAN_LIMITS.identity);
  return status === 'deleted' ? { status, revision } : { status, revision, content: recipe(data.content, `${path}.content`, budget) };
}

/** @param {unknown} value @returns {RecipePlanInput} */
function input(value) {
  const data = record(value, '$', ['schemaVersion', 'source', 'snapshots', 'policy', 'bindings']);
  if (data.schemaVersion !== 1) invalid('$.schemaVersion', 'version');
  const budget = { remaining: RECIPE_PLAN_LIMITS.totalText };
  const source = record(data.source, '$.source', ['provider', 'sourceId']);
  if (source.provider !== 'tandoor' && source.provider !== 'mealie') invalid('$.source.provider', 'provider');
  const sourceId = string(source.sourceId, '$.source.sourceId', budget, true, RECIPE_PLAN_LIMITS.identity);
  const snapshots = record(data.snapshots, '$.snapshots', ['localComplete', 'remoteComplete']);
  const policy = record(data.policy, '$.policy', ['remoteWritesEnabled', 'remoteWritableFields', 'remoteDeletesEnabled', 'deletionBudget']);
  const deletionBudget = record(policy.deletionBudget, '$.policy.deletionBudget', ['maxCount', 'maxFraction']);
  const fields = array(policy.remoteWritableFields, '$.policy.remoteWritableFields', FIELDS.length).map((field, i) => {
    if (typeof field !== 'string' || !FIELDS.includes(/** @type {RecipeField} */ (field))) invalid(`$.policy.remoteWritableFields[${i}]`, 'field');
    return /** @type {RecipeField} */ (field);
  });
  if (new Set(fields).size !== fields.length) invalid('$.policy.remoteWritableFields', 'duplicate');
  const localIds = new Set();
  const remoteIds = new Set();
  const bindings = array(data.bindings, '$.bindings', RECIPE_PLAN_LIMITS.bindings).map((entry, i) => {
    const p = `$.bindings[${i}]`;
    const binding = record(entry, p, ['localId', 'remoteId', 'baseline', 'local', 'remote']);
    const localId = string(binding.localId, `${p}.localId`, budget, true, RECIPE_PLAN_LIMITS.identity);
    const remoteId = string(binding.remoteId, `${p}.remoteId`, budget, true, RECIPE_PLAN_LIMITS.identity);
    if (localIds.has(localId) || remoteIds.has(remoteId)) invalid(p, 'duplicate_identity');
    localIds.add(localId); remoteIds.add(remoteId);
    return { localId, remoteId, baseline: binding.baseline === null ? null : recipe(binding.baseline, `${p}.baseline`, budget),
      local: state(binding.local, `${p}.local`, budget), remote: state(binding.remote, `${p}.remote`, budget) };
  });
  bindings.sort((a, b) => compare(a.localId, b.localId) || compare(a.remoteId, b.remoteId));
  return { schemaVersion: 1, source: { provider: source.provider, sourceId },
    snapshots: { localComplete: boolean(snapshots.localComplete, '$.snapshots.localComplete'), remoteComplete: boolean(snapshots.remoteComplete, '$.snapshots.remoteComplete') },
    policy: { remoteWritesEnabled: boolean(policy.remoteWritesEnabled, '$.policy.remoteWritesEnabled'),
      remoteWritableFields: FIELDS.filter(field => fields.includes(field)),
      remoteDeletesEnabled: boolean(policy.remoteDeletesEnabled, '$.policy.remoteDeletesEnabled'),
      deletionBudget: { maxCount: number(deletionBudget.maxCount, '$.policy.deletionBudget.maxCount', 0, Number.MAX_SAFE_INTEGER, true),
        maxFraction: number(deletionBudget.maxFraction, '$.policy.deletionBudget.maxFraction', 0, 1, false) } }, bindings };
}

/** @param {unknown} left @param {unknown} right */
function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
/** @param {unknown} value */
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** @param {RecipeState} value @returns {Observation} */
function observation(value) {
  if (value.status === 'unknown') throw new Error('Internal planner observation requires a known state');
  return { status: value.status, revision: value.revision, contentHash: value.status === 'present' ? hash(value.content) : null };
}

/** @param {RecipeSource} source @param {RecipeBinding} binding @param {OperationKind} kind @param {RecipeContent|null} desired @returns {RecipeOperation} */
function operation(source, binding, kind, desired) {
  const target = kind.endsWith('_local') ? binding.local : binding.remote;
  if (target.status !== 'present' || binding.baseline === null) throw new Error('Internal planner target requires a baseline and present recipe');
  const fields = desired === null ? [] : FIELDS.filter(field => !equal(target.content[field], desired[field]));
  const patch = desired === null ? null : Object.fromEntries(fields.map(field => [field, desired[field]]));
  const before = desired === null ? null : Object.fromEntries(fields.map(field => [field, target.content[field]]));
  const payload = { kind, source, localId: binding.localId, remoteId: binding.remoteId,
    baselineHash: hash(binding.baseline), preconditions: { local: observation(binding.local), remote: observation(binding.remote) },
    patch, before, desired, selectedByDefault: desired !== null, requiresExplicitApproval: desired === null };
  return { operationId: hash(payload), ...payload };
}

/**
 * Plan existing-linked recipe edits. Capabilities are caller assertions about an
 * established provider mapping, not authentication. A later applying layer must
 * revalidate BOTH observation preconditions and approve each deletion. No baseline
 * may be advanced until successful application/readback outside this module.
 *
 * Each call covers one source's complete set of already-bound recipe identities.
 * No title/URL matching is attempted. Missing baseline blocks the pair. An absent
 * or unavailable current item must be unknown; deleted means an explicit tombstone.
 * Complete flags assert that all bound identities for this source were supplied.
 * Any unknown item or incomplete snapshot blocks every deletion in this call.
 * Count and fraction budgets apply separately to each deletion target, counting
 * all candidates over all currently present bound recipes on that target.
 *
 * Ingredients and instructions merge atomically; conflicting fields block the
 * entire pair. Tags compare as case-sensitive sets, instructions normalize CRLF
 * to LF, and other recipe text retains whitespace. No operation is applied here.
 * @param {unknown} value @returns {RecipeWritebackPlan}
 */
export function planRecipeWriteback(value) {
  const data = input(value);
  /** @type {RecipeOperation[]} */
  const operations = [];
  /** @type {RecipeFinding[]} */
  const findings = [];
  /** @type {{binding:RecipeBinding, target:'local'|'remote'}[]} */
  const candidates = [];
  const summary = { pairs: data.bindings.length, unchangedPairs: 0, convergedPairs: 0, alreadyDeletedPairs: 0,
    conflictedPairs: 0, blockedPairs: 0, updateLocal: 0, updateRemote: 0,
    deleteCandidates: 0, deleteLocal: 0, deleteRemote: 0, blockedDeleteCandidates: 0 };
  /** @param {RecipeBinding} binding @param {string} reason @param {FindingDetails} [details] */
  const finding = (binding, reason, details = null) => findings.push({ localId: binding.localId, remoteId: binding.remoteId, reason, details });

  for (const binding of data.bindings) {
    const { baseline, local, remote } = binding;
    if (baseline === null) { finding(binding, 'baseline_required'); summary.blockedPairs++; continue; }
    if (local.status === 'unknown' || remote.status === 'unknown') { finding(binding, 'snapshot_unknown'); summary.blockedPairs++; continue; }
    if (local.status === 'deleted' && remote.status === 'deleted') { summary.alreadyDeletedPairs++; continue; }
    if (local.status === 'deleted' || remote.status === 'deleted') {
      const target = local.status === 'deleted' ? 'remote' : 'local';
      const live = binding[target];
      if (live.status !== 'present') throw new Error('Internal deletion target');
      if (!equal(live.content, baseline)) { finding(binding, 'delete_edit_conflict', { deletedSide: target === 'local' ? 'remote' : 'local' }); summary.conflictedPairs++; }
      else { candidates.push({ binding, target }); summary.deleteCandidates++; }
      continue;
    }
    /** @type {RecipeConflict[]} */
    const conflicts = [];
    /** @type {[RecipeField, RecipeContent[RecipeField]][]} */
    const merged = [];
    let converged = false;
    for (const field of FIELDS) {
      const b = baseline[field], l = local.content[field], r = remote.content[field];
      if (equal(l, r)) { merged.push([field, l]); if (!equal(l, b)) converged = true; }
      else if (equal(l, b)) merged.push([field, r]);
      else if (equal(r, b)) merged.push([field, l]);
      else conflicts.push({ field, base: b, local: l, remote: r });
    }
    if (conflicts.length) { finding(binding, 'field_conflict', { fields: conflicts }); summary.conflictedPairs++; continue; }
    const desired = /** @type {RecipeContent} */ (Object.fromEntries(merged));
    const remoteFields = FIELDS.filter(field => !equal(remote.content[field], desired[field]));
    const unsupported = remoteFields.filter(field => !data.policy.remoteWritableFields.includes(field));
    if ((remoteFields.length && !data.policy.remoteWritesEnabled) || unsupported.length) {
      if (remoteFields.length && !data.policy.remoteWritesEnabled) finding(binding, 'remote_write_disabled');
      if (unsupported.length) finding(binding, 'unsupported_remote_field', { fields: unsupported });
      summary.blockedPairs++; continue;
    }
    const localChanged = !equal(local.content, desired);
    if (localChanged) { operations.push(operation(data.source, binding, 'update_local', desired)); summary.updateLocal++; }
    if (remoteFields.length) { operations.push(operation(data.source, binding, 'update_remote', desired)); summary.updateRemote++; }
    if (!localChanged && !remoteFields.length) {
      if (converged) summary.convergedPairs++; else summary.unchangedPairs++;
    }
  }

  const complete = data.snapshots.localComplete && data.snapshots.remoteComplete;
  const unknown = data.bindings.some(binding => binding.local.status === 'unknown' || binding.remote.status === 'unknown');
  for (const target of /** @type {const} */ (['local', 'remote'])) {
    const group = candidates.filter(candidate => candidate.target === target);
    const denominator = data.bindings.filter(binding => binding[target].status === 'present').length;
    const fraction = group.length === 0 ? 0 : group.length / denominator;
    const guarded = group.length > data.policy.deletionBudget.maxCount || fraction > data.policy.deletionBudget.maxFraction;
    for (const { binding } of group) {
      const reason = !complete ? 'incomplete_snapshot' : unknown ? 'source_snapshot_unknown'
        : target === 'remote' && (!data.policy.remoteWritesEnabled || !data.policy.remoteDeletesEnabled) ? 'remote_delete_disabled'
          : guarded ? 'mass_delete_guard' : null;
      if (reason) {
        finding(binding, reason, { target, candidates: group.length, denominator, fraction });
        summary.blockedDeleteCandidates++; summary.blockedPairs++;
      } else {
        operations.push(operation(data.source, binding, target === 'local' ? 'delete_local' : 'delete_remote', null));
        if (target === 'local') summary.deleteLocal++; else summary.deleteRemote++;
      }
    }
  }
  operations.sort((a, b) => compare(a.localId, b.localId) || compare(a.remoteId, b.remoteId) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  findings.sort((a, b) => compare(a.localId, b.localId) || compare(a.remoteId, b.remoteId) || compare(a.reason, b.reason));
  return { schemaVersion: 1, source: data.source, operations, findings, summary };
}

/** Canonical serialization of an unmodified planner result.
 * @param {RecipeWritebackPlan} plan @returns {string}
 */
export function serializeRecipeWritebackPlan(plan) { return `${JSON.stringify(plan, null, 2)}\n`; }
