/** @param {Record<string, unknown>} [overrides] */
export function place(overrides = {}) {
  return { id: 'park', name: 'Synthetic Park', status: 'backlog', isFavorite: false, tags: ['outdoor'], ...overrides };
}

/** @param {Record<string, unknown>} [overrides] */
export function scenario(overrides = {}) {
  return { date: '2024-06-01', hemisphere: 'north', places: [place()], ...overrides };
}

/** @template T @param {T} value @returns {T} */
export function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
