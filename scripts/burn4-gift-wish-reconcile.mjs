// @ts-check

/**
 * Offline gift/wish reconciliation over explicit caller-owned JSON snapshots.
 * The full result is creator-private. Share only projectWishSnapshot() output.
 * Local transitions do not authenticate callers or persist database changes.
 * Written basis: docs/planning.md:75; docs/features/WISHES.md:44-46,81,153-154,186.
 * Confirmed ID bindings, versioning and conflict policy are design choices.
 *
 * @typedef {{id:string, creatorId:string, recipientId:string, purchased:boolean, revision:number}} Idea
 * @typedef {{id:string, ownerId:string, claimed:boolean, claimedById:string|null, crossedOff:boolean, revision:number}} Wish
 * @typedef {{ideaId:string, wishId:string}} Binding
 * @typedef {{actorId:string, memberIds:string[], ideas:Idea[], wishes:Wish[], bindings:Binding[]}} Snapshot
 * @typedef {{code:string, path:string}} Issue
 * @typedef {{ideaId:string, wishId:string|null, code:string}} Outcome
 * @typedef {{operationId:string, ideaId:string, wishId:string, expectedIdea:Idea, expectedWish:Wish, changes:{claimed:true, claimedById:string, revision:number}}} ClaimIntent
 * @typedef {{status:'invalid'|'ready'|'review_required', snapshot:Snapshot|null, actions:ClaimIntent[], noops:Outcome[], review:Outcome[], issues:Issue[]}} Reconciliation
 * @typedef {{id:string, ownerId:string, crossedOff:boolean, claimed?:boolean, claimedById?:string|null}} WishView
 * @typedef {{status:'invalid'|'ready', wishes:WishView[], issues:Issue[]}} Projection
 */

const WISH_KEYS = ['id', 'ownerId', 'claimed', 'claimedById', 'crossedOff', 'revision'];

/** @param {string} a @param {string} b */
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** @param {Issue[]} issues @param {string} code @param {string} path */
function issue(issues, code, path) { issues.push({ code, path }); }

/**
 * Only plain JSON records with data properties are accepted. Diagnostics never
 * include unknown property names or supplied values.
 * @param {unknown} value @param {string[]} keys @param {string} path
 * @param {Issue[]} issues @param {string[]} [optional]
 * @returns {Record<string, unknown>|null}
 */
function record(value, keys, path, issues, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issue(issues, 'invalid_object', path); return null;
  }
  const proto = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if ((proto !== Object.prototype && proto !== null) || Object.getOwnPropertySymbols(value).length
      || Object.entries(descriptors).some(([key, d]) => !keys.includes(key) || !('value' in d))
      || keys.some(key => !optional.includes(key) && !Object.hasOwn(descriptors, key))) {
    issue(issues, 'invalid_shape', path); return null;
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {number} cap @param {string} path @param {Issue[]} issues @returns {unknown[]} */
function array(value, cap, path, issues) {
  if (!Array.isArray(value) || value.length > cap
      || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length
      || Object.keys(value).length !== value.length
      || Object.entries(Object.getOwnPropertyDescriptors(value)).some(([key, d]) =>
        key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length || !('value' in d)))) {
    issue(issues, 'invalid_array', path); return [];
  }
  return value;
}

/** @param {unknown} value @param {string} path @param {Issue[]} issues @returns {string|null} */
function id(value, path, issues) {
  if (typeof value !== 'string' || value.length > 256 || !value.trim()) {
    issue(issues, 'invalid_id', path); return null;
  }
  return value;
}

/** @param {unknown} value @param {string} path @param {Issue[]} issues @returns {boolean|null} */
function boolean(value, path, issues) {
  if (typeof value !== 'boolean') { issue(issues, 'invalid_boolean', path); return null; }
  return value;
}

/** @param {unknown} value @param {string} path @param {Issue[]} issues @returns {number|null} */
function revision(value, path, issues) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    issue(issues, 'invalid_revision', path); return null;
  }
  return value;
}

