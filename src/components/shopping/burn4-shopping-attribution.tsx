'use client';

import { useId } from 'react';
import {
  buildShoppingAttributionView,
  type ShoppingAttributionFilters,
  type ShoppingAttributionSnapshot,
  type ShoppingAttributionView,
} from '../../lib/burn4-shopping-attribution';

export interface ShoppingAttributionProps {
  readonly snapshot: ShoppingAttributionSnapshot;
  readonly filters: ShoppingAttributionFilters;
  readonly onFiltersChange: (filters: ShoppingAttributionFilters) => void;
}

/** Controlled attribution browser. The host owns its snapshot and filter state. */
export function Burn4ShoppingAttribution({ snapshot, filters, onFiltersChange }: ShoppingAttributionProps) {
  const identity = useId();
  let view: ShoppingAttributionView;
  try {
    view = buildShoppingAttributionView(snapshot, filters);
  } catch {
    return <section aria-label="Shopping contributors"><p role="alert">Shopping contributor data is unavailable.</p></section>;
  }
  const contributorFilter = view.filters.contributor;
  const selectedIndex = contributorFilter.kind === 'member'
    ? view.contributors.findIndex(person => person.id === contributorFilter.memberId)
    : -1;
  const selectedValue = contributorFilter.kind === 'member' ? `member:${selectedIndex}` : contributorFilter.kind;
  const isDefault = contributorFilter.kind === 'all' && view.filters.checked === 'all';
  return (
    <section aria-labelledby={`${identity}-title`}>
      <h2 id={`${identity}-title`}>{view.list.name} contributors</h2>
      <div>
        <label htmlFor={`${identity}-person`}>Added by</label>
        <select id={`${identity}-person`} value={selectedValue} onChange={event => {
          const value = event.currentTarget.value;
          const person = view.contributors.find((_, index) => value === `member:${index}`);
          if (value === 'all' || value === 'unassigned') {
            onFiltersChange({ contributor: { kind: value }, checked: view.filters.checked });
          } else if (person) {
            onFiltersChange({ contributor: { kind: 'member', memberId: person.id }, checked: view.filters.checked });
          }
        }}>
          <option value="all">Everyone ({view.full.total})</option>
          <option value="unassigned">No contributor recorded ({view.unassigned.total})</option>
          {view.contributors.map((person, index) => (
            <option key={person.id} value={`member:${index}`}>
              {person.name}{person.current ? '' : ' (not in current household)'} ({person.counts.total})
              {view.contributors.some(other => other.id !== person.id && other.name === person.name) ? ` [member ${index + 1}]` : ''}
            </option>
          ))}
        </select>
        <label htmlFor={`${identity}-checked`}>Item status</label>
        <select id={`${identity}-checked`} value={view.filters.checked} onChange={event => {
          const value = event.currentTarget.value;
          if (value === 'all' || value === 'open' || value === 'checked') {
            onFiltersChange({ contributor: view.filters.contributor, checked: value });
          }
        }}>
          <option value="all">All items</option>
          <option value="open">Still needed</option>
          <option value="checked">Checked items</option>
        </select>
        <button type="button" disabled={isDefault} onClick={() => onFiltersChange({ contributor: { kind: 'all' }, checked: 'all' })}>
          Reset filters
        </button>
      </div>
      <p>Full list: {view.full.checked} of {view.full.total} checked</p>
      <progress aria-label="Full list progress" max={view.full.total || 1} value={view.full.checked} />
      <p role="status" aria-live="polite">Showing {view.matched.total} of {view.full.total} items. Matched: {view.matched.checked} of {view.matched.total} checked.</p>
      {view.full.total === 0 ? <p>This list has no items.</p> : view.rows.length === 0 ? <p>No items match these filters.</p> : (
        <ul aria-label="Shopping items with contributors">
          {view.rows.map(row => (
            <li key={row.id}>
              <span style={row.checked ? { textDecoration: 'line-through' } : undefined}>{row.name}</span>
              <span> {row.checked ? 'Checked' : 'Still needed'}. </span>
              <span>{row.contributor
                ? `Added by ${row.contributor.name}${row.contributor.current ? '' : ' (not in current household)'}`
                : 'No contributor recorded'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
