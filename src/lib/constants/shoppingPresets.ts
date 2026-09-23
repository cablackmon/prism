/**
 * Shopping category presets — shared between client hooks and server API routes.
 * Do NOT add 'use client' here.
 */

export interface ShoppingCategoryPreset {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

export const GROCERY_CATEGORIES: ShoppingCategoryPreset[] = [
  { id: 'produce', name: 'Produce', emoji: '🥬', color: '#22C55E' },
  { id: 'bakery', name: 'Bakery', emoji: '🥖', color: '#F59E0B' },
  { id: 'meat', name: 'Meat', emoji: '🥩', color: '#EF4444' },
  { id: 'dairy', name: 'Dairy', emoji: '🥛', color: '#3B82F6' },
  { id: 'frozen', name: 'Frozen', emoji: '🧊', color: '#8B5CF6' },
  { id: 'pantry', name: 'Pantry', emoji: '🥫', color: '#F97316' },
];

export const GENERAL_CATEGORIES: ShoppingCategoryPreset[] = [
  { id: 'clothes', name: 'Clothes', emoji: '👕', color: '#EC4899' },
  { id: 'housewares', name: 'Housewares', emoji: '🏠', color: '#14B8A6' },
  { id: 'gardening', name: 'Gardening', emoji: '🌱', color: '#84CC16' },
  { id: 'electronics', name: 'Electronics', emoji: '🔌', color: '#6366F1' },
  { id: 'office', name: 'Office', emoji: '📎', color: '#0EA5E9' },
  { id: 'gifts', name: 'Gifts', emoji: '🎁', color: '#F43F5E' },
];

export const ALL_DEFAULT_CATEGORIES: ShoppingCategoryPreset[] = [
  ...GROCERY_CATEGORIES,
  ...GENERAL_CATEGORIES,
];

export const GROCERY_PRESET_IDS = GROCERY_CATEGORIES.map((c) => c.id);
export const GENERAL_PRESET_IDS = GENERAL_CATEGORIES.map((c) => c.id);

export function getPresetsForListType(listType: string): string[] {
  switch (listType) {
    case 'grocery':
      return GROCERY_PRESET_IDS;
    case 'general':
      return GENERAL_PRESET_IDS;
    default:
      return [...GROCERY_PRESET_IDS, ...GENERAL_PRESET_IDS];
  }
}