/** @param {unknown} value @param {Issue[]} issues @returns {string[]} */
function members(value, issues) {
  const result = array(value, 100, '/memberIds', issues).flatMap((raw, index) => {
    const member = id(raw, `/memberIds/${index}`, issues);
    return member === null ? [] : [member];
  });
  if (new Set(result).size !== result.length) issue(issues, 'duplicate_id', '/memberIds');
  return result.sort(compare);
}

/** @param {string|null} value @param {Set<string>} roster @param {string} path @param {Issue[]} issues */
function member(value, roster, path, issues) {
  if (value !== null && !roster.has(value)) issue(issues, 'nonmember', path);
}

/** @template {{id:string}} T @param {T[]} rows @param {string} path @param {Issue[]} issues */
function unique(rows, path, issues) {
  if (new Set(rows.map(row => row.id)).size !== rows.length) issue(issues, 'duplicate_id', path);
}

/** @param {unknown} input @param {Issue[]} issues @returns {Snapshot|null} */
function snapshot(input, issues) {
  const root = record(input, ['actorId', 'memberIds', 'ideas', 'wishes', 'bindings'], '/', issues);
  if (!root) return null;
  const actorId = id(root.actorId, '/actorId', issues);
  const memberIds = members(root.memberIds, issues);
  const roster = new Set(memberIds);
  member(actorId, roster, '/actorId', issues);
  /** @type {Idea[]} */ const ideas = [];
  for (const [index, raw] of array(root.ideas, 1000, '/ideas', issues).entries()) {
    const path = `/ideas/${index}`;
    const row = record(raw, ['id', 'creatorId', 'recipientId', 'purchased', 'revision'], path, issues);
    if (!row) continue;
    const itemId = id(row.id, `${path}/id`, issues);
    const creatorId = id(row.creatorId, `${path}/creatorId`, issues);
    const recipientId = id(row.recipientId, `${path}/recipientId`, issues);
    const purchased = boolean(row.purchased, `${path}/purchased`, issues);
    const version = revision(row.revision, `${path}/revision`, issues);
    member(creatorId, roster, `${path}/creatorId`, issues);
    member(recipientId, roster, `${path}/recipientId`, issues);
    if (creatorId !== null && creatorId !== actorId) issue(issues, 'private_creator', `${path}/creatorId`);
    if (recipientId !== null && recipientId === actorId) issue(issues, 'self_recipient', `${path}/recipientId`);
    if (itemId !== null && creatorId !== null && recipientId !== null && purchased !== null && version !== null) {
      ideas.push({ id: itemId, creatorId, recipientId, purchased, revision: version });
    }
  }
  /** @type {Wish[]} */ const wishes = [];
  for (const [index, raw] of array(root.wishes, 1000, '/wishes', issues).entries()) {
    const path = `/wishes/${index}`;
    const row = record(raw, WISH_KEYS, path, issues);
    if (!row) continue;
    const itemId = id(row.id, `${path}/id`, issues);
    const ownerId = id(row.ownerId, `${path}/ownerId`, issues);
    const claimed = boolean(row.claimed, `${path}/claimed`, issues);
    const claimedById = row.claimedById === null ? null : id(row.claimedById, `${path}/claimedById`, issues);
    const crossedOff = boolean(row.crossedOff, `${path}/crossedOff`, issues);
    const version = revision(row.revision, `${path}/revision`, issues);
    member(ownerId, roster, `${path}/ownerId`, issues);
    member(claimedById, roster, `${path}/claimedById`, issues);
    if (ownerId !== null && ownerId === actorId) issue(issues, 'own_wish', `${path}/ownerId`);
    if (itemId !== null && ownerId !== null && claimed !== null && crossedOff !== null && version !== null) {
      wishes.push({ id: itemId, ownerId, claimed, claimedById, crossedOff, revision: version });
    }
  }
  /** @type {Binding[]} */ const bindings = [];
  for (const [index, raw] of array(root.bindings, 2000, '/bindings', issues).entries()) {
    const path = `/bindings/${index}`;
    const row = record(raw, ['ideaId', 'wishId'], path, issues);
    if (!row) continue;
    const ideaId = id(row.ideaId, `${path}/ideaId`, issues);
    const wishId = id(row.wishId, `${path}/wishId`, issues);
    if (ideaId !== null && wishId !== null) bindings.push({ ideaId, wishId });
  }
  unique(ideas, '/ideas', issues); unique(wishes, '/wishes', issues);
  if (issues.length || actorId === null) return null;
  return {
    actorId, memberIds,
    ideas: ideas.sort((a, b) => compare(a.id, b.id)),
    wishes: wishes.sort((a, b) => compare(a.id, b.id)),
    bindings: [...new Map(bindings.map(link => [JSON.stringify([link.ideaId, link.wishId]), link])).values()]
      .sort((a, b) => compare(a.ideaId, b.ideaId) || compare(a.wishId, b.wishId)),
  };
}

