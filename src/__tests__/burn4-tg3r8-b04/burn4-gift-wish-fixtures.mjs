// @ts-check
/** @typedef {import('../../../scripts/burn4-gift-wish-reconcile.mjs').Snapshot} Snapshot */
/** @typedef {import('../../../scripts/burn4-gift-wish-reconcile.mjs').Idea} Idea */
/** @typedef {import('../../../scripts/burn4-gift-wish-reconcile.mjs').Wish} Wish */

/** @param {Partial<Idea>} [overrides] @returns {Idea} */
export function idea(overrides = {}) {
  return { id: 'idea-a', creatorId: 'giver', recipientId: 'recipient', purchased: true, revision: 2, ...overrides };
}

/** @param {Partial<Wish>} [overrides] @returns {Wish} */
export function wish(overrides = {}) {
  return { id: 'wish-a', ownerId: 'recipient', claimed: false, claimedById: null, crossedOff: false, revision: 7, ...overrides };
}

/** @param {Partial<Snapshot>} [overrides] @returns {Snapshot} */
export function fixture(overrides = {}) {
  return {
    actorId: 'giver', memberIds: ['giver', 'recipient', 'sibling'],
    ideas: [idea()], wishes: [wish()], bindings: [{ ideaId: 'idea-a', wishId: 'wish-a' }], ...overrides,
  };
}

/** @template T @param {T} value @returns {T} */
export function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
