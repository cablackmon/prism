export interface ShoppingAttributionItem {
  readonly id: string;
  readonly listId: string;
  readonly name: string;
  readonly checked: boolean;
  readonly addedBy?: { readonly id: string; readonly name?: string } | null;
}

export interface ShoppingAttributionSnapshot {
  readonly list: { readonly id: string; readonly name: string };
  readonly items: readonly ShoppingAttributionItem[];
  readonly members: readonly { readonly id: string; readonly name: string }[];
}

export type ShoppingContributorFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'unassigned' }
  | { readonly kind: 'member'; readonly memberId: string };

export interface ShoppingAttributionFilters {
  readonly contributor: ShoppingContributorFilter;
  readonly checked: 'all' | 'open' | 'checked';
}

interface Counts {
  readonly total: number;
  readonly checked: number;
  readonly open: number;
}

interface Contributor {
  readonly id: string;
  readonly name: string;
  readonly current: boolean;
}

interface DisplayRow {
  readonly id: string;
  readonly name: string;
  readonly checked: boolean;
  readonly contributor: Contributor | null;
}

export interface ShoppingAttributionView {
  readonly list: { readonly id: string; readonly name: string };
  readonly rows: readonly DisplayRow[];
  readonly contributors: readonly (Contributor & { readonly counts: Counts })[];
  readonly full: Counts;
  readonly matched: Counts;
  readonly unassigned: Counts;
  readonly filters: ShoppingAttributionFilters;
}

const INVALID = 'Invalid shopping attribution data.';

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}

function counts(rows: readonly DisplayRow[]): Counts {
  const checked = rows.filter(row => row.checked).length;
  return Object.freeze({ total: rows.length, checked, open: rows.length - checked });
}

/** Projects only caller-supplied data. It performs no identity lookup or persistence. */
export function buildShoppingAttributionView(
  snapshot: unknown,
  filters: unknown,
): ShoppingAttributionView {
  try {
    let textUnits = 0;
    const text = (value: unknown, limit: number, identity = false): string => {
      if (typeof value !== 'string' || value.length > limit || value.trim().length === 0) throw new Error(INVALID);
      textUnits += value.length;
      if (textUnits > 1_000_000 || (identity && value !== value.trim())) throw new Error(INVALID);
      return identity ? value : value.trim();
    };
    const input = record(snapshot);
    const rawList = record(input.list);
    const list = Object.freeze({ id: text(rawList.id, 128, true), name: text(rawList.name, 100) });
    if (!Array.isArray(input.items) || input.items.length > 2000 ||
        !Array.isArray(input.members) || input.members.length > 256) throw new Error(INVALID);

    const rawFilters = record(filters);
    const selected = record(rawFilters.contributor);
    let contributor: ShoppingContributorFilter;
    if (selected.kind === 'member') {
      contributor = Object.freeze({ kind: 'member', memberId: text(selected.memberId, 128, true) });
    } else if (selected.kind === 'all' || selected.kind === 'unassigned') {
      contributor = Object.freeze({ kind: selected.kind });
    } else throw new Error(INVALID);
    if (rawFilters.checked !== 'all' && rawFilters.checked !== 'open' && rawFilters.checked !== 'checked') throw new Error(INVALID);
    const normalizedFilters = Object.freeze({ contributor, checked: rawFilters.checked });

    const people = new Map<string, Contributor>();
    for (const entry of input.members) {
      const person = record(entry);
      const id = text(person.id, 128, true);
      if (people.has(id)) throw new Error(INVALID);
      people.set(id, Object.freeze({ id, name: text(person.name, 100), current: true }));
    }
    const identities = new Set<string>();
    const targetRows: DisplayRow[] = [];
    for (const entry of input.items) {
      const item = record(entry);
      const id = text(item.id, 128, true);
      const listId = text(item.listId, 128, true);
      const name = text(item.name, 255);
      if (identities.has(id) || typeof item.checked !== 'boolean') throw new Error(INVALID);
      identities.add(id);
      let author: Contributor | null = null;
      if (item.addedBy !== undefined && item.addedBy !== null) {
        const suppliedAuthor = record(item.addedBy);
        const memberId = text(suppliedAuthor.id, 128, true);
        const suppliedName = suppliedAuthor.name === undefined ? undefined : text(suppliedAuthor.name, 100);
        if (listId === list.id) {
          author = people.get(memberId) ?? Object.freeze({
            id: memberId,
            name: suppliedName ?? 'Unavailable member',
            current: false,
          });
          people.set(memberId, author);
        }
      }
      if (listId === list.id) targetRows.push(Object.freeze({ id, name, checked: item.checked, contributor: author }));
    }
    if (contributor.kind === 'member' && !people.has(contributor.memberId)) {
      people.set(contributor.memberId, Object.freeze({ id: contributor.memberId, name: 'Unavailable member', current: false }));
    }
    const matches = targetRows.filter(row => {
      const authorMatches = contributor.kind === 'all' ||
        (contributor.kind === 'unassigned' ? row.contributor === null : row.contributor?.id === contributor.memberId);
      return authorMatches && (normalizedFilters.checked === 'all' || row.checked === (normalizedFilters.checked === 'checked'));
    });
    return Object.freeze({
      list,
      rows: Object.freeze(matches),
      contributors: Object.freeze(Array.from(people.values(), person => Object.freeze({
        ...person,
        counts: counts(targetRows.filter(row => row.contributor?.id === person.id)),
      }))),
      full: counts(targetRows),
      matched: counts(matches),
      unassigned: counts(targetRows.filter(row => row.contributor === null)),
      filters: normalizedFilters,
    });
  } catch {
    throw new Error(INVALID);
  }
}