/**
 * Hold entire connected components with missing references or ambiguous links.
 * Node kinds use tuple encoding, so identical wish/idea IDs never collide.
 * @param {Binding[]} links @param {Map<string, Idea>} ideas @param {Map<string, Wish>} wishes
 * @returns {Map<number, string>}
 */
function holds(links, ideas, wishes) {
  /** @type {Map<string, number[]>} */ const nodes = new Map();
  const keys = links.map(link => [JSON.stringify(['idea', link.ideaId]), JSON.stringify(['wish', link.wishId])]);
  for (const [index, pair] of keys.entries()) {
    for (const key of pair) nodes.set(key, [...(nodes.get(key) ?? []), index]);
  }
  /** @type {Map<number, string>} */ const blocked = new Map();
  /** @type {Set<number>} */ const seen = new Set();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const pending = [start];
    /** @type {number[]} */ const component = [];
    let missing = false; let ambiguous = false;
    while (pending.length) {
      const index = pending.pop();
      if (index === undefined || seen.has(index)) continue;
      seen.add(index); component.push(index);
      const link = links[index];
      if (!link) continue;
      missing ||= !ideas.has(link.ideaId) || !wishes.has(link.wishId);
      for (const key of keys[index] ?? []) {
        const neighbors = nodes.get(key) ?? [];
        ambiguous ||= neighbors.length > 1;
        for (const neighbor of neighbors) if (!seen.has(neighbor)) pending.push(neighbor);
      }
    }
    if (missing || ambiguous) {
      for (const index of component) blocked.set(index, missing ? 'missing_reference' : 'ambiguous_binding');
    }
  }
  return blocked;
}

/** @param {Outcome} a @param {Outcome} b */
function compareOutcome(a, b) {
  return compare(a.ideaId, b.ideaId) || compare(a.wishId ?? '', b.wishId ?? '') || compare(a.code, b.code);
}

/**
 * Apply eligible confirmed purchased links to a fresh local snapshot.
 * CAS intents describe the old state and local changes, not persisted changes.
 * Existing conflicts are retained, and independent eligible components proceed.
 * @param {unknown} input
 * @returns {Reconciliation}
 */
