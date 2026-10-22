import type { ShoppingAttributionFilters, ShoppingAttributionSnapshot } from '../../lib/burn4-shopping-attribution';

export const allFilters: ShoppingAttributionFilters = { contributor: { kind: 'all' }, checked: 'all' };

export function snapshot(): ShoppingAttributionSnapshot {
  return {
    list: { id: 'groceries', name: 'Groceries' },
    members: [{ id: 'all', name: 'Robin' }, { id: 'unassigned', name: 'Robin' }, { id: 'zero', name: 'Morgan' }],
    items: [
      { id: 'milk', listId: 'groceries', name: 'Milk', checked: false, addedBy: { id: 'all', name: 'Earlier Robin' } },
      { id: 'bread', listId: 'groceries', name: 'Bread', checked: true, addedBy: { id: 'unassigned', name: 'Robin' } },
      { id: 'rice', listId: 'groceries', name: 'Rice', checked: false, addedBy: { id: 'former', name: 'Casey' } },
      { id: 'soap', listId: 'groceries', name: 'Soap', checked: true, addedBy: null },
      { id: 'tea', listId: 'groceries', name: 'Tea', checked: false },
      { id: 'tools', listId: 'hardware', name: 'Hammer', checked: true, addedBy: { id: 'elsewhere', name: 'Other list' } },
    ],
  };
}
