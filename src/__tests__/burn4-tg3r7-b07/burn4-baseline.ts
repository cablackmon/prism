// Public synthetic catalog snapshot only. No person records or app data.
// src/lib/db/seed.ts lines 433 to 447 and 468 to 674 at master 5452b7c6.
// Seed SHA-256: 21371b52e1405d5ff3d46426f855c401b2384d97b46fa7581fd85153af0dd4d5.
// Tests never import or execute the seed source.
export const baselineGroceries = [
  'Milk', 'Eggs', 'Bread', 'Bananas', 'Spinach', 'Strawberries',
  'Chicken breast', 'Ground beef', 'Greek yogurt', 'Pasta',
  'Marinara sauce', 'Frozen waffles', 'Cereal', 'Orange juice',
] as const;

export const baselineRecipes = [
  'Sheet Pan Meatball Pitas', 'One-Pot Chicken Pasta',
  'Classic Spaghetti and Meatballs', 'Sunday Pancakes', 'Taco Tuesday',
  'Grilled Chicken Salad', "Grandma's Banana Bread",
] as const;