export function reconcileGiftWishes(input) {
  /** @type {Issue[]} */ const issues = [];
  const next = snapshot(input, issues);
  if (!next) return { status: 'invalid', snapshot: null, actions: [], noops: [], review: [], issues };
  const ideas = new Map(next.ideas.map(row => [row.id, row]));
  const wishes = new Map(next.wishes.map(row => [row.id, row]));
  const blocked = holds(next.bindings, ideas, wishes);
  /** @type {ClaimIntent[]} */ const actions = [];
  /** @type {Outcome[]} */ const noops = [];
  /** @type {Outcome[]} */ const review = [];
  const linkedIdeas = new Set(next.bindings.map(link => link.ideaId));
  for (const idea of next.ideas) {
    if (!linkedIdeas.has(idea.id)) review.push({ ideaId: idea.id, wishId: null, code: 'unlinked' });
  }
  for (const [index, link] of next.bindings.entries()) {
    const idea = ideas.get(link.ideaId); const wish = wishes.get(link.wishId);
    const hold = blocked.get(index);
    if (hold || !idea || !wish) {
      review.push({ ...link, code: hold ?? 'missing_reference' }); continue;
    }
    let conflict = '';
    if (idea.recipientId !== wish.ownerId) conflict = 'recipient_mismatch';
    else if (!idea.purchased) { noops.push({ ...link, code: 'not_purchased' }); continue; }
    else if ((!wish.claimed && wish.claimedById !== null)
        || (wish.claimed && (wish.crossedOff || wish.claimedById === wish.ownerId))) conflict = 'inconsistent_claim';
    else if (wish.crossedOff) conflict = 'wish_crossed_off';
    else if (wish.claimed && wish.claimedById === next.actorId) {
      noops.push({ ...link, code: 'already_claimed_by_actor' }); continue;
    } else if (wish.claimed) conflict = wish.claimedById === null ? 'unknown_claimer' : 'claimed_by_other';
    else if (wish.revision === Number.MAX_SAFE_INTEGER) conflict = 'revision_exhausted';
    if (conflict) { review.push({ ...link, code: conflict }); continue; }
    /** @type {ClaimIntent['changes']} */
    const changes = { claimed: true, claimedById: next.actorId, revision: wish.revision + 1 };
    actions.push({
      operationId: JSON.stringify([next.actorId, idea.id, wish.id, idea.revision, wish.revision]),
      ...link, expectedIdea: { ...idea }, expectedWish: { ...wish }, changes,
    });
    wishes.set(wish.id, { ...wish, ...changes });
  }
  next.wishes = [...wishes.values()];
  return {
    status: review.length ? 'review_required' : 'ready', snapshot: next,
    actions, noops: noops.sort(compareOutcome), review: review.sort(compareOutcome), issues,
  };
}

/**
 * Family-visible metadata only. Owner-secret claim fields and revisions never
 * influence an owner's view or validation outcome. Full creator results must
 * never be given to a recipient. This is not authentication or external sync.
 * @param {unknown} input
 * @returns {Projection}
 */
export function projectWishSnapshot(input) {
  /** @type {Issue[]} */ const issues = [];
  const root = record(input, ['viewerId', 'memberIds', 'wishes'], '/', issues);
  if (!root) return { status: 'invalid', wishes: [], issues };
  const viewerId = id(root.viewerId, '/viewerId', issues);
  const memberIds = members(root.memberIds, issues); const roster = new Set(memberIds);
  member(viewerId, roster, '/viewerId', issues);
  /** @type {WishView[]} */ const views = [];
  for (const [index, raw] of array(root.wishes, 1000, '/wishes', issues).entries()) {
    const path = `/wishes/${index}`;
    const row = record(raw, WISH_KEYS, path, issues, ['claimed', 'claimedById', 'revision']);
    if (!row) continue;
    const itemId = id(row.id, `${path}/id`, issues);
    const ownerId = id(row.ownerId, `${path}/ownerId`, issues);
    const crossedOff = boolean(row.crossedOff, `${path}/crossedOff`, issues);
    member(ownerId, roster, `${path}/ownerId`, issues);
    if (itemId === null || ownerId === null || crossedOff === null) continue;
    const view = { id: itemId, ownerId, crossedOff };
    if (ownerId === viewerId) { views.push(view); continue; }
    const claimed = boolean(row.claimed, `${path}/claimed`, issues);
    const claimedById = row.claimedById === null ? null : id(row.claimedById, `${path}/claimedById`, issues);
    member(claimedById, roster, `${path}/claimedById`, issues);
    if (claimed !== null) views.push({ ...view, claimed, claimedById });
  }
  unique(views, '/wishes', issues);
  return issues.length ? { status: 'invalid', wishes: [], issues }
    : { status: 'ready', wishes: views.sort((a, b) => compare(a.id, b.id)), issues };
}
